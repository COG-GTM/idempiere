// Sentry wiring for the allocation slice. Mirrors the event-driven-devin
// pattern: if SENTRY_DSN is absent the SDK is a no-op so the service still runs
// (e.g. in CI) — errors just aren't shipped. DSNs are never logged.
let Sentry = null;
try {
  Sentry = require('@sentry/node');
} catch {
  Sentry = null;
}

let enabled = false;

function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!Sentry || !dsn) {
    console.warn('[sentry] SENTRY_DSN not set — Sentry disabled (service still runs).');
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || 'prod',
    release: process.env.SENTRY_RELEASE || 'o2c-allocation@1.0.0',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.2),
  });
  enabled = true;
  console.log('[sentry] initialized');
}

// Capture an exception with structured context about the failing posting.
function capturePostingError(err, context) {
  if (!enabled || !Sentry) return null;
  return Sentry.withScope((scope) => {
    scope.setTag('journey', 'order-to-cash');
    scope.setTag('step', 'allocation-posting');
    if (context) scope.setContext('allocation', context);
    return Sentry.captureException(err);
  });
}

function expressErrorHandler(app) {
  if (enabled && Sentry?.setupExpressErrorHandler) {
    Sentry.setupExpressErrorHandler(app);
  }
}

module.exports = { initSentry, capturePostingError, expressErrorHandler, isEnabled: () => enabled };
