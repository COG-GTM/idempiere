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

// Compare the posted GL for allocation 600 against its golden lines.
function verifyAllocation600(actualRows, goldenRows) {
  const diffs = [];
  for (const g of goldenRows) {
    const a = actualRows.find((r) => r.record_id === g.record_id && r.account_id === g.account_id);
    if (!a) {
      diffs.push(`missing GL line: alloc=${g.record_id} account=${g.account_id}`);
      continue;
    }
    if (Math.abs(Number(a.amtacctdr) - Number(g.amtacctdr)) > TOLERANCE) {
      diffs.push(`debit mismatch: alloc=${g.record_id} account=${g.account_id} got ${Number(a.amtacctdr).toFixed(2)} want ${Number(g.amtacctdr).toFixed(2)}`);
    }
    if (Math.abs(Number(a.amtacctcr) - Number(g.amtacctcr)) > TOLERANCE) {
      diffs.push(`credit mismatch: alloc=${g.record_id} account=${g.account_id} got ${Number(a.amtacctcr).toFixed(2)} want ${Number(g.amtacctcr).toFixed(2)}`);
    }
  }
  return diffs;
}

// Compare the posted GL for allocation 601 against its golden lines.
function verifyAllocation601(actualRows, goldenRows) {
  const diffs = [];
  for (const g of goldenRows) {
    const a = actualRows.find((r) => r.record_id === g.record_id && r.account_id === g.account_id);
    if (!a) {
      diffs.push(`missing GL line: alloc=${g.record_id} account=${g.account_id}`);
      continue;
    }
    if (Math.abs(Number(a.amtacctdr) - Number(g.amtacctdr)) > TOLERANCE) {
      diffs.push(`debit mismatch: alloc=${g.record_id} account=${g.account_id} got ${Number(a.amtacctdr).toFixed(2)} want ${Number(g.amtacctdr).toFixed(2)}`);
    }
    if (Math.abs(Number(a.amtacctcr) - Number(g.amtacctcr)) > TOLERANCE) {
      diffs.push(`credit mismatch: alloc=${g.record_id} account=${g.account_id} got ${Number(a.amtacctcr).toFixed(2)} want ${Number(g.amtacctcr).toFixed(2)}`);
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

  const golden600 = golden.lines.filter((l) => l.record_id === 600);
  const golden601 = golden.lines.filter((l) => l.record_id === 601);
  const diffs = [
    ...verifyAllocation600(rows, golden600),
    ...verifyAllocation601(rows, golden601),
  ];

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

module.exports = { run, verifyAllocation600, verifyAllocation601, loadGolden };
