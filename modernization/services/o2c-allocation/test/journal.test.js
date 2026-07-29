// Journal-inspection tests: `GET /allocations/:id/journal` must expose the
// persisted Fact_Acct lines (account, debit, credit, currency) with balanced
// totals, and report unposted allocations instead of erroring.
//
// Runs against the embedded PGlite database so it is isolated from the
// Postgres-backed parity suite (both suites mutate the same seed rows).
process.env.EMBED_DB = '1';
delete process.env.DATABASE_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { postAllocation, getJournal } = require('../src/allocation');
const app = require('../src/server');

let server;
let baseUrl;

before(async () => {
  await migrate();
  await db.query('DELETE FROM fact_acct');
  await db.query('UPDATE c_allocationhdr SET posted = FALSE');
  await postAllocation(600, { buggy: false });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
});

function byType(lines) {
  const m = {};
  for (const l of lines) m[l.acctType] = (m[l.acctType] || 0) + (l.debit - l.credit);
  return m;
}

test('journal of posted USD allocation 600 lists every GL line with balanced totals', async () => {
  const journal = await getJournal(600);
  assert.equal(journal.posted, true);
  assert.deepEqual(journal.totals, { debit: 1000, credit: 1000, balanced: true });
  assert.equal(journal.lines.length, 3);

  const t = byType(journal.lines);
  assert.equal(t.UnallocatedCash, 980);
  assert.equal(t.DiscountExp, 20);
  assert.equal(t.Receivable, -1000);

  const cash = journal.lines.find((l) => l.acctType === 'UnallocatedCash');
  assert.equal(cash.accountId, 301);
  assert.equal(cash.accountName, '1150 Unallocated Cash Receipts');
  assert.equal(cash.currency, 'USD');
  assert.equal(cash.credit, 0);
});

test('journal of an unposted allocation says so instead of erroring', async () => {
  const journal = await getJournal(601);
  assert.equal(journal.posted, false);
  assert.match(journal.message, /has not been posted/);
  assert.deepEqual(journal.lines, []);

  const res = await fetch(`${baseUrl}/allocations/601/journal`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.posted, false);
  assert.match(body.message, /has not been posted/);
});

test('journal of the multi-currency allocation shows the realized FX loss line', async () => {
  await postAllocation(601, { buggy: false });
  const res = await fetch(`${baseUrl}/allocations/601/journal`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.allocationId, 601);
  assert.equal(body.posted, true);
  assert.deepEqual(body.totals, { debit: 550, credit: 550, balanced: true });
  const t = byType(body.lines);
  assert.equal(t.UnallocatedCash, 525);
  assert.equal(t.RealizedLoss, 25);
  assert.equal(t.Receivable, -550);
});

test('journal of an unknown allocation is a 404', async () => {
  assert.equal(await getJournal(999), null);
  const res = await fetch(`${baseUrl}/allocations/999/journal`);
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /not found/);
});

test('journal of a non-numeric allocation id is a 400', async () => {
  const res = await fetch(`${baseUrl}/allocations/abc/journal`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Invalid allocation id/);
});
