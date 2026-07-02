const { Pool } = require('pg');

// Single shared pool. Connection comes from DATABASE_URL or discrete PG* vars,
// so it works both in docker-compose and against a local/CI Postgres.
function isLocalHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]';
}

function buildPoolConfig() {
  if (process.env.DATABASE_URL) {
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

  return {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT, 10) || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'o2c',
  };
}

const pool = new Pool(buildPoolConfig());

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
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

module.exports = { pool, query, withTransaction };
