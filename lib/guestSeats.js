const { pool } = require('../db');
const xlsx = require('xlsx');

async function ensureGuestSeatsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_seats (
      id SERIAL PRIMARY KEY,
      event_name TEXT NOT NULL,
      guest_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function parseRowsFromWorkbook(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(firstSheet, { defval: '' });

  return rows
    .map((row) => ({
      guestName: String(row.guest_name || row.guest || row.name || row.Guest || row.Name || '').trim(),
      tableName: String(row.table_name || row.table || row.Table || '').trim()
    }))
    .filter((r) => r.guestName && r.tableName);
}

async function replaceEventSeats(eventName, seats) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM guest_seats WHERE event_name = $1', [eventName]);
    for (const seat of seats) {
      await client.query('INSERT INTO guest_seats (event_name, guest_name, table_name) VALUES ($1,$2,$3)', [eventName, seat.guestName, seat.tableName]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function searchGuest(guestName) {
  const q = `%${guestName.toLowerCase()}%`;
  const result = await pool.query(
    'SELECT event_name, guest_name, table_name FROM guest_seats WHERE lower(guest_name) LIKE $1 ORDER BY event_name, guest_name LIMIT 50',
    [q]
  );
  return result.rows;
}

module.exports = { ensureGuestSeatsTable, parseRowsFromWorkbook, replaceEventSeats, searchGuest };
