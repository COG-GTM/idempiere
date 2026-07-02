const express = require('express');
const path = require('path');
const db = require('./db');
const { migrate } = require('./migrate');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', service: 'p2p-procurement' });
  } catch (e) {
    res.status(503).json({ status: 'degraded', error: e.message });
  }
});

app.get('/schema/tables', async (_req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    res.json({ tables: rows.map((r) => r.table_name) });
  } catch (e) { next(e); }
});

app.get('/schema/columns/:table', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT column_name, data_type, numeric_precision, numeric_scale,
              character_maximum_length, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [req.params.table],
    );
    res.json({ table: req.params.table, columns: rows });
  } catch (e) { next(e); }
});

app.get('/schema/indexes/:table', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY indexname`,
      [req.params.table],
    );
    res.json({ table: req.params.table, indexes: rows });
  } catch (e) { next(e); }
});

app.get('/sequences', async (_req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT sequencename, last_value, start_value, increment_by
         FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`,
    );
    res.json({ sequences: rows });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error('[server] unhandled:', err.message);
  res.status(500).json({ error: err.message });
});

const PORT = parseInt(process.env.PORT, 10) || 3002;

async function start() {
  if (process.env.AUTO_MIGRATE !== '0') {
    await migrate();
  }
  app.listen(PORT, () => console.log(`[server] p2p-procurement listening on :${PORT}`));
}

if (require.main === module) {
  start().catch((e) => { console.error('[server] startup failed:', e.message); process.exit(1); });
}

module.exports = app;
