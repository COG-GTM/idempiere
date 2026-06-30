// Datadog wiring for the allocation slice. dd-trace auto-instruments Express +
// pg once initialized. DogStatsD emits business metrics (postings, imbalance
// failures, realized FX). All degrade gracefully when no agent is reachable.
let tracer = null;
let StatsD = null;
let dogstatsd = null;

function initDatadog() {
  const service = process.env.DD_SERVICE || 'o2c-allocation';
  const env = process.env.DD_ENV || 'prod';
  const version = process.env.DD_VERSION || '1.0.0';

  try {
    tracer = require('dd-trace');
    tracer.init({
      service,
      env,
      version,
      logInjection: true,
      hostname: process.env.DD_AGENT_HOST || 'localhost',
      port: parseInt(process.env.DD_TRACE_AGENT_PORT, 10) || 8126,
    });
  } catch {
    console.warn('[datadog] dd-trace unavailable — APM disabled.');
  }

  try {
    StatsD = require('hot-shots');
    dogstatsd = new StatsD({
      host: process.env.DD_AGENT_HOST || 'localhost',
      port: parseInt(process.env.DD_DOGSTATSD_PORT, 10) || 8125,
      prefix: 'o2c.allocation.',
      globalTags: { env, service, version },
      errorHandler(error) {
        console.warn('[dogstatsd] error:', error.message);
      },
    });
    console.log('[datadog] initialized', { service, env, version });
  } catch {
    console.warn('[datadog] hot-shots unavailable — metrics disabled.');
  }
}

function increment(metric, tags) {
  if (dogstatsd) dogstatsd.increment(metric, 1, tags);
}

function gauge(metric, value, tags) {
  if (dogstatsd) dogstatsd.gauge(metric, value, tags);
}

module.exports = { initDatadog, increment, gauge };
