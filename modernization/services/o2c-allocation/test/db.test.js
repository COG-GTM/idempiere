const { test, after } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');

after(async () => { await db.pool.end(); });

test('runSqlScript strips SQL comments before execution', async () => {
  await db.ensureReady();
  await db.runSqlScript(db.pool, `
    -- this is a comment
    SELECT 1;
    -- another comment
    SELECT 2
  `);
});

test('runSqlScript handles empty input gracefully', async () => {
  await db.ensureReady();
  await db.runSqlScript(db.pool, '');
  await db.runSqlScript(db.pool, '-- only comments');
});

test('query delegates to the active pool', async () => {
  const { rows } = await db.query('SELECT 1 AS n');
  assert.strictEqual(Number(rows[0].n), 1);
});

test('withTransaction commits on success', async () => {
  const result = await db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT 42 AS answer');
    return Number(rows[0].answer);
  });
  assert.strictEqual(result, 42);
});

test('withTransaction rolls back on error (embedded mode)', async () => {
  await assert.rejects(
    () => db.withTransaction(async () => { throw new Error('boom'); }),
    { message: 'boom' },
  );
});

test('pool.connect returns a client with query and release', async () => {
  const client = await db.pool.connect();
  assert.ok(typeof client.query === 'function');
  assert.ok(typeof client.release === 'function');
  const { rows } = await client.query('SELECT 99 AS v');
  assert.strictEqual(Number(rows[0].v), 99);
  client.release();
});

test('isEmbeddedDb returns true in embedded mode', () => {
  assert.strictEqual(db.isEmbeddedDb(), true);
});

test('isLocalHostname recognises loopback addresses', () => {
  const { isLocalHostname } = db._testOnly;
  assert.strictEqual(isLocalHostname('localhost'), true);
  assert.strictEqual(isLocalHostname('127.0.0.1'), true);
  assert.strictEqual(isLocalHostname('::1'), true);
  assert.strictEqual(isLocalHostname('[::1]'), true);
  assert.strictEqual(isLocalHostname('example.com'), false);
});

test('buildDiscretePoolConfig returns defaults when env is empty', () => {
  const { buildDiscretePoolConfig } = db._testOnly;
  const cfg = buildDiscretePoolConfig();
  assert.strictEqual(cfg.user, process.env.PGUSER || 'postgres');
  assert.strictEqual(typeof cfg.port, 'number');
});

test('buildPgPoolConfig adds SSL for non-local hosts', () => {
  const { buildPgPoolConfig } = db._testOnly;
  const saved = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/mydb';
    const cfg = buildPgPoolConfig();
    assert.deepStrictEqual(cfg.ssl, { rejectUnauthorized: false });
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

test('buildPgPoolConfig skips SSL for localhost', () => {
  const { buildPgPoolConfig } = db._testOnly;
  const saved = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/mydb';
    const cfg = buildPgPoolConfig();
    assert.strictEqual(cfg.ssl, undefined);
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

test('createPool returns embeddedPool when in embedded mode', () => {
  const { createPool } = db._testOnly;
  const p = createPool();
  assert.ok(typeof p.query === 'function');
  assert.ok(typeof p.connect === 'function');
  assert.ok(typeof p.end === 'function');
});

test('createPool returns a pg Pool when not in embedded mode', () => {
  const { createPool } = db._testOnly;
  const savedEmbed = process.env.EMBED_DB;
  const savedVercel = process.env.VERCEL;
  try {
    delete process.env.EMBED_DB;
    delete process.env.VERCEL;
    const p = createPool();
    assert.ok(p.constructor.name === 'Pool' || p.constructor.name === 'BoundPool');
    p.end();
  } finally {
    if (savedEmbed !== undefined) process.env.EMBED_DB = savedEmbed;
    if (savedVercel !== undefined) process.env.VERCEL = savedVercel;
  }
});
