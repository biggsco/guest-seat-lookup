const { pool } = require('../db');

async function ensureGuestSeatsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      public_token TEXT UNIQUE NOT NULL,
      event_date DATE,
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      last_imported_at TIMESTAMPTZ,
      last_import_file_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS name TEXT');
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS public_token TEXT');
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS event_date DATE');
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS last_import_file_name TEXT');
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guests (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      full_name TEXT,
      company TEXT,
      table_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS guests_event_id_idx ON guests(event_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS guests_full_name_idx ON guests(full_name)');
  await pool.query('CREATE INDEX IF NOT EXISTS guests_company_idx ON guests(company)');
}

module.exports = {
  ensureGuestSeatsTable
};
