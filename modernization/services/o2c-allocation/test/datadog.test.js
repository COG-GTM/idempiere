// Unit tests for the agentless Datadog telemetry layer (no agent/DB required).
const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

// We need to isolate module state between tests, so we re-require after
// clearing the module cache each time.
function freshRequire() {
  const modulePath = require.resolve('../src/telemetry/datadog');
  delete require.cache[modulePath];
  return require(modulePath);
}

// ── Internal helpers (exported via _test) ────────────────────────────

describe('normalizeTagValue', () => {
  const { _test: { normalizeTagValue } } = freshRequire();

  test('returns empty string for null', () => {
    assert.strictEqual(normalizeTagValue(null), '');
  });

  test('returns empty string for undefined', () => {
    assert.strictEqual(normalizeTagValue(undefined), '');
  });

  test('converts number to string', () => {
    assert.strictEqual(normalizeTagValue(42), '42');
  });

  test('passes through strings', () => {
    assert.strictEqual(normalizeTagValue('prod'), 'prod');
  });
});

describe('tagsToArray', () => {
  const { _test: { tagsToArray } } = freshRequire();

  test('returns empty array for falsy input', () => {
    assert.deepStrictEqual(tagsToArray(null), []);
    assert.deepStrictEqual(tagsToArray(undefined), []);
    assert.deepStrictEqual(tagsToArray(''), []);
  });

  test('maps array elements through String', () => {
    assert.deepStrictEqual(tagsToArray(['env:prod', 42]), ['env:prod', '42']);
  });

  test('converts object to key:value pairs', () => {
    const result = tagsToArray({ env: 'prod', version: '1.0' });
    assert.deepStrictEqual(result, ['env:prod', 'version:1.0']);
  });

  test('handles null values in object tags', () => {
    const result = tagsToArray({ env: null });
    assert.deepStrictEqual(result, ['env:']);
  });
});

describe('buildSeries', () => {
  const { _test: { buildSeries } } = freshRequire();

  test('produces a valid Datadog series payload', () => {
    const series = buildSeries('posting.count', 'count', 1, { env: 'test' });
    assert.strictEqual(series.metric, 'o2c.allocation.posting.count');
    assert.strictEqual(series.type, 'count');
    assert.strictEqual(series.points.length, 1);
    assert.strictEqual(series.points[0].value, 1);
    assert.ok(series.tags.includes('env:test'));
  });
});

// ── Agentless mode integration ───────────────────────────────────────

describe('agentless mode', () => {
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.VERCEL = process.env.VERCEL;
    savedEnv.DD_API_KEY = process.env.DD_API_KEY;
    savedEnv.DD_AGENT_HOST = process.env.DD_AGENT_HOST;
    savedEnv.DD_SITE = process.env.DD_SITE;
    savedEnv.DD_SERVICE = process.env.DD_SERVICE;
    savedEnv.DD_ENV = process.env.DD_ENV;
    savedEnv.DD_VERSION = process.env.DD_VERSION;
    // Force agentless: set VERCEL, clear agent host
    process.env.VERCEL = '1';
    delete process.env.DD_AGENT_HOST;
    process.env.DD_API_KEY = 'test-key';
    process.env.DD_SITE = 'datadoghq.com';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('initDatadog sets agentless mode when VERCEL is set', () => {
    const dd = freshRequire();
    dd.initDatadog();
    // Agentless = no dd-trace / hot-shots loaded. Verify by calling
    // increment/gauge/timing without crashing (they should hit the HTTP path).
    // We mock fetch to capture what's sent.
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true };
    };
    try {
      dd.increment('posting.count', { status: 'ok' });
      dd.gauge('posting.imbalance', 0, { alloc: '600' });
      dd.timing('posting.duration', 123, { alloc: '600' });
      // Verify fetch was called with the HTTP intake URL
      assert.ok(calls.length >= 3, `expected >= 3 fetch calls, got ${calls.length}`);
      for (const call of calls) {
        assert.ok(call.url.includes('api.datadoghq.com/api/v2/series'));
        assert.strictEqual(call.opts.method, 'POST');
        assert.strictEqual(call.opts.headers['DD-API-KEY'], 'test-key');
        const body = JSON.parse(call.opts.body);
        assert.ok(Array.isArray(body.series));
        assert.ok(body.series[0].metric.startsWith('o2c.allocation.'));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('timing emits base metric plus percentile suffixes', () => {
    const dd = freshRequire();
    dd.initDatadog();
    const bodies = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return { ok: true };
    };
    try {
      dd.timing('posting.duration', 250, {});
      assert.strictEqual(bodies.length, 1);
      const metrics = bodies[0].series.map((s) => s.metric);
      assert.ok(metrics.includes('o2c.allocation.posting.duration'));
      assert.ok(metrics.includes('o2c.allocation.posting.duration.avg'));
      assert.ok(metrics.includes('o2c.allocation.posting.duration.max'));
      assert.ok(metrics.includes('o2c.allocation.posting.duration.median'));
      assert.ok(metrics.includes('o2c.allocation.posting.duration.95percentile'));
      assert.ok(metrics.includes('o2c.allocation.posting.duration.count'));
      // .count should be 1, others should be the duration value
      const countSeries = bodies[0].series.find((s) => s.metric.endsWith('.count'));
      assert.strictEqual(countSeries.points[0].value, 1);
      const avgSeries = bodies[0].series.find((s) => s.metric.endsWith('.avg'));
      assert.strictEqual(avgSeries.points[0].value, 250);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('postSeries skips when DD_API_KEY is unset', () => {
    delete process.env.DD_API_KEY;
    const dd = freshRequire();
    dd.initDatadog();
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls.push(1); return { ok: true }; };
    try {
      dd.increment('posting.count', {});
      assert.strictEqual(calls.length, 0, 'should not call fetch without API key');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('non-agentless mode (no VERCEL, no DD_API_KEY)', () => {
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.VERCEL = process.env.VERCEL;
    savedEnv.DD_API_KEY = process.env.DD_API_KEY;
    savedEnv.DD_AGENT_HOST = process.env.DD_AGENT_HOST;
    delete process.env.VERCEL;
    delete process.env.DD_API_KEY;
    delete process.env.DD_AGENT_HOST;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('initDatadog gracefully handles missing dd-trace/hot-shots', () => {
    const dd = freshRequire();
    // Should not throw even if dd-trace or hot-shots fail to load
    dd.initDatadog();
    // increment/gauge/timing should be no-ops (no agent, not agentless)
    dd.increment('test', {});
    dd.gauge('test', 1, {});
    dd.timing('test', 100, {});
  });
});
