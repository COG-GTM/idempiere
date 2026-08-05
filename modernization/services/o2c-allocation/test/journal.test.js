// Journal tests: an AR accountant must be able to read back the exact GL lines
// (account, debit, credit, currency) a posting produced, with balanced totals,
// and get a plain answer for an allocation that has not been posted yet.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { postAllocation, getAllocationJournal } = require('../src/allocation');

before(async () => {
  await migrate();
  await db.query('DELETE FROM fact_acct');
  await db.query('UPDATE c_allocationhdr SET posted = FALSE');
});

after(async () => { await db.pool.end(); });

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body) });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

test('journal of an unposted allocation reports that instead of erroring', async () => {
  const journal = await getAllocationJournal(600);
  assert.equal(journal.posted, false);
  assert.deepEqual(journal.lines, []);
  assert.equal(journal.totals.debit, 0);
  assert.equal(journal.totals.credit, 0);
  assert.ok(journal.totals.balanced);
  assert.match(journal.message, /has not been posted yet/);
});

test('journal of allocation 600 lists each GL line and balanced totals', async () => {
  await postAllocation(600, { buggy: false });
  const journal = await getAllocationJournal(600);

  assert.equal(journal.posted, true);
  assert.equal(journal.accountingCurrency, 'USD');
  assert.deepEqual(journal.totals, { debit: 1000, credit: 1000, balanced: true });
  assert.equal(journal.message, undefined);

  assert.deepEqual(
    journal.lines.map((l) => [l.acctType, l.currency, l.debit, l.credit]),
    [
      ['UnallocatedCash', 'USD', 980, 0],
      ['DiscountExp', 'USD', 20, 0],
      ['Receivable', 'USD', 0, 1000],
    ],
  );
  for (const line of journal.lines) {
    assert.ok(line.accountName, 'each line names its account');
    assert.equal(line.dateacct, '2024-01-20');
  }
});

test('journal of an unknown allocation is a 404', async () => {
  await assert.rejects(() => getAllocationJournal(999999), (err) => err.statusCode === 404);
});

test('GET /allocations/:id/journal serves the journal and 404s unknown ids', async () => {
  const app = require('../src/server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address();
    const ok = await getJson(port, '/allocations/600/journal');
    assert.equal(ok.status, 200);
    assert.equal(ok.json.lines.length, 3);
    assert.equal(ok.json.totals.balanced, true);

    const missing = await getJson(port, '/allocations/999999/journal');
    assert.equal(missing.status, 404);
    assert.match(missing.json.error, /not found/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
