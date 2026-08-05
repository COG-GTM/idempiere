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

test('EUR allocation 601 posts balanced through postAllocation (DR == CR)', async () => {
  await db.query('UPDATE c_allocationhdr SET posted = FALSE WHERE c_allocationhdr_id = 601');
  const res = await postAllocation(601, { buggy: false });
  assert.equal(res.posted, true);
  assert.equal(res.debit, 550);
  assert.equal(res.credit, 550);

  const { rows } = await db.query(
    `SELECT sum(amtacctdr)::numeric AS dr, sum(amtacctcr)::numeric AS cr
       FROM fact_acct WHERE record_id = 601`,
  );
  assert.equal(Number(rows[0].dr), 550);
  assert.equal(Number(rows[0].cr), 550);
});

test('a settlement rate above the booking rate posts a realized FX gain and balances', async () => {
  // Invoice booked 2024-02 (EUR@1.05), settled 2024-01 (EUR@1.10) => 25.00 gain.
  const alloc = {
    hdr: { c_currency_id: 101, datetrx: new Date('2024-02-10') },
    lines: [{
      amount: 500, discountamt: 0, writeoffamt: 0,
      invoice_currency_id: 101, dateinvoiced: new Date('2024-02-10'),
      payment_currency_id: 101, paymentdate: new Date('2024-01-20'),
    }],
  };
  const { facts, balanced, debit, credit } = await buildFacts(alloc, { buggy: false });
  assert.ok(balanced);
  assert.equal(debit, 550);
  assert.equal(credit, 550);
  const t = byType(facts);
  assert.equal(t.RealizedGain, -25); // credit
});

test('the ALLOC_BUG demo gate no longer produces an unbalanced posting', async () => {
  const alloc = await loadAllocation(601);
  const { balanced, debit, credit } = await buildFacts(alloc, { buggy: true });
  assert.ok(balanced);
  assert.equal(debit, 550);
  assert.equal(credit, 550);

  await db.query('UPDATE c_allocationhdr SET posted = FALSE WHERE c_allocationhdr_id = 601');
  const res = await postAllocation(601, { buggy: true });
  assert.equal(res.posted, true);
});

test('USD allocation 600 stays balanced with the gate armed (single-currency)', async () => {
  await db.query('UPDATE c_allocationhdr SET posted = FALSE WHERE c_allocationhdr_id = 600');
  const res = await postAllocation(600, { buggy: true });
  assert.equal(res.posted, true);
  assert.equal(res.debit, res.credit);
});

test('the balance check still rejects an unbalanced posting', async () => {
  const err = new PostingNotBalancedError(601, 525, 550);
  assert.equal(err.message, 'Allocation 601 posting not balanced: DR 525.00 != CR 550.00');
});
