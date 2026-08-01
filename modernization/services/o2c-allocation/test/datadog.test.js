const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

test('agentless Datadog emits v2 series with integer types and waitUntil flush', async () => {
  const originalEnv = {
    VERCEL: process.env.VERCEL,
    DD_API_KEY: process.env.DD_API_KEY,
    DD_SITE: process.env.DD_SITE,
    DD_AGENT_HOST: process.env.DD_AGENT_HOST,
  };
  const originalFetch = global.fetch;
  const originalLoad = Module._load;
  const waitUntilCalls = [];
  const fetchCalls = [];

  try {
    process.env.VERCEL = '1';
    process.env.DD_API_KEY = 'fake';
    process.env.DD_SITE = 'datadoghq.eu';
    delete process.env.DD_AGENT_HOST;

    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === '@vercel/functions') {
        return { waitUntil: (promise) => waitUntilCalls.push(promise) };
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    global.fetch = (url, options) => {
      const promise = Promise.resolve({
        status: 202,
        ok: true,
        async json() {
          return { errors: [] };
        },
        async text() {
          return '{"errors":[]}';
        },
      });
      fetchCalls.push({ url, options, promise });
      return promise;
    };

    delete require.cache[require.resolve('../src/telemetry/datadog.js')];
    const dd = require('../src/telemetry/datadog.js');

    dd.initDatadog();
    dd.timing('posting.duration', 1234, { allocation_id: 601 });
    dd.increment('posting.success');
    dd.gauge('posting.amount', 42, { journey: 'order-to-cash' });

    assert.equal(fetchCalls.length, 3);
    assert.equal(waitUntilCalls.length, 3);

    const timingCall = fetchCalls[0];
    assert.equal(timingCall.url, 'https://api.datadoghq.eu/api/v2/series');
    assert.equal(timingCall.options.headers['DD-API-KEY'], 'fake');
    const timingSeries = JSON.parse(timingCall.options.body).series;
    assert.equal(timingSeries.length, 6);
    assert.deepEqual(
      timingSeries.map((series) => series.metric),
      [
        'o2c.allocation.posting.duration',
        'o2c.allocation.posting.duration.avg',
        'o2c.allocation.posting.duration.max',
        'o2c.allocation.posting.duration.median',
        'o2c.allocation.posting.duration.95percentile',
        'o2c.allocation.posting.duration.count',
      ],
    );
    assert.deepEqual(timingSeries.map((series) => series.type), [3, 3, 3, 3, 3, 1]);

    const incrementSeries = JSON.parse(fetchCalls[1].options.body).series;
    assert.equal(fetchCalls[1].url, 'https://api.datadoghq.eu/api/v2/series');
    assert.deepEqual(incrementSeries.map((series) => series.metric), ['o2c.allocation.posting.success']);
    assert.deepEqual(incrementSeries.map((series) => series.type), [1]);

    const gaugeSeries = JSON.parse(fetchCalls[2].options.body).series;
    assert.deepEqual(gaugeSeries.map((series) => series.metric), ['o2c.allocation.posting.amount']);
    assert.deepEqual(gaugeSeries.map((series) => series.type), [3]);

    const settled = await Promise.all(waitUntilCalls);
    assert.equal(settled.length, 3);
    assert.deepEqual(settled.map((response) => response.status), [202, 202, 202]);
    assert.equal(typeof waitUntilCalls[0].then, 'function');
  } finally {
    if (originalEnv.VERCEL === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalEnv.VERCEL;
    if (originalEnv.DD_API_KEY === undefined) delete process.env.DD_API_KEY;
    else process.env.DD_API_KEY = originalEnv.DD_API_KEY;
    if (originalEnv.DD_SITE === undefined) delete process.env.DD_SITE;
    else process.env.DD_SITE = originalEnv.DD_SITE;
    if (originalEnv.DD_AGENT_HOST === undefined) delete process.env.DD_AGENT_HOST;
    else process.env.DD_AGENT_HOST = originalEnv.DD_AGENT_HOST;
    global.fetch = originalFetch;
    Module._load = originalLoad;
    delete require.cache[require.resolve('../src/telemetry/datadog.js')];
  }
});
