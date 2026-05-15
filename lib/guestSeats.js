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

function normaliseHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function getValue(row, aliases) {
  const wanted = aliases.map(normaliseHeader);

  for (const [key, value] of Object.entries(row)) {
    if (wanted.includes(normaliseHeader(key))) {
      return String(value || '').trim();
    }
  }

  return '';
}

function parseRowsFromWorkbook(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer', raw: false });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, {
    defval: '',
    blankrows: false
  });

  const guestAliases = [
    'guest_name',
    'guest name',
    'guest',
    'name',
    'full name',
    'fullname',
    'attendee',
    'attendee name',
    'person',
    'contact',
    'first name last name'
  ];

  const tableAliases = [
    'table_name',
    'table name',
    'table',
    'table no',
    'table number',
    'table #',
    'tableno',
    'tablenumber',
    'seat',
    'seating',
    'seat/table',
    'assigned table',
    'allocation'
  ];

  return rows
    .map((row) => ({
      guestName: getValue(row, guestAliases),
      tableName: getValue(row, tableAliases)
    }))
    .filter((row) => row.guestName && row.tableName);
}

async function replaceEventSeats(eventName, seats) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM guest_seats WHERE event_name = $1', [eventName]);

    for (const seat of seats) {
      await client.query(
        'INSERT INTO guest_seats (event_name, guest_name, table_name) VALUES ($1, $2, $3)',
        [eventName, seat.guestName, seat.tableName]
      );
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

module.exports = {
  ensureGuestSeatsTable,
  parseRowsFromWorkbook,
  replaceEventSeats,
  searchGuest
};
