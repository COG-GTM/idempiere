// Parity tests for P2P procurement schema (L8N2-67).
// Validates: column types / precision / null semantics match Oracle-era schema,
// indexes prevent sequential scans on match tables, sequences work for doc numbers,
// and golden-dataset row counts + checksums are correct.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../src/db');
const { migrate } = require('../src/migrate');

before(async () => {
  await migrate();
});

after(async () => { await db.pool.end(); });

// ─── Helpers ─────────────────────────────────────────────────

async function columnInfo(tableName) {
  const { rows } = await db.query(
    `SELECT column_name, data_type, numeric_precision, numeric_scale,
            character_maximum_length, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [tableName],
  );
  const m = {};
  for (const r of rows) m[r.column_name] = r;
  return m;
}

async function tableIndexes(tableName) {
  const { rows } = await db.query(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1`,
    [tableName],
  );
  return rows;
}

async function explainPlan(sql, params) {
  const { rows } = await db.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
  return JSON.stringify(rows);
}

// ─── AC 1: Column types, precision and null semantics ────────

const PROCUREMENT_TABLES = [
  'm_requisition', 'c_order', 'm_inout', 'c_invoice',
  'm_matchpo', 'm_matchinv', 'c_payment',
];

describe('AC1: column types, precision and null semantics match Oracle-era schema', () => {
  test('all 7 procurement tables exist', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [PROCUREMENT_TABLES],
    );
    const found = rows.map((r) => r.table_name).sort();
    assert.deepStrictEqual(found, [...PROCUREMENT_TABLES].sort());
  });

  test('ID columns use NUMERIC(10) — Oracle NUMBER(10) parity', async () => {
    for (const tbl of PROCUREMENT_TABLES) {
      const cols = await columnInfo(tbl);
      const idCols = Object.keys(cols).filter((c) => c.endsWith('_id'));
      for (const col of idCols) {
        const info = cols[col];
        assert.strictEqual(info.data_type, 'numeric',
          `${tbl}.${col} should be numeric, got ${info.data_type}`);
        assert.strictEqual(info.numeric_precision, 10,
          `${tbl}.${col} precision should be 10, got ${info.numeric_precision}`);
      }
    }
  });

  test('amount columns use NUMERIC(20,2) — Oracle NUMBER std-precision parity', async () => {
    const amountChecks = [
      ['m_requisition', 'totallines'],
      ['c_order', 'grandtotal'], ['c_order', 'totallines'], ['c_order', 'chargeamt'], ['c_order', 'freightamt'],
      ['c_invoice', 'grandtotal'], ['c_invoice', 'totallines'], ['c_invoice', 'chargeamt'],
      ['c_payment', 'payamt'], ['c_payment', 'discountamt'], ['c_payment', 'chargeamt'], ['c_payment', 'overunderamt'],
      ['m_inout', 'chargeamt'], ['m_inout', 'freightamt'],
      ['m_matchpo', 'pricematchdifference'],
    ];
    for (const [tbl, col] of amountChecks) {
      const cols = await columnInfo(tbl);
      const info = cols[col];
      assert.ok(info, `${tbl}.${col} should exist`);
      assert.strictEqual(info.data_type, 'numeric',
        `${tbl}.${col} should be numeric, got ${info.data_type}`);
      assert.strictEqual(info.numeric_precision, 20,
        `${tbl}.${col} precision should be 20, got ${info.numeric_precision}`);
      assert.strictEqual(info.numeric_scale, 2,
        `${tbl}.${col} scale should be 2, got ${info.numeric_scale}`);
    }
  });

  test('quantity columns use NUMERIC(20,8) — extended precision for Oracle NUMBER parity', async () => {
    const qtyChecks = [
      ['m_matchpo', 'qty'],
      ['m_matchinv', 'qty'],
    ];
    for (const [tbl, col] of qtyChecks) {
      const cols = await columnInfo(tbl);
      const info = cols[col];
      assert.strictEqual(info.data_type, 'numeric');
      assert.strictEqual(info.numeric_precision, 20);
      assert.strictEqual(info.numeric_scale, 8);
    }
  });

  test('boolean flags use CHAR(1) — Oracle-era Y/N semantics', async () => {
    const boolChecks = [
      ['m_requisition', ['isactive', 'isapproved', 'posted', 'processed']],
      ['c_order', ['isactive', 'isapproved', 'issotrx', 'posted', 'processed']],
      ['m_inout', ['isactive', 'isapproved', 'issotrx', 'posted', 'processed']],
      ['c_invoice', ['isactive', 'isapproved', 'issotrx', 'ispaid', 'posted', 'processed']],
      ['m_matchpo', ['isactive', 'isapproved', 'posted', 'processed']],
      ['m_matchinv', ['isactive', 'posted', 'processed']],
      ['c_payment', ['isactive', 'isreceipt', 'isallocated', 'isapproved', 'posted', 'processed']],
    ];
    for (const [tbl, cols] of boolChecks) {
      const info = await columnInfo(tbl);
      for (const col of cols) {
        assert.strictEqual(info[col].data_type, 'character',
          `${tbl}.${col} should be character (CHAR), got ${info[col].data_type}`);
        assert.strictEqual(info[col].character_maximum_length, 1,
          `${tbl}.${col} should be CHAR(1), got length ${info[col].character_maximum_length}`);
      }
    }
  });

  test('date/timestamp columns use TIMESTAMP WITHOUT TIME ZONE — Oracle DATE parity', async () => {
    const dateChecks = [
      ['m_requisition', ['datedoc', 'daterequired', 'created', 'updated']],
      ['c_order', ['dateordered', 'dateacct', 'created', 'updated']],
      ['m_inout', ['movementdate', 'dateacct', 'created', 'updated']],
      ['c_invoice', ['dateinvoiced', 'dateacct', 'created', 'updated']],
      ['m_matchpo', ['datetrx', 'dateacct', 'created', 'updated']],
      ['m_matchinv', ['datetrx', 'dateacct', 'created', 'updated']],
      ['c_payment', ['datetrx', 'dateacct', 'created', 'updated']],
    ];
    for (const [tbl, cols] of dateChecks) {
      const info = await columnInfo(tbl);
      for (const col of cols) {
        assert.strictEqual(info[col].data_type, 'timestamp without time zone',
          `${tbl}.${col} should be timestamp without time zone, got ${info[col].data_type}`);
      }
    }
  });

  test('NOT NULL constraints match Oracle-era schema on mandatory columns', async () => {
    const notNullChecks = [
      ['m_requisition', ['m_requisition_id', 'ad_client_id', 'ad_org_id', 'documentno', 'docstatus', 'totallines']],
      ['c_order', ['c_order_id', 'ad_client_id', 'ad_org_id', 'c_bpartner_id', 'documentno', 'grandtotal']],
      ['c_invoice', ['c_invoice_id', 'ad_client_id', 'c_bpartner_id', 'c_currency_id', 'documentno', 'grandtotal']],
      ['m_matchpo', ['m_matchpo_id', 'c_orderline_id', 'm_inoutline_id', 'm_product_id', 'qty']],
      ['m_matchinv', ['m_matchinv_id', 'c_invoiceline_id', 'm_product_id', 'qty']],
      ['c_payment', ['c_payment_id', 'c_bpartner_id', 'c_currency_id', 'documentno', 'payamt']],
    ];
    for (const [tbl, cols] of notNullChecks) {
      const info = await columnInfo(tbl);
      for (const col of cols) {
        assert.strictEqual(info[col].is_nullable, 'NO',
          `${tbl}.${col} should be NOT NULL`);
      }
    }
  });

  test('nullable columns match Oracle-era schema on optional columns', async () => {
    const nullableChecks = [
      ['m_requisition', ['description', 'help']],
      ['c_order', ['description', 'datepromised', 'poreference', 'ad_orgtrx_id']],
      ['c_invoice', ['description', 'poreference', 'currencyrate']],
      ['m_matchpo', ['description', 'c_invoiceline_id', 'pricematchdifference']],
      ['m_matchinv', ['description', 'm_inoutline_id']],
      ['c_payment', ['description', 'currencyrate', 'c_invoice_id']],
    ];
    for (const [tbl, cols] of nullableChecks) {
      const info = await columnInfo(tbl);
      for (const col of cols) {
        assert.strictEqual(info[col].is_nullable, 'YES',
          `${tbl}.${col} should be nullable`);
      }
    }
  });
});

// ─── AC 2: Index-backed queries on M_MatchPO / M_MatchInv ───

describe('AC2: match table queries are index-backed (no sequential scan)', () => {
  test('M_MatchPO: filter by c_orderline_id uses index', async () => {
    const plan = await explainPlan(
      'SELECT * FROM m_matchpo WHERE c_orderline_id = $1', [20011]);
    assert.ok(!plan.includes('Seq Scan on m_matchpo'),
      'Expected index scan on m_matchpo.c_orderline_id, got seq scan');
  });

  test('M_MatchPO: filter by m_inoutline_id uses index', async () => {
    const plan = await explainPlan(
      'SELECT * FROM m_matchpo WHERE m_inoutline_id = $1', [30011]);
    assert.ok(!plan.includes('Seq Scan on m_matchpo'),
      'Expected index scan on m_matchpo.m_inoutline_id, got seq scan');
  });

  test('M_MatchPO: filter by product uses index', async () => {
    const plan = await explainPlan(
      'SELECT * FROM m_matchpo WHERE m_product_id = $1', [400]);
    assert.ok(!plan.includes('Seq Scan on m_matchpo'),
      'Expected index scan on m_matchpo.m_product_id, got seq scan');
  });

  test('M_MatchPO: filter by date range uses index', async () => {
    const plan = await explainPlan(
      'SELECT * FROM m_matchpo WHERE datetrx BETWEEN $1 AND $2',
      ['2024-01-01', '2024-01-31']);
    assert.ok(!plan.includes('Seq Scan on m_matchpo'),
      'Expected index scan on m_matchpo.datetrx, got seq scan');
  });

  test('M_MatchInv: filter by c_invoiceline_id uses index', async () => {
    const plan = await explainPlan(
      'SELECT * FROM m_matchinv WHERE c_invoiceline_id = $1', [40011]);
    assert.ok(!plan.includes('Seq Scan on m_matchinv'),
      'Expected index scan on m_matchinv.c_invoiceline_id, got seq scan');
  });

  test('M_MatchInv: filter by product uses index', async () => {
    const plan = await explainPlan(
      'SELECT * FROM m_matchinv WHERE m_product_id = $1', [400]);
    assert.ok(!plan.includes('Seq Scan on m_matchinv'),
      'Expected index scan on m_matchinv.m_product_id, got seq scan');
  });

  test('M_MatchInv: filter by date range uses index', async () => {
    const plan = await explainPlan(
      'SELECT * FROM m_matchinv WHERE datetrx BETWEEN $1 AND $2',
      ['2024-01-01', '2024-02-28']);
    assert.ok(!plan.includes('Seq Scan on m_matchinv'),
      'Expected index scan on m_matchinv.datetrx, got seq scan');
  });

  test('indexes exist on both match tables', async () => {
    const matchPoIdx = await tableIndexes('m_matchpo');
    const matchInvIdx = await tableIndexes('m_matchinv');

    const poIdxNames = matchPoIdx.map((i) => i.indexname);
    assert.ok(poIdxNames.some((n) => n.includes('orderline')), 'M_MatchPO needs orderline index');
    assert.ok(poIdxNames.some((n) => n.includes('inoutline')), 'M_MatchPO needs inoutline index');
    assert.ok(poIdxNames.some((n) => n.includes('product')), 'M_MatchPO needs product index');
    assert.ok(poIdxNames.some((n) => n.includes('datetrx')), 'M_MatchPO needs datetrx index');

    const invIdxNames = matchInvIdx.map((i) => i.indexname);
    assert.ok(invIdxNames.some((n) => n.includes('invoiceline')), 'M_MatchInv needs invoiceline index');
    assert.ok(invIdxNames.some((n) => n.includes('product')), 'M_MatchInv needs product index');
    assert.ok(invIdxNames.some((n) => n.includes('datetrx')), 'M_MatchInv needs datetrx index');
  });
});

// ─── AC 3: Sequence semantics ────────────────────────────────

describe('AC3: document number and primary key follow sequence semantics', () => {
  test('primary key sequences exist for all 7 procurement tables', async () => {
    const { rows } = await db.query(
      `SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`,
    );
    const names = rows.map((r) => r.sequencename);
    const pkSeqs = ['m_requisition_sq', 'c_order_sq', 'm_inout_sq', 'c_invoice_sq',
      'm_matchpo_sq', 'm_matchinv_sq', 'c_payment_sq'];
    for (const sq of pkSeqs) {
      assert.ok(names.includes(sq), `PK sequence ${sq} should exist`);
    }
  });

  test('document number sequences exist', async () => {
    const { rows } = await db.query(
      `SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`,
    );
    const names = rows.map((r) => r.sequencename);
    const docSeqs = ['docno_requisition_sq', 'docno_order_sq', 'docno_inout_sq',
      'docno_invoice_sq', 'docno_payment_sq'];
    for (const sq of docSeqs) {
      assert.ok(names.includes(sq), `DocNo sequence ${sq} should exist`);
    }
  });

  test('PK sequence produces unique, incrementing IDs (MSequence.getNextID pattern)', async () => {
    const { rows: [r1] } = await db.query("SELECT nextval('c_order_sq') AS id");
    const { rows: [r2] } = await db.query("SELECT nextval('c_order_sq') AS id");
    const id1 = Number(r1.id);
    const id2 = Number(r2.id);
    assert.ok(id2 > id1, `Sequence should increment: ${id1} < ${id2}`);
    assert.strictEqual(id2 - id1, 1, 'Default increment should be 1');
  });

  test('DocNo sequence produces unique, incrementing numbers', async () => {
    const { rows: [r1] } = await db.query("SELECT nextval('docno_order_sq') AS id");
    const { rows: [r2] } = await db.query("SELECT nextval('docno_order_sq') AS id");
    assert.ok(Number(r2.id) > Number(r1.id));
  });

  test('inserting a row without explicit PK uses the sequence default', async () => {
    const { rows } = await db.query(
      `INSERT INTO m_requisition (ad_client_id, ad_org_id, createdby, updatedby,
         ad_user_id, c_doctype_id, documentno, datedoc, daterequired,
         m_pricelist_id, m_warehouse_id, totallines)
       VALUES (11, 11, 700, 700, 700, 300, 'SEQ-TEST', now(), now(), 600, 500, 0)
       RETURNING m_requisition_id`,
    );
    const id = Number(rows[0].m_requisition_id);
    assert.ok(id >= 1000000, `PK from sequence should be >= 1000000, got ${id}`);
  });
});

// ─── Golden-dataset row counts and checksums ─────────────────

describe('Golden-dataset parity', () => {
  test('row counts match expected golden dataset', async () => {
    const expected = {
      m_requisition: 2, // 1 seeded + 1 from sequence test
      c_order: 2,
      m_inout: 2,
      c_invoice: 2,
      m_matchpo: 3,
      m_matchinv: 3,
      c_payment: 2,
    };
    for (const [tbl, count] of Object.entries(expected)) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${tbl}`);
      assert.strictEqual(rows[0].n, count,
        `${tbl}: expected ${count} rows, got ${rows[0].n}`);
    }
  });

  test('amount checksums match for c_order', async () => {
    const { rows } = await db.query(
      `SELECT SUM(grandtotal) AS total FROM c_order WHERE docstatus = 'CO'`);
    assert.strictEqual(Number(rows[0].total), 3500.00);
  });

  test('amount checksums match for c_invoice', async () => {
    const { rows } = await db.query(
      `SELECT SUM(grandtotal) AS total FROM c_invoice WHERE docstatus = 'CO'`);
    assert.strictEqual(Number(rows[0].total), 3500.00);
  });

  test('quantity checksums match for m_matchpo', async () => {
    const { rows } = await db.query(
      `SELECT SUM(qty) AS total FROM m_matchpo`);
    assert.strictEqual(Number(rows[0].total), 175.00);
  });

  test('quantity checksums match for m_matchinv', async () => {
    const { rows } = await db.query(
      `SELECT SUM(qty) AS total FROM m_matchinv`);
    assert.strictEqual(Number(rows[0].total), 175.00);
  });

  test('payment checksums match for c_payment', async () => {
    const { rows } = await db.query(
      `SELECT SUM(payamt) AS total FROM c_payment WHERE docstatus = 'CO'`);
    assert.strictEqual(Number(rows[0].total), 3500.00);
  });
});
