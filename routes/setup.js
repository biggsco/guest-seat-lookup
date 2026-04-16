const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, testDb } = require('../db');
const { escapeHtml, renderLayout } = require('../render');
const { formatDateTime } = require('../lib/formatting');

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
    INSERT INTO admins (username, password_hash, is_super_admin)
    VALUES ($1, $2, true)
    `,
    [username, passwordHash]
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
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        name TEXT,
        public_token TEXT UNIQUE,
        is_published BOOLEAN DEFAULT false,
        logo_url TEXT,
        primary_color TEXT,
        tertiary_color TEXT,
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
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS public_token TEXT;
    `);

    await pool.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false;
    `);

    await pool.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS logo_url TEXT;
    `);

    await pool.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS primary_color TEXT;
    `);

    await pool.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS tertiary_color TEXT;
    `);

    await pool.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS event_date DATE;
    `);

    await pool.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMP;
    `);

    await pool.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS last_import_file_name TEXT;
    `);

    await pool.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    `);

    await pool.query(`
      ALTER TABLE guests
      ADD COLUMN IF NOT EXISTS company TEXT;
    `);

    await pool.query(`
      ALTER TABLE guests
      ADD COLUMN IF NOT EXISTS table_name TEXT;
    `);

    await pool.query(`
      ALTER TABLE guests
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    `);

    await pool.query(`
      ALTER TABLE admins
      ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false;
    `);

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

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS events_public_token_idx
      ON events(public_token);
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS admins_username_idx
      ON admins(username);
    `);

    const initialAdminResult = await ensureInitialAdmin();
    await ensureAtLeastOneSuperAdmin();
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
