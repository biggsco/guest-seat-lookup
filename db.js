const { Pool } = require('pg');

function parseBoolean(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['1', 'true', 'yes', 'on', 'require', 'required'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(normalized)) {
    return false;
  }

  return null;
}

function resolveSslConfig() {
  const pgSslMode = process.env.PGSSLMODE ? process.env.PGSSLMODE.trim().toLowerCase() : null;
  const dbSslToggle = parseBoolean(process.env.DB_SSL);
  const rejectUnauthorized = parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED);
  const isProduction = process.env.NODE_ENV === 'production';

  if (dbSslToggle !== null) {
    return dbSslToggle
      ? { rejectUnauthorized: rejectUnauthorized ?? false }
      : false;
  }

  if (pgSslMode) {
    if (pgSslMode === 'disable') {
      return false;
    }

    return { rejectUnauthorized: rejectUnauthorized ?? false };
  }

  if (isProduction) {
    return { rejectUnauthorized: rejectUnauthorized ?? false };
  }

  return false;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is required. Set DATABASE_URL in your environment before starting the server.'
  );
}

const pool = new Pool({
  connectionString,
  ssl: resolveSslConfig()
});

async function testDb() {
  const result = await pool.query('SELECT NOW() AS now');
  return result.rows[0];
}

module.exports = {
  pool,
  testDb
};
