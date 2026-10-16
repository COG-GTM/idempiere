// Consolidated O2C parity suite — auto-discovers golden fixtures from
// test/fixtures/*.json and asserts that PostgreSQL Fact_Acct lines and totals
// reproduce the Oracle-era golden dataset exactly.
//
// To add a new scenario: drop a JSON file in test/fixtures/. The harness picks
// it up on the next run — no code changes needed. See test/fixtures/README.md
// for the fixture schema.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { postAllocation, buildFacts, loadAllocation } = require('../src/allocation');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadFixtures() {
  const files = fs.readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((f) => {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8');
    return { file: f, ...JSON.parse(raw) };
  });
}

const fixtures = loadFixtures();

before(async () => {
  // migrate() is idempotent but may race with other test files under concurrent
  // execution (node --test runs files in parallel). Handle gracefully.
  try { await migrate(); } catch (e) {
    if (e.code !== '23505') throw e; // ignore duplicate-key from concurrent CREATE
  }
  // Apply fixture-specific seed SQL (idempotent, ON CONFLICT DO NOTHING).
  for (const fixture of fixtures) {
    if (fixture.seedSql && fixture.seedSql.length > 0) {
      for (const sql of fixture.seedSql) {
        await db.query(sql);
      }
    }
  }
  // Reset posted flags + GL so the suite is deterministic.
  await db.query('DELETE FROM fact_acct');
  await db.query('UPDATE c_allocationhdr SET posted = FALSE');
});

after(async () => { await db.pool.end(); });

// Aggregate Fact_Acct lines by acctType for comparison.
function aggregateByType(facts) {
  const map = {};
  for (const f of facts) {
    const key = f.acctType;
    if (!map[key]) map[key] = { acctType: key, dr: 0, cr: 0 };
    map[key].dr += f.dr;
    map[key].cr += f.cr;
  }
  return Object.values(map).sort((a, b) => a.acctType.localeCompare(b.acctType));
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

describe('O2C Parity Suite — Golden Dataset Verification', () => {
  for (const fixture of fixtures) {
    describe(`[${fixture.scenario}] ${fixture.description}`, () => {
      test('posting produces balanced Fact_Acct matching Oracle-era totals', async () => {
        const res = await postAllocation(fixture.allocationId, { buggy: false });
        assert.strictEqual(res.posted, true,
          `Allocation ${fixture.allocationId} should post successfully`);
        assert.strictEqual(res.debit, fixture.expected.totalDebit,
          `Total debit: expected ${fixture.expected.totalDebit}, got ${res.debit}`);
        assert.strictEqual(res.credit, fixture.expected.totalCredit,
          `Total credit: expected ${fixture.expected.totalCredit}, got ${res.credit}`);
      });

      test('Fact_Acct lines match Oracle-era golden dataset', async () => {
        const alloc = await loadAllocation(fixture.allocationId);
        const { facts, balanced, debit, credit } = await buildFacts(alloc, { buggy: false });

        assert.strictEqual(balanced, fixture.expected.balanced,
          `Balanced: expected ${fixture.expected.balanced}, got ${balanced}`);

        const actual = aggregateByType(facts);
        const expected = [...fixture.expected.lines].sort(
          (a, b) => a.acctType.localeCompare(b.acctType),
        );

        assert.strictEqual(actual.length, expected.length,
          `Line count mismatch: expected ${expected.length}, got ${actual.length}. ` +
          `Actual types: [${actual.map((l) => l.acctType).join(', ')}]`);

        for (let i = 0; i < expected.length; i++) {
          const exp = expected[i];
          const act = actual[i];
          assert.strictEqual(act.acctType, exp.acctType,
            `Line ${i} acctType: expected ${exp.acctType}, got ${act.acctType}`);
          assert.strictEqual(round2(act.dr), exp.dr,
            `${exp.acctType} debit: expected ${exp.dr}, got ${round2(act.dr)}`);
          assert.strictEqual(round2(act.cr), exp.cr,
            `${exp.acctType} credit: expected ${exp.cr}, got ${round2(act.cr)}`);
        }
      });

      test('Fact_Acct persisted rows match golden totals', async () => {
        const { rows } = await db.query(
          `SELECT ae.acct_type,
                  SUM(fa.amtacctdr)::numeric AS dr,
                  SUM(fa.amtacctcr)::numeric AS cr
             FROM fact_acct fa
             JOIN acct_element ae ON ae.account_id = fa.account_id
            WHERE fa.record_id = $1 AND fa.ad_table_id = 735
            GROUP BY ae.acct_type
            ORDER BY ae.acct_type`,
          [fixture.allocationId],
        );

        const expected = [...fixture.expected.lines].sort(
          (a, b) => a.acctType.localeCompare(b.acctType),
        );

        assert.strictEqual(rows.length, expected.length,
          `Persisted line count mismatch for allocation ${fixture.allocationId}`);

        for (let i = 0; i < expected.length; i++) {
          const exp = expected[i];
          const row = rows[i];
          assert.strictEqual(row.acct_type, exp.acctType,
            `Persisted line ${i} type mismatch`);
          assert.strictEqual(Number(row.dr), exp.dr,
            `${exp.acctType} persisted DR: expected ${exp.dr}, got ${Number(row.dr)}`);
          assert.strictEqual(Number(row.cr), exp.cr,
            `${exp.acctType} persisted CR: expected ${exp.cr}, got ${Number(row.cr)}`);
        }

        // Verify overall balance of persisted rows.
        const totalDr = rows.reduce((s, r) => s + Number(r.dr), 0);
        const totalCr = rows.reduce((s, r) => s + Number(r.cr), 0);
        assert.strictEqual(round2(totalDr), fixture.expected.totalDebit,
          `Persisted total debit mismatch`);
        assert.strictEqual(round2(totalCr), fixture.expected.totalCredit,
          `Persisted total credit mismatch`);
      });
    });
  }
});

describe('O2C Parity Suite — Drift Detection', () => {
  test('buggy posting of multi-currency allocation drifts from parity (quality gate)', async () => {
    // Find a fixture with FX lines (totalDebit != sum of non-FX debits).
    const fxFixture = fixtures.find((f) =>
      f.expected.lines.some((l) => l.acctType === 'RealizedLoss' || l.acctType === 'RealizedGain'),
    );
    if (!fxFixture) return; // no FX fixtures loaded

    const alloc = await loadAllocation(fxFixture.allocationId);
    const { balanced, debit, credit } = await buildFacts(alloc, { buggy: true });
    assert.strictEqual(balanced, false,
      'Buggy posting of FX allocation must be detected as unbalanced (parity drift)');
    assert.notStrictEqual(debit, credit,
      'DR != CR when FX balancing entry is dropped');
  });
});
