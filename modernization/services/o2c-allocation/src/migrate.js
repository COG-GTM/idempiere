// Apply schema + seed. Idempotent — safe to run on every boot.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { applyIndexParity } = require('./schema/index-parity');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'sql', 'schema.sql'), 'utf8');
  const seed = fs.readFileSync(path.join(__dirname, 'sql', 'seed.sql'), 'utf8');
  await db.query(schema);
  await db.query(seed);
  const indexes = await applyIndexParity(db);
  console.log(`[migrate] schema + seed applied; ${indexes} parity indexes ensured.`);
}

if (require.main === module) {
  migrate()
    .then(() => db.pool.end())
    .then(() => process.exit(0))
    .catch((e) => { console.error('[migrate] failed:', e.message); process.exit(1); });
}

module.exports = { migrate };
