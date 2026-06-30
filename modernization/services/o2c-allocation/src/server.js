// Datadog tracer must init before other requires it instruments (express, pg).
require('./telemetry/datadog').initDatadog();
const sentry = require('./telemetry/sentry');
sentry.initSentry();

const express = require('express');
const path = require('path');
const db = require('./db');
const { migrate } = require('./migrate');
const { postAllocation, recomputeBalances } = require('./allocation');

const app = express();
app.use(express.json());
// Control-panel UI (clickable triggers for the demo).
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', service: 'o2c-allocation', bugMode: process.env.ALLOC_BUG === '1' });
  } catch (e) {
    res.status(503).json({ status: 'degraded', error: e.message });
  }
});

// List the GL effect of a posted allocation.
app.get('/allocations/:id/facts', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT f.account_id, a.acct_type, f.amtacctdr, f.amtacctcr, f.description
         FROM fact_acct f JOIN acct_element a ON a.account_id = f.account_id
        WHERE f.record_id = $1 ORDER BY f.fact_acct_id`,
      [req.params.id],
    );
    res.json({ allocationId: Number(req.params.id), facts: rows });
  } catch (e) { next(e); }
});

// Post an allocation to the GL. On a posting failure (e.g. the seeded FX
// regression) the error is captured to Sentry and the Datadog imbalance metric
// is emitted (in allocation.js). Alerting is owned by Sentry's and Datadog's own
// Slack integrations — the service never posts to Slack itself.
app.post('/allocations/:id/post', async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const result = await postAllocation(id);
    res.json(result);
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    sentry.capturePostingError(err, { allocationId: id, debit: err.debit, credit: err.credit });
    if (err.name === 'PostingNotBalancedError') {
      return res.status(422).json({ error: err.message, allocationId: id, debit: err.debit, credit: err.credit });
    }
    next(err);
  }
});

// Deliberately-slow GL reconciliation. Latency grows with ledger "size" (a
// dropped-index migration artifact); emits o2c.allocation.posting.duration that
// the Datadog latency monitor alerts on. The service does not alert itself.
app.post('/allocations/recompute', async (req, res, next) => {
  try {
    const scale = req.body && Number.isFinite(Number(req.body.scale))
      ? Number(req.body.scale) : undefined;
    const result = await recomputeBalances({ scale });
    res.json(result);
  } catch (e) { next(e); }
});

sentry.expressErrorHandler(app);
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled:', err.message);
  res.status(500).json({ error: err.message });
});

const PORT = parseInt(process.env.PORT, 10) || 3001;

async function start() {
  if (process.env.AUTO_MIGRATE !== '0') {
    await migrate();
  }
  app.listen(PORT, () => console.log(`[server] o2c-allocation listening on :${PORT}`));
}

if (require.main === module) {
  start().catch((e) => { console.error('[server] startup failed:', e.message); process.exit(1); });
}

module.exports = app;
