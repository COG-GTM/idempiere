// Index parity for the O2C allocation -> GL posting path.
//
// Oracle implicitly builds an index for every PRIMARY KEY, and iDempiere's
// Oracle DDL additionally created explicit indexes on the FOREIGN KEY columns
// of the allocation posting tables. PostgreSQL indexes primary keys but does
// NOT auto-index foreign-key columns, so a naive Oracle -> PostgreSQL
// lift-and-shift silently loses them. Those missing indexes are exactly the
// sequential scans behind the gl-recon latency regression on this journey.
//
// This module is the single source of truth for the indexes the migrated
// schema must have to reach parity with the Oracle original. It can emit the
// DDL, apply it to a live connection, and verify a database against the list.

// The FK / lookup indexes the Oracle schema had on the allocation posting path.
// (Primary-key indexes are created automatically by PostgreSQL and are not
// repeated here.)
const REQUIRED_INDEXES = [
  { name: 'idx_c_allocationline_hdr', table: 'c_allocationline', columns: ['c_allocationhdr_id'] },
  { name: 'idx_c_allocationline_invoice', table: 'c_allocationline', columns: ['c_invoice_id'] },
  { name: 'idx_c_allocationline_payment', table: 'c_allocationline', columns: ['c_payment_id'] },
  { name: 'idx_c_allocationline_bpartner', table: 'c_allocationline', columns: ['c_bpartner_id'] },
  { name: 'idx_c_invoice_bpartner', table: 'c_invoice', columns: ['c_bpartner_id'] },
  { name: 'idx_c_payment_bpartner', table: 'c_payment', columns: ['c_bpartner_id'] },
  { name: 'idx_fact_acct_account', table: 'fact_acct', columns: ['account_id'] },
  // Composite index backing the conversion-rate lookup in allocation.getRate.
  { name: 'idx_c_conversion_rate_lookup', table: 'c_conversion_rate', columns: ['c_currency_id', 'c_currency_id_to', 'validfrom'] },
];

function createIndexStatement(ix) {
  return `CREATE INDEX IF NOT EXISTS ${ix.name} ON ${ix.table} (${ix.columns.join(', ')});`;
}

// Full DDL block (one CREATE INDEX per required index), idempotent.
function indexParityDDL() {
  return REQUIRED_INDEXES.map(createIndexStatement).join('\n') + '\n';
}

// Apply the parity indexes to a live connection (client or the shared pool).
async function applyIndexParity(client) {
  for (const ix of REQUIRED_INDEXES) {
    await client.query(createIndexStatement(ix));
  }
  return REQUIRED_INDEXES.length;
}

// Verify a database has every required index. Returns { ok, missing, required }.
async function checkIndexParity(client) {
  const { rows } = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`,
  );
  const present = new Set(rows.map((r) => r.indexname));
  const missing = REQUIRED_INDEXES.filter((ix) => !present.has(ix.name)).map((ix) => ix.name);
  return { ok: missing.length === 0, missing, required: REQUIRED_INDEXES.length };
}

// `node src/schema/index-parity.js` prints the DDL (handy for a DBA cutover).
if (require.main === module) {
  process.stdout.write(indexParityDDL());
}

module.exports = {
  REQUIRED_INDEXES,
  createIndexStatement,
  indexParityDDL,
  applyIndexParity,
  checkIndexParity,
};
