const express = require('express');
const { renderLayout, escapeHtml } = require('../render');
const { pool } = require('../db');

const router = express.Router();

router.get('/setup', async (_req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SETUP_ROUTE !== 'true') {
    return res.status(404).send('Not found');
  }

  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name TEXT,
      public_token TEXT UNIQUE,
      venue TEXT,
      event_date DATE,
      logo_url TEXT,
      primary_color TEXT,
      tertiary_color TEXT,
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      last_imported_at TIMESTAMPTZ,
      last_import_file_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS venue TEXT');
    await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS event_date DATE');
    await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS logo_url TEXT');
    await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS primary_color TEXT');
    await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS tertiary_color TEXT');
    await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMPTZ');
    await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS last_import_file_name TEXT');

    res.status(200).send(renderLayout('Setup', '<section class="panel"><h1>Setup complete</h1><p>Schema checks ran successfully.</p></section>'));
  } catch (err) {
    res.status(500).send(renderLayout('Setup failed', `<section class="panel"><h1>Setup failed</h1><pre>${escapeHtml(err.message)}</pre></section>`));
  }
});

module.exports = router;
