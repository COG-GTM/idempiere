// Unit tests for db.js connection helpers (SSL/TLS for managed Postgres).
// These test the pure functions without opening real connections.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const { _test: { isLocalHostname, buildPgPoolConfig, buildDiscretePoolConfig } } = require('../src/db');

describe('isLocalHostname', () => {
  test('returns true for localhost', () => {
    assert.strictEqual(isLocalHostname('localhost'), true);
  });

  test('returns true for 127.0.0.1', () => {
    assert.strictEqual(isLocalHostname('127.0.0.1'), true);
  });

  test('returns true for ::1', () => {
    assert.strictEqual(isLocalHostname('::1'), true);
  });

  test('returns true for [::1]', () => {
    assert.strictEqual(isLocalHostname('[::1]'), true);
  });

  test('returns false for a remote host', () => {
    assert.strictEqual(isLocalHostname('db.example.com'), false);
  });

  test('returns false for empty string', () => {
    assert.strictEqual(isLocalHostname(''), false);
  });
});

describe('buildPgPoolConfig', () => {
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.DATABASE_URL = process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedEnv.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedEnv.DATABASE_URL;
  });

  test('uses DATABASE_URL as connectionString', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/mydb';
    const config = buildPgPoolConfig();
    assert.strictEqual(config.connectionString, process.env.DATABASE_URL);
  });

  test('enables SSL for non-local DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@db.neon.tech:5432/mydb';
    const config = buildPgPoolConfig();
    assert.ok(config.ssl, 'should enable SSL for remote host');
    assert.strictEqual(config.ssl.rejectUnauthorized, false);
  });

  test('does not enable SSL for localhost DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/mydb';
    const config = buildPgPoolConfig();
    assert.strictEqual(config.ssl, undefined);
  });

  test('handles unparseable DATABASE_URL gracefully', () => {
    process.env.DATABASE_URL = 'not-a-url';
    const config = buildPgPoolConfig();
    assert.strictEqual(config.connectionString, 'not-a-url');
    assert.strictEqual(config.ssl, undefined);
  });
});

describe('buildDiscretePoolConfig', () => {
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.PGHOST = process.env.PGHOST;
    savedEnv.PGPORT = process.env.PGPORT;
    savedEnv.PGUSER = process.env.PGUSER;
    savedEnv.PGPASSWORD = process.env.PGPASSWORD;
    savedEnv.PGDATABASE = process.env.PGDATABASE;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('reads from PG* env vars', () => {
    process.env.PGHOST = 'myhost';
    process.env.PGPORT = '5433';
    process.env.PGUSER = 'myuser';
    process.env.PGPASSWORD = 'mypass';
    process.env.PGDATABASE = 'mydb';
    const config = buildDiscretePoolConfig();
    assert.strictEqual(config.host, 'myhost');
    assert.strictEqual(config.port, 5433);
    assert.strictEqual(config.user, 'myuser');
    assert.strictEqual(config.password, 'mypass');
    assert.strictEqual(config.database, 'mydb');
  });

  test('uses defaults when no env vars set', () => {
    delete process.env.PGHOST;
    delete process.env.PGPORT;
    delete process.env.PGUSER;
    delete process.env.PGPASSWORD;
    delete process.env.PGDATABASE;
    const config = buildDiscretePoolConfig();
    assert.strictEqual(config.host, 'localhost');
    assert.strictEqual(config.port, 5432);
    assert.strictEqual(config.user, 'postgres');
    assert.strictEqual(config.password, 'postgres');
    assert.strictEqual(config.database, 'o2c');
  });
});
