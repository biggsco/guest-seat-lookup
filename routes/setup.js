const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, testDb } = require('../db');
const { escapeHtml, renderLayout } = require('../render');
const { formatDateTime } = require('../lib/formatting');
const { requireAdmin, requireSuperAdmin } = require('../lib/auth');
const { VENUE_OPTIONS } = require('../lib/venues');

const router = express.Router();

async function ensureInitialAdmin() {
  const username = (process.env.ADMIN_USERNAME || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '');

  const existingAdmins = await pool.query(`
    SELECT COUNT(*)::INT AS count
    FROM admins;
  `);
  const adminCount = Number(existingAdmins.rows[0]?.count || 0);

  if (adminCount > 0) {
    return { status: 'existing' };
  }

  if (!username || !password) {
    return { status: 'missing-env' };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    `
    INSERT INTO admins (username, password_hash, is_super_admin, allowed_venues)
    VALUES ($1, $2, true, $3)
    `,
    [username, passwordHash, VENUE_OPTIONS]
  );

  return { status: 'created', username };
}

async function ensureAtLeastOneSuperAdmin() {
  const result = await pool.query(`
    SELECT COUNT(*)::INT AS count
    FROM admins
    WHERE is_super_admin = true;
  `);

  if (Number(result.rows[0]?.count || 0) > 0) {
    return;
  }

  await pool.query(`
    UPDATE admins
    SET is_super_admin = true
    WHERE id = (
      SELECT id
      FROM admins
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    );
  `);
}

async function runSetupMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name TEXT,
      public_token TEXT UNIQUE,
      is_published BOOLEAN DEFAULT false,
      logo_url TEXT,
      primary_color TEXT,
      tertiary_color TEXT,
      venue TEXT,
      event_date DATE,
      last_imported_at TIMESTAMP,
      last_import_file_name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guests (
      id SERIAL PRIMARY KEY,
      event_id INTEGER REFERENCES events(id),
      full_name TEXT,
      company TEXT,
      table_name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_super_admin BOOLEAN DEFAULT false,
      allowed_venues TEXT[] DEFAULT ARRAY[]::TEXT[],
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS public_token TEXT;`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS logo_url TEXT;`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS primary_color TEXT;`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS tertiary_color TEXT;`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS venue TEXT;`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS event_date DATE;`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS last_import_file_name TEXT;`);
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();`);
  await pool.query(`ALTER TABLE guests ADD COLUMN IF NOT EXISTS company TEXT;`);
  await pool.query(`ALTER TABLE guests ADD COLUMN IF NOT EXISTS table_name TEXT;`);
  await pool.query(`ALTER TABLE guests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();`);
  await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS allowed_venues TEXT[] DEFAULT ARRAY[]::TEXT[];`);

  await pool.query(
    `
    UPDATE admins
    SET allowed_venues = $1
    WHERE is_super_admin = true
      AND (allowed_venues IS NULL OR cardinality(allowed_venues) = 0)
    `,
    [VENUE_OPTIONS]
  );

  await pool.query(`
    UPDATE events
    SET primary_color = '#1f3c88'
    WHERE primary_color IS NULL OR primary_color = '';
  `);

  await pool.query(`
    UPDATE events
    SET tertiary_color = '#eef3ff'
    WHERE tertiary_color IS NULL OR tertiary_color = '';
  `);

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS events_public_token_idx ON events(public_token);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS admins_username_idx ON admins(username);`);

  const initialAdminResult = await ensureInitialAdmin();
  await ensureAtLeastOneSuperAdmin();
  return initialAdminResult;
}

function runMiddleware(mw, req, res) {
  return new Promise((resolve, reject) => {
    mw(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function getSetupTokenFromRequest(req) {
  return String(req.get('x-setup-token') || req.query.setupToken || req.query.token || '').trim();
}

router.get('/health', async (req, res) => {
  try {
    const db = await testDb();

    res.json({
      ok: true,
      app: 'guest-seat-lookup',
      db: 'connected',
      time: db.now,
      adelaideTime: formatDateTime(db.now)
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

router.get('/setup', async (req, res) => {
  const setupToken = String(process.env.SETUP_TOKEN || '').trim();
  const providedToken = getSetupTokenFromRequest(req);
  const isProduction = process.env.NODE_ENV === 'production';

  if (!setupToken || providedToken !== setupToken) {
    if (isProduction) {
      return res.status(404).send('Not Found');
    }
    return res.status(403).send('Setup is disabled. Provide a valid setup token.');
  }

  try {
    const adminsCountResult = await pool.query('SELECT COUNT(*)::INT AS count FROM admins;');
    const adminCount = Number(adminsCountResult.rows[0]?.count || 0);

    if (adminCount > 0) {
      await runMiddleware(requireAdmin, req, res);
      if (res.headersSent) return;
      await runMiddleware(requireSuperAdmin, req, res);
      if (res.headersSent) return;
    }

    const initialAdminResult = await runSetupMigrations();
    const initialAdminMessage = initialAdminResult.status === 'created'
      ? `
        <div class="notice info" style="margin-bottom: 14px;">
          Initial super admin user <strong>${escapeHtml(initialAdminResult.username)}</strong> was created from
          <span class="code-line">ADMIN_USERNAME</span> and <span class="code-line">ADMIN_PASSWORD</span>.
        </div>
      `
      : initialAdminResult.status === 'missing-env'
        ? `
          <div class="notice warning" style="margin-bottom: 14px;">
            No admin users exist yet. Set <span class="code-line">ADMIN_USERNAME</span> and
            <span class="code-line">ADMIN_PASSWORD</span>, then re-run <span class="code-line">/setup</span>
            to create the first admin account.
          </div>
        `
        : '';

    res.send(
      renderLayout(
        'Setup Complete',
        `
          <div class="panel" style="max-width: 760px; margin: 0 auto;">
            <h1 style="margin-top: 0;">Setup Complete</h1>
            <p class="muted">Database tables, branding fields, admin auth, and session storage are ready.</p>
            ${initialAdminMessage}
            <div class="actions">
              <a class="button" href="/admin/login">Go to Admin Login</a>
            </div>
          </div>
        `
      )
    );
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

module.exports = router;
