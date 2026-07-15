const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const PASSWORD_POLICY = {
  minLength: 12,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: true
};

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

function validatePasswordComplexity(password) {
  const value = String(password || '');
  if (value.length < PASSWORD_POLICY.minLength) return `Password must be at least ${PASSWORD_POLICY.minLength} characters.`;
  if (PASSWORD_POLICY.requireUpper && !/[A-Z]/.test(value)) return 'Password must include at least one uppercase letter.';
  if (PASSWORD_POLICY.requireLower && !/[a-z]/.test(value)) return 'Password must include at least one lowercase letter.';
  if (PASSWORD_POLICY.requireDigit && !/[0-9]/.test(value)) return 'Password must include at least one number.';
  if (PASSWORD_POLICY.requireSymbol && !/[^A-Za-z0-9]/.test(value)) return 'Password must include at least one symbol.';
  return '';
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

function verifyPassword(password, storedHash) {
  return bcrypt.compareSync(password, String(storedHash || ''));
}

async function findAdminByUsername(username) {
  const result = await pool.query(
    'SELECT id, username, password_hash, is_super_admin, allowed_venues FROM admins WHERE lower(username) = lower($1)',
    [username]
  );
  return result.rows[0] || null;
}

async function upsertSuperAdminFromEnv() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email) return;

  const existing = await findAdminByUsername(email);

  if (!existing) {
    const hash = password ? hashPassword(password) : null;
    if (password) {
      const err = validatePasswordComplexity(password);
      if (err) throw new Error(`SUPER_ADMIN_PASSWORD does not meet policy: ${err}`);
    }
    await pool.query(
      'INSERT INTO admins (username, password_hash, is_super_admin) VALUES ($1, $2, TRUE)',
      [email.toLowerCase(), hash]
    );
    return;
  }

  if (!existing.is_super_admin) {
    await pool.query('UPDATE admins SET is_super_admin = TRUE, updated_at = NOW() WHERE id = $1', [existing.id]);
  }
}

module.exports = {
  ensureAdminUserTable,
  validatePasswordComplexity,
  hashPassword,
  verifyPassword,
  findAdminByUsername,
  upsertSuperAdminFromEnv,
  PASSWORD_POLICY
};
