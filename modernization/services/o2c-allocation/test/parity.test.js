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

// Currency, source amounts and accounting date must match what posting derives from the header.
async function persistedExtras(id) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE f.c_currency_id <> 100 OR f.amtsourcedr <> f.amtacctdr
                             OR f.amtsourcecr <> f.amtacctcr OR f.dateacct <> h.datetrx
                             OR f.ad_table_id <> 735)::int AS bad
       FROM fact_acct f JOIN c_allocationhdr h ON h.c_allocationhdr_id = f.record_id
      WHERE f.record_id = $1`,
    [id],
  );
  return rows[0];
}

// Fixture ids sit far above seeded data; inserts fail instead of overwriting an existing allocation.
async function dropFixture(id) {
  await db.query('DELETE FROM fact_acct WHERE record_id = $1', [id]);
  await db.query('DELETE FROM c_allocationhdr WHERE c_allocationhdr_id = $1', [id]);
}

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

test('multi-line allocation looks each (currency, date) rate up once and keeps per-line facts', async () => {
  const alloc = await loadAllocation(601);
  const line = alloc.lines[0];
  const batch = { hdr: alloc.hdr, lines: [line, { ...line }, { ...line }] };
  let rateQueries = 0;
  const counting = {
    query: (text, params) => {
      if (text.includes('c_conversion_rate')) rateQueries += 1;
      return db.query(text, params);
    },
  };
  const { facts, balanced, debit, credit } = await buildFacts(batch, { buggy: false }, counting);
  assert.equal(rateQueries, 2); // payment-date + invoice-date EUR->USD, not 2 per line
  assert.ok(balanced);
  assert.equal(debit, 1650);
  assert.equal(credit, 1650);
  assert.deepEqual(facts.map((f) => f.acctType),
    Array(3).fill(['UnallocatedCash', 'Receivable', 'RealizedLoss']).flat());
});

test('posting a mixed-currency multi-line allocation writes the built facts to the ledger in order', async (t) => {
  // Test-DB rows: an EUR line and a USD line (no payment -> header USD, header date) settle on 2024-02-10.
  await db.query(`INSERT INTO c_allocationhdr (c_allocationhdr_id, c_currency_id, datetrx)
                  VALUES (990950, 100, DATE '2024-02-10')`);
  t.after(() => dropFixture(990950));
  await db.query(`INSERT INTO c_allocationline (c_allocationline_id, c_allocationhdr_id, c_invoice_id,
                    c_payment_id, c_bpartner_id, amount, discountamt, writeoffamt) VALUES
                    (990950, 990950, 401, 501, 201, 200.00, 0.00, 0.00),
                    (990951, 990950, 400, NULL, 200, 300.00, 10.00, 5.00),
                    (990952, 990950, 401, 501, 201, 100.00, 0.00, 0.00)`);

  const { facts, debit, credit } = await buildFacts(await loadAllocation(990950), { buggy: false });
  const res = await postAllocation(990950, { buggy: false });
  assert.deepEqual(res, { allocationId: 990950, posted: true, debit, credit, lines: facts.length });

  const { rows } = await db.query(
    `SELECT account_id, amtacctdr::float8 AS dr, amtacctcr::float8 AS cr, description
       FROM fact_acct WHERE record_id = 990950 ORDER BY fact_acct_id`,
  );
  assert.deepEqual(rows, facts.map((f) => ({ account_id: f.accountId, dr: f.dr, cr: f.cr, description: f.desc })));
  assert.deepEqual(await persistedExtras(990950), { n: facts.length, bad: 0 });
  // The USD line on the EUR line's date must not reuse the EUR rate.
  assert.deepEqual(rows[3], { account_id: 301, dr: 300, cr: 0, description: 'Cash received (100@1)' });
});

test('posting more facts than one insert batch writes every fact in order', async (t) => {
  // 340 USD lines with a discount => 3 facts each = 1020 facts, more than one 1000-row INSERT.
  await db.query(`INSERT INTO c_allocationhdr (c_allocationhdr_id, c_currency_id, datetrx)
                  VALUES (990951, 100, DATE '2024-03-01')`);
  t.after(() => dropFixture(990951));
  await db.query(`INSERT INTO c_allocationline (c_allocationline_id, c_allocationhdr_id, c_invoice_id,
                    c_payment_id, c_bpartner_id, amount, discountamt, writeoffamt)
                  SELECT 9900000 + g, 990951, 400, 500, 200, 1 + g, 1.00, 0.00 FROM generate_series(0, 339) g`);
  const { facts } = await buildFacts(await loadAllocation(990951), { buggy: false });
  assert.equal(facts.length, 1020);
  let factInserts = 0;
  const { withTransaction } = db;
  db.withTransaction = (fn) => withTransaction((client) => fn({
    query: (text, params) => {
      if (/INSERT INTO fact_acct/.test(text)) factInserts += 1;
      return client.query(text, params);
    },
  }));
  let res;
  try {
    res = await postAllocation(990951, { buggy: false });
  } finally {
    db.withTransaction = withTransaction;
  }
  assert.equal(factInserts, 2);
  assert.equal(res.lines, 1020);
  const { rows } = await db.query(
    `SELECT account_id, amtacctdr::float8 AS dr, amtacctcr::float8 AS cr
       FROM fact_acct WHERE record_id = 990951 ORDER BY fact_acct_id`,
  );
  assert.deepEqual(rows, facts.map((f) => ({ account_id: f.accountId, dr: f.dr, cr: f.cr })));
  assert.deepEqual(await persistedExtras(990951), { n: 1020, bad: 0 });
});
