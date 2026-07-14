const { pool } = require('../db');

async function ensureAdminUserTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
      allowed_venues TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Allow existing installs with NOT NULL password_hash to drop the constraint
  await pool.query('ALTER TABLE admins ALTER COLUMN password_hash DROP NOT NULL').catch(() => {});
}

async function findAdminByEmail(email) {
  const result = await pool.query(
    'SELECT id, username, is_super_admin, allowed_venues FROM admins WHERE lower(username) = lower($1)',
    [email]
  );
  return result.rows[0] || null;
}

async function upsertSuperAdminFromEnv() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  if (!email) return;

  const existing = await findAdminByEmail(email);
  if (!existing) {
    await pool.query(
      'INSERT INTO admins (username, is_super_admin) VALUES ($1, TRUE)',
      [email.toLowerCase()]
    );
    return;
  }

  if (!existing.is_super_admin) {
    await pool.query('UPDATE admins SET is_super_admin = TRUE, updated_at = NOW() WHERE id = $1', [existing.id]);
  }
}

module.exports = { ensureAdminUserTable, findAdminByEmail, upsertSuperAdminFromEnv };
