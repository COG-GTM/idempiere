const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

async function migrate() {
  const schema = fs.readFileSync(path.join(db.SQL_DIR, 'schema.sql'), 'utf8');
  const seed = fs.readFileSync(path.join(db.SQL_DIR, 'seed.sql'), 'utf8');
  await db.runSqlScript(db.pool, schema);
  await db.runSqlScript(db.pool, seed);
  console.log('[migrate] schema + seed applied.');
}

if (require.main === module) {
  migrate()
    .then(() => db.pool.end())
    .then(() => process.exit(0))
    .catch((e) => { console.error('[migrate] failed:', e.message); process.exit(1); });
}

module.exports = { migrate };
