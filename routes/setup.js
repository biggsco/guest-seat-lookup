const express = require('express');
const { pool, testDb } = require('../db');
const { escapeHtml, renderLayout } = require('../render');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    const db = await testDb();

    res.json({
      ok: true,
      app: 'guest-seat-lookup',
      db: 'connected',
      time: db.now
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

    res.send(
      renderLayout(
        'Setup Complete',
        `
          <div class="panel" style="max-width: 760px; margin: 0 auto;">
            <h1 style="margin-top: 0;">Setup Complete</h1>
            <p class="muted">Database tables, branding fields, admin auth, and session storage are ready.</p>
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
