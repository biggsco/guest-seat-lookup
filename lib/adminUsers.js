const crypto = require('crypto');
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
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = String(storedHash || '').split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(key, 'hex'));
}

async function findUserByEmail(email) {
  const result = await pool.query('SELECT id, email, password_hash, is_super_admin FROM admin_users WHERE lower(email)=lower($1)', [email]);
  return result.rows[0] || null;
}

async function upsertSuperAdminFromEnv() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) return;

  const validationError = validatePasswordComplexity(password);
  if (validationError) {
    throw new Error(`SUPER_ADMIN_PASSWORD does not meet policy: ${validationError}`);
  }

  const existing = await findUserByEmail(email);
  if (!existing) {
    await pool.query(
      'INSERT INTO admin_users (email, password_hash, is_super_admin) VALUES ($1,$2,TRUE)',
      [email, hashPassword(password)]
    );
    return;
  }

  if (!existing.is_super_admin) {
    await pool.query('UPDATE admin_users SET is_super_admin=TRUE, updated_at=NOW() WHERE id=$1', [existing.id]);
  }
}

module.exports = { ensureAdminUserTable, validatePasswordComplexity, hashPassword, verifyPassword, findUserByEmail, upsertSuperAdminFromEnv, PASSWORD_POLICY };
