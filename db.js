const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('DATABASE_URL is not set yet. Database checks will fail until it is added.');
}

const pool = new Pool({
  connectionString,
  ssl: false
});

async function testDb() {
  const result = await pool.query('SELECT NOW() AS now');
  return result.rows[0];
}

module.exports = {
  pool,
  testDb
};
