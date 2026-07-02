const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SQL_DIR = path.join(__dirname, 'sql');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT, 10) || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'p2p',
});

async function runSqlScript(target, sql) {
  const stripped = sql.replace(/--.*$/gm, '');
  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await target.query(statement);
  }
}

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query, runSqlScript, SQL_DIR };
