// Datadog wiring for the allocation slice. dd-trace auto-instruments Express +
// pg once initialized. DogStatsD emits business metrics (postings, imbalance
// failures, realized FX). In agentless mode we use the HTTP intake directly.
let tracer = null;
let StatsD = null;
let dogstatsd = null;
let agentless = false;
let baseTags = {};
let baseTagArray = [];
let metricPrefix = 'o2c.allocation.';
let waitUntil = null;

try {
  ({ waitUntil } = require('@vercel/functions'));
} catch {
  waitUntil = null;
}

function normalizeTagValue(value) {
  if (value == null) return '';
  return String(value);
}

function tagsToArray(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((tag) => String(tag));
  return Object.entries(tags).map(([key, value]) => `${key}:${normalizeTagValue(value)}`);
}

function buildSeries(metric, type, value, tags) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    metric: `${metricPrefix}${metric}`,
    type,
    points: [{ timestamp, value }],
    tags: [...baseTagArray, ...tagsToArray(tags)],
  };
}

function postSeries(series) {
  if (!process.env.DD_API_KEY) return;
  const site = process.env.DD_SITE || 'datadoghq.com';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const request = fetch(`https://api.${site}/api/v2/series`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'DD-API-KEY': process.env.DD_API_KEY,
    },
    body: JSON.stringify({ series }),
    signal: controller.signal,
  })
    .catch((error) => {
      console.warn('[datadog] HTTP intake error:', error.message);
    })
    .finally(() => clearTimeout(timeout));
  if (process.env.VERCEL && typeof waitUntil === 'function') {
    try {
      waitUntil(request);
    } catch {
      // Fall back to the current fire-and-forget behavior if the runtime refuses.
    }
  }
}

const SERIES_TYPE = {
  unspecified: 0,
  count: 1,
  rate: 2,
  gauge: 3,
};

function emitAgentless(metric, type, value, tags, { timing = false } = {}) {
  const series = [buildSeries(metric, type, value, tags)];
  if (timing) {
    const suffixes = ['.avg', '.max', '.median', '.95percentile', '.count'];
    for (const suffix of suffixes) {
      series.push(buildSeries(`${metric}${suffix}`, suffix === '.count' ? SERIES_TYPE.count : SERIES_TYPE.gauge, suffix === '.count' ? 1 : value, tags));
    }
  }
  postSeries(series);
}

function initDatadog() {
  const service = process.env.DD_SERVICE || 'o2c-allocation';
  const env = process.env.DD_ENV || 'prod';
  const version = process.env.DD_VERSION || '1.0.0';

  baseTags = { env, service, version };
  baseTagArray = tagsToArray(baseTags);
  metricPrefix = 'o2c.allocation.';
  agentless = Boolean(process.env.VERCEL) || (Boolean(process.env.DD_API_KEY) && !process.env.DD_AGENT_HOST);

  if (agentless) {
    tracer = null;
    StatsD = null;
    dogstatsd = null;
    console.log('[datadog] agentless initialized', { service, env, version });
    return;
  }

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
      prefix: metricPrefix,
      globalTags: baseTags,
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
  if (dogstatsd) {
    dogstatsd.increment(metric, 1, tags);
    return;
  }
  if (agentless) emitAgentless(metric, SERIES_TYPE.count, 1, tags);
}

function gauge(metric, value, tags) {
  if (dogstatsd) {
    dogstatsd.gauge(metric, value, tags);
    return;
  }
  if (agentless) emitAgentless(metric, SERIES_TYPE.gauge, value, tags);
}

// Histogram timing (ms). Datadog derives .avg/.95percentile/.max from this,
// which the latency monitor alerts on.
function timing(metric, valueMs, tags) {
  if (dogstatsd) {
    dogstatsd.timing(metric, valueMs, tags);
    return;
  }
  if (agentless) emitAgentless(metric, SERIES_TYPE.gauge, valueMs, tags, { timing: true });
}

module.exports = { initDatadog, increment, gauge, timing };
