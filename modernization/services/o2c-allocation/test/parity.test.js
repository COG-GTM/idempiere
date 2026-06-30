// Parity tests: the migrated PostgreSQL posting must reproduce the Oracle-era
// accounting exactly (balanced Fact_Acct, correct realized FX), and the seeded
// regression must be caught by the balance check.
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

test('SEEDED REGRESSION: dropping realized FX leaves EUR allocation unbalanced', async () => {
  const alloc = await loadAllocation(601);
  const { balanced, debit, credit } = await buildFacts(alloc, { buggy: true });
  assert.equal(balanced, false);
  assert.equal(debit, 525);
  assert.equal(credit, 550);

  await db.query('UPDATE c_allocationhdr SET posted = FALSE WHERE c_allocationhdr_id = 601');
  await assert.rejects(
    () => postAllocation(601, { buggy: true }),
    (err) => err instanceof PostingNotBalancedError && err.debit === 525 && err.credit === 550,
  );
});

test('USD allocation 600 is unaffected by the regression (single-currency)', async () => {
  await db.query('UPDATE c_allocationhdr SET posted = FALSE WHERE c_allocationhdr_id = 600');
  const res = await postAllocation(600, { buggy: true });
  assert.equal(res.posted, true); // no FX => still balances even in bug mode
});
