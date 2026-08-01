const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SQL_DIR = path.join(__dirname, 'sql');

function isLocalHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]';
}

function shouldUseEmbeddedDb() {
  return !process.env.DATABASE_URL && (process.env.VERCEL || process.env.EMBED_DB === '1');
}

function buildPgPoolConfig() {
  const config = { connectionString: process.env.DATABASE_URL };
  try {
    const parsed = new URL(process.env.DATABASE_URL);
    if (!isLocalHostname(parsed.hostname)) {
      config.ssl = { rejectUnauthorized: false };
    }
  } catch {
    // Leave the connection string untouched if parsing fails.
  }
  return config;
}

function buildDiscretePoolConfig() {
  return {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT, 10) || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'o2c',
  };
}

let embeddedDb = null;
let embeddedInitPromise = null;

async function runSqlScript(target, sql) {
  const stripped = sql.replace(/--.*$/gm, '');
  const statements = stripped
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await target.query(statement);
  }
}

async function initializeEmbeddedDb() {
  if (!shouldUseEmbeddedDb()) return null;
  if (!embeddedInitPromise) {
    embeddedInitPromise = (async () => {
      const { PGlite } = require('@electric-sql/pglite');
      embeddedDb = new PGlite();
      const schema = fs.readFileSync(path.join(SQL_DIR, 'schema.sql'), 'utf8');
      const seed = fs.readFileSync(path.join(SQL_DIR, 'seed.sql'), 'utf8');
      await runSqlScript(embeddedDb, schema);
      await runSqlScript(embeddedDb, seed);
      return embeddedDb;
    })().catch((err) => {
      embeddedInitPromise = null;
      throw err;
    });
  }
  return embeddedInitPromise;
}

const embeddedPool = {
  async query(text, params) {
    await initializeEmbeddedDb();
    return embeddedDb.query(text, params);
  },
  async connect() {
    await initializeEmbeddedDb();
    return {
      query: (text, params) => embeddedDb.query(text, params),
      release() {},
    };
  },
  async end() {
    if (embeddedDb) {
      await embeddedDb.close();
      embeddedDb = null;
      embeddedInitPromise = null;
    }
  },
};

const pool = shouldUseEmbeddedDb()
  ? embeddedPool
  : new Pool(process.env.DATABASE_URL ? buildPgPoolConfig() : buildDiscretePoolConfig());

async function ensureReady() {
  if (shouldUseEmbeddedDb()) {
    await initializeEmbeddedDb();
  }
}

async function query(text, params) {
  await ensureReady();
  return pool.query(text, params);
}

async function withTransaction(fn) {
  await ensureReady();
  if (shouldUseEmbeddedDb()) {
    return embeddedDb.transaction(async (tx) => fn({
      query: (text, params) => tx.query(text, params),
    }));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  withTransaction,
  ensureReady,
  runSqlScript,
  isEmbeddedDb: shouldUseEmbeddedDb,
  _test: { isLocalHostname, buildPgPoolConfig, buildDiscretePoolConfig },
};
