#!/usr/bin/env node
// Golden-dataset parity harness for the O2C allocation -> GL posting slice.
//
// Reproduces the migration-cutover check: apply schema + index parity, post the
// golden allocations, read back the Fact_Acct lines, and assert they match the
// recorded Oracle-era golden GL (scripts/golden/fact_acct.golden.json). Also
// verifies index parity. Exits non-zero on any mismatch so it can gate CI or a
// cutover. Runs against the same Postgres the service uses (PG* / DATABASE_URL).
//
//   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=o2c \
//     node scripts/parity-harness.js

const fs = require('fs');
const path = require('path');

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { postAllocation } = require('../src/allocation');
const { applyIndexParity, checkIndexParity } = require('../src/schema/index-parity');

const GOLDEN_PATH = path.join(__dirname, 'golden', 'fact_acct.golden.json');
const TOLERANCE = 0.005;

function loadGolden() {
  return JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
}

// Compare one accounting-currency amount (debit or credit) against golden.
function fieldDiff(field, label, actual, golden) {
  if (Math.abs(Number(actual[field]) - Number(golden[field])) > TOLERANCE) {
    return `${label} mismatch: alloc=${golden.record_id} account=${golden.account_id} `
      + `got ${Number(actual[field]).toFixed(2)} want ${Number(golden[field]).toFixed(2)}`;
  }
  return null;
}

// Compare the posted GL against its golden lines. Works for any allocation set.
function verifyAllocation(actualRows, goldenRows) {
  const diffs = [];
  for (const g of goldenRows) {
    const a = actualRows.find((r) => r.record_id === g.record_id && r.account_id === g.account_id);
    if (!a) {
      diffs.push(`missing GL line: alloc=${g.record_id} account=${g.account_id}`);
      continue;
    }
    for (const [field, label] of [['amtacctdr', 'debit'], ['amtacctcr', 'credit']]) {
      const diff = fieldDiff(field, label, a, g);
      if (diff) diffs.push(diff);
    }
  }
  return diffs;
}

async function run() {
  const golden = loadGolden();

  await migrate();
  const created = await applyIndexParity(db);
  const parity = await checkIndexParity(db);
  console.log(`[parity] index parity: ${parity.required - parity.missing.length}/${parity.required} present (applied ${created})`);
  if (!parity.ok) {
    console.error(`[parity] MISSING indexes: ${parity.missing.join(', ')}`);
  }

  // Deterministic re-post of the golden allocations.
  await db.query('DELETE FROM fact_acct');
  await db.query('UPDATE c_allocationhdr SET posted = FALSE');
  for (const id of golden.allocations) {
    await postAllocation(id, { buggy: false });
  }

  const { rows } = await db.query(
    `SELECT record_id, account_id, amtacctdr, amtacctcr
       FROM fact_acct WHERE ad_table_id = $1
      ORDER BY record_id, account_id`,
    [golden.ad_table_id],
  );

  const diffs = verifyAllocation(rows, golden.lines);

  const ok = parity.ok && diffs.length === 0;
  if (diffs.length > 0) {
    console.error(`[parity] GL mismatches (${diffs.length}):`);
    for (const d of diffs) console.error(`  - ${d}`);
  } else {
    console.log(`[parity] GL matches golden: ${rows.length} Fact_Acct lines across ${golden.allocations.length} allocations`);
  }
  console.log(`[parity] RESULT: ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

if (require.main === module) {
  run()
    .then((ok) => db.pool.end().then(() => process.exit(ok ? 0 : 1)))
    .catch((e) => { console.error('[parity] harness error:', e.message); process.exit(2); });
}

module.exports = { run, verifyAllocation, fieldDiff, loadGolden };
