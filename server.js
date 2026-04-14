const express = require('express');
const { pool, testDb } = require('./db');

const app = express();

const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

app.use(express.json());

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Guest Seating Lookup</title>
      </head>
      <body>
        <h1>Guest Seating Lookup</h1>
        <p>Backend is running.</p>
        <ul>
          <li><a href="/search">Public Search</a></li>
          <li><a href="/admin">Admin</a></li>
          <li><a href="/health">Health</a></li>
          <li><a href="/setup">Setup Database</a></li>
          <li><a href="/seed">Seed Test Data</a></li>
        </ul>
      </body>
    </html>
  `);
});

app.get('/search', async (req, res) => {
  const q = req.query.q || '';
  let results = [];

  if (q.trim()) {
    try {
      const dbResult = await pool.query(
        `
        SELECT full_name, company, table_name, seat
        FROM guests
        WHERE event_id = 1
          AND (
            full_name ILIKE $1
            OR company ILIKE $1
          )
        ORDER BY full_name ASC
        LIMIT 20
        `,
        [`%${q}%`]
      );

      results = dbResult.rows;
    } catch (err) {
      return res.status(500).send(`
        <html>
          <body>
            <h1>Search Error</h1>
            <p>${err.message}</p>
            <a href="/search">Back</a>
          </body>
        </html>
      `);
    }
  }

  const resultsHtml = q.trim()
    ? results.length > 0
      ? `
        <h2>Results for "${q}"</h2>
        <ul>
          ${results.map(row => `
            <li>
              <strong>${row.full_name || 'No name'}</strong><br/>
              Company: ${row.company || 'N/A'}<br/>
              Table: ${row.table_name || 'N/A'}<br/>
              Seat: ${row.seat || 'N/A'}
            </li>
          `).join('')}
        </ul>
      `
      : `<p>No results found for "${q}"</p>`
    : `<p>Search by name or company</p>`;

  res.send(`
    <html>
      <head><title>Search</title></head>
      <body>
        <h1>Guest Search</h1>

        <form method="GET" action="/search">
          <input name="q" placeholder="Search name or company" value="${q.replace(/"/g, '&quot;')}" />
          <button type="submit">Search</button>
        </form>

        ${resultsHtml}

        <p><a href="/">Home</a></p>
      </body>
    </html>
  `);
});

app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';

  if (!q.trim()) return res.json([]);

  try {
    const dbResult = await pool.query(
      `
      SELECT full_name, company, table_name, seat
      FROM guests
      WHERE event_id = 1
        AND (
          full_name ILIKE $1
          OR company ILIKE $1
        )
      ORDER BY full_name ASC
      LIMIT 20
      `,
      [`%${q}%`]
    );

    res.json(dbResult.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin', (req, res) => {
  res.send(`
    <html>
      <body>
        <h1>Admin Placeholder</h1>
        <p>Coming soon</p>
      </body>
    </html>
  `);
});

app.get('/health', async (req, res) => {
  try {
    const db = await testDb();

    res.json({
      ok: true,
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

app.get('/setup', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        event_date DATE,
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
        seat TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    res.send('Tables created');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/seed', async (req, res) => {
  try {
    const event = await pool.query(`
      INSERT INTO events (name)
      VALUES ('Test Event')
      RETURNING id
    `);

    const eventId = event.rows[0].id;

    await pool.query(
      `
      INSERT INTO guests (event_id, full_name, company, table_name, seat)
      VALUES
        ($1, 'John Smith', 'Acme Corp', 'Table 1', 'A1'),
        ($1, 'Jane Doe', 'Globex', 'Table 2', 'B3'),
        ($1, 'Sarah Lee', 'BlueSky', 'Table 3', 'C2')
      `,
      [eventId]
    );

    res.send('Seeded event ' + eventId);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});
