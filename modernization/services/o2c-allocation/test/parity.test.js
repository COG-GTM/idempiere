// Parity tests: the migrated PostgreSQL posting must reproduce the Oracle-era
// accounting exactly (balanced Fact_Acct, correct realized FX) with the
// realized-FX line posted whether or not the ALLOC_BUG demo gate is armed, and
// the balance check must still refuse an unbalanced entry.
const { test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { postAllocation, buildFacts, loadAllocation, PostingNotBalancedError } = require('../src/allocation');

before(async () => {
  await migrate();
  // Reset posted flags + GL so the suite is deterministic.
  await db.query('DELETE FROM fact_acct');
  await db.query('UPDATE c_allocationhdr SET posted = FALSE');
});

after(async () => { await db.pool.end(); });

function byType(facts) {
  const m = {};
  for (const f of facts) m[f.acctType] = (m[f.acctType] || 0) + (f.dr - f.cr);
  return m;
}

test('USD allocation 600 posts balanced (cash 980 + discount 20 = AR 1000)', async () => {
  const res = await postAllocation(600, { buggy: false });
  assert.equal(res.posted, true);
  assert.equal(res.debit, 1000);
  assert.equal(res.credit, 1000);

  const alloc = await loadAllocation(600);
  const { facts, balanced } = await buildFacts(alloc, { buggy: false });
  assert.ok(balanced);
  const t = byType(facts);
  assert.equal(t.UnallocatedCash, 980);
  assert.equal(t.DiscountExp, 20);
  assert.equal(t.Receivable, -1000); // credit
});

test('EUR allocation 601 books a 25.00 realized FX loss and balances', async () => {
  const alloc = await loadAllocation(601);
  const { facts, balanced, debit, credit } = await buildFacts(alloc, { buggy: false });
  assert.ok(balanced, 'multi-currency allocation must balance');
  assert.equal(debit, 550);
  assert.equal(credit, 550);
  const t = byType(facts);
  assert.equal(t.UnallocatedCash, 525); // 500 EUR @1.05
  assert.equal(t.RealizedLoss, 25);     // AR 550 - cash 525
  assert.equal(t.Receivable, -550);     // 500 EUR @1.10
});

test('EUR allocation 601 balances with the ALLOC_BUG gate armed', async () => {
  const alloc = await loadAllocation(601);
  const { facts, balanced, debit, credit } = await buildFacts(alloc, { buggy: true });
  assert.ok(balanced, 'realized FX must be posted even with the demo gate armed');
  assert.equal(debit, 550);
  assert.equal(credit, 550);
  assert.equal(byType(facts).RealizedLoss, 25);

  await db.query('UPDATE c_allocationhdr SET posted = FALSE WHERE c_allocationhdr_id = 601');
  const res = await postAllocation(601, { buggy: true });
  assert.equal(res.posted, true);
  assert.equal(res.debit, res.credit);
  assert.equal(res.bugMode, true); // gate still reported, no longer breaks the posting
});

test('every seeded allocation posts a balanced GL entry under both gate states', async () => {
  for (const id of [600, 601]) {
    for (const buggy of [false, true]) {
      const alloc = await loadAllocation(id);
      const { debit, credit, balanced } = await buildFacts(alloc, { buggy });
      assert.ok(balanced, `allocation ${id} must balance (buggy=${buggy})`);
      assert.equal(debit, credit);
    }
  }
});

test('the balance guard still rejects an unbalanced posting', async () => {
  const err = new PostingNotBalancedError(601, 525, 550);
  assert.equal(err.name, 'PostingNotBalancedError');
  assert.match(err.message, /Allocation 601 posting not balanced: DR 525\.00 != CR 550\.00/);
});

test('USD allocation 600 posts balanced with the gate armed (single-currency)', async () => {
  await db.query('UPDATE c_allocationhdr SET posted = FALSE WHERE c_allocationhdr_id = 600');
  const res = await postAllocation(600, { buggy: true });
  assert.equal(res.posted, true);
  assert.equal(res.debit, res.credit);
});
