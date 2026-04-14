const express = require('express');
const { pool, testDb } = require('./db');

const app = express();

const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- helper to generate token ---
function generateToken() {
  return Math.random().toString(36).substring(2, 10);
}

// --- HOME ---
app.get('/', (req, res) => {
  res.send(`
    <h1>Guest Seating Lookup</h1>
    <ul>
      <li><a href="/search">Public Search</a></li>
      <li><a href="/admin/events">Admin Events</a></li>
      <li><a href="/health">Health</a></li>
    </ul>
  `);
});

// --- SEARCH (by token) ---
app.get('/search', async (req, res) => {
  const token = req.query.event;
  const q = req.query.q || '';

  if (!token) {
    return res.send(`<p>Missing event token</p>`);
  }

  // find event
  const eventResult = await pool.query(
    `SELECT id, name FROM events WHERE public_token = $1`,
    [token]
  );

  if (eventResult.rows.length === 0) {
    return res.send(`<p>Invalid event</p>`);
  }

  const event = eventResult.rows[0];

  let results = [];

  if (q.trim()) {
    const dbResult = await pool.query(
      `
      SELECT full_name, company, table_name, seat
      FROM guests
      WHERE event_id = $1
        AND (
          full_name ILIKE $2
          OR company ILIKE $2
        )
      LIMIT 20
      `,
      [event.id, `%${q}%`]
    );

    results = dbResult.rows;
  }

  res.send(`
    <h1>${event.name}</h1>

    <form method="GET">
      <input type="hidden" name="event" value="${token}" />
      <input name="q" placeholder="Search name or company" value="${q}" />
      <button>Search</button>
    </form>

    ${
      q
        ? results.length
          ? `<ul>${results
              .map(
                (r) => `
              <li>
                <strong>${r.full_name}</strong><br/>
                ${r.company}<br/>
                Table: ${r.table_name} Seat: ${r.seat}
              </li>`
              )
              .join('')}</ul>`
          : `<p>No results</p>`
        : `<p>Enter a name to search</p>`
    }
  `);
});

// --- ADMIN: list events ---
app.get('/admin/events', async (req, res) => {
  const result = await pool.query(
    `SELECT name, public_token FROM events ORDER BY id DESC`
  );

  res.send(`
    <h1>Events</h1>

    <a href="/admin/events/new">Create Event</a>

    <ul>
      ${result.rows
        .map(
          (e) => `
        <li>
          ${e.name} —
          <a href="/search?event=${e.public_token}">View Search</a> —
          <a href="/admin/events/${e.public_token}/import">Import Guests</a>
        </li>
      `
        )
        .join('')}
    </ul>
  `);
});

// --- ADMIN: create event form ---
app.get('/admin/events/new', (req, res) => {
  res.send(`
    <h1>Create Event</h1>

    <form method="POST">
      <input name="name" placeholder="Event name" required />
      <button>Create</button>
    </form>
  `);
});

// --- ADMIN: create event ---
app.post('/admin/events/new', async (req, res) => {
  const { name } = req.body;

  const token = generateToken();

  await pool.query(
    `INSERT INTO events (name, public_token)
     VALUES ($1, $2)`,
    [name, token]
  );

  res.redirect('/admin/events');
});

// --- ADMIN: import page ---
app.get('/admin/events/:token/import', (req, res) => {
  const token = req.params.token;

  res.send(`
    <h1>Import Guests</h1>

    <p>Paste CSV:</p>

    <form method="POST">
      <textarea name="csv" rows="10" cols="50"
placeholder="full_name,company,table_name,seat
John Smith,Acme,Table 1,A1"></textarea>
      <br/>
      <button>Import</button>
    </form>
  `);
});

// --- ADMIN: handle CSV import ---
app.post('/admin/events/:token/import', async (req, res) => {
  const token = req.params.token;
  const csv = req.body.csv;

  const eventResult = await pool.query(
    `SELECT id FROM events WHERE public_token = $1`,
    [token]
  );

  if (!eventResult.rows.length) {
    return res.send('Invalid event');
  }

  const eventId = eventResult.rows[0].id;

  const lines = csv.split('\n').filter((l) => l.trim());

  // skip header
  const rows = lines.slice(1);

  for (const line of rows) {
    const [full_name, company, table_name, seat] = line.split(',');

    await pool.query(
      `
      INSERT INTO guests (event_id, full_name, company, table_name, seat)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [eventId, full_name, company, table_name, seat]
    );
  }

  res.send(`Imported ${rows.length} guests`);
});

// --- HEALTH ---
app.get('/health', async (req, res) => {
  try {
    const db = await testDb();
    res.json({ ok: true, time: db.now });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// --- SETUP (updated for token) ---
app.get('/setup', async (req, res) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name TEXT,
      public_token TEXT UNIQUE,
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
      seat TEXT
    );
  `);

  res.send('Setup complete');
});

app.listen(PORT, HOST, () => {
  console.log(`Running on ${PORT}`);
});
