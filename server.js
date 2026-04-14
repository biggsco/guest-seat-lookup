const express = require('express');
const { pool, testDb } = require('./db');

const app = express();

const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function generateToken() {
  return Math.random().toString(36).slice(2, 10);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
          <li><a href="/admin/events">Admin Events</a></li>
          <li><a href="/health">Health</a></li>
          <li><a href="/setup">Setup / Update Database</a></li>
          <li><a href="/admin/purge">Purge Database</a></li>
        </ul>
      </body>
    </html>
  `);
});

app.get('/search', async (req, res) => {
  const token = (req.query.event || '').trim();
  const q = (req.query.q || '').trim();

  if (!token) {
    return res.send(`
      <html>
        <head><title>Search</title></head>
        <body>
          <h1>Guest Search</h1>
          <p>Missing event token.</p>
          <p>Use a link like: <code>/search?event=abc12345</code></p>
          <p><a href="/">Home</a></p>
        </body>
      </html>
    `);
  }

  try {
    const eventResult = await pool.query(
      `
      SELECT id, name, public_token
      FROM events
      WHERE public_token = $1
        AND is_published = true
      `,
      [token]
    );

    if (eventResult.rows.length === 0) {
      return res.send(`
        <html>
          <head><title>Search</title></head>
          <body>
            <h1>Guest Search</h1>
            <p>Event not found or not published yet.</p>
            <p><a href="/">Home</a></p>
          </body>
        </html>
      `);
    }

    const event = eventResult.rows[0];
    let results = [];

    if (q) {
      const dbResult = await pool.query(
        `
        SELECT full_name, company, table_name, seat
        FROM guests
        WHERE event_id = $1
          AND (
            full_name ILIKE $2
            OR company ILIKE $2
          )
        ORDER BY full_name ASC
        LIMIT 50
        `,
        [event.id, `%${q}%`]
      );

      results = dbResult.rows;
    }

    const resultsHtml = q
      ? results.length > 0
        ? `
          <h2>Results for "${escapeHtml(q)}"</h2>
          <ul>
            ${results.map(row => `
              <li style="margin-bottom: 16px;">
                <strong>${escapeHtml(row.full_name || 'No name')}</strong><br/>
                Company: ${escapeHtml(row.company || 'N/A')}<br/>
                Table: ${escapeHtml(row.table_name || 'N/A')}<br/>
                Seat: ${escapeHtml(row.seat || 'N/A')}
              </li>
            `).join('')}
          </ul>
        `
        : `
          <h2>Results for "${escapeHtml(q)}"</h2>
          <p>No results found.</p>
        `
      : `
        <p>Search by guest name or company.</p>
      `;

    res.send(`
      <html>
        <head>
          <title>${escapeHtml(event.name)}</title>
        </head>
        <body>
          <h1>${escapeHtml(event.name)}</h1>

          <form method="GET" action="/search">
            <input type="hidden" name="event" value="${escapeHtml(event.public_token)}" />
            <input
              type="text"
              name="q"
              placeholder="Enter name or company"
              value="${escapeHtml(q)}"
            />
            <button type="submit">Search</button>
          </form>

          ${resultsHtml}

          <p><a href="/">Home</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`
      <html>
        <head><title>Search Error</title></head>
        <body>
          <h1>Search Error</h1>
          <p>${escapeHtml(err.message)}</p>
          <p><a href="/">Home</a></p>
        </body>
      </html>
    `);
  }
});

app.get('/api/search', async (req, res) => {
  const token = (req.query.event || '').trim();
  const q = (req.query.q || '').trim();

  if (!token || !q) {
    return res.json([]);
  }

  try {
    const eventResult = await pool.query(
      `
      SELECT id
      FROM events
      WHERE public_token = $1
        AND is_published = true
      `,
      [token]
    );

    if (eventResult.rows.length === 0) {
      return res.json([]);
    }

    const eventId = eventResult.rows[0].id;

    const dbResult = await pool.query(
      `
      SELECT full_name, company, table_name, seat
      FROM guests
      WHERE event_id = $1
        AND (
          full_name ILIKE $2
          OR company ILIKE $2
        )
      ORDER BY full_name ASC
      LIMIT 50
      `,
      [eventId, `%${q}%`]
    );

    res.json(dbResult.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin/events', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, name, public_token, is_published, created_at
      FROM events
      ORDER BY id DESC
      `
    );

    res.send(`
      <html>
        <head>
          <title>Admin Events</title>
        </head>
        <body>
          <h1>Events</h1>

          <p><a href="/admin/events/new">Create Event</a></p>
          <p><a href="/admin/purge">Purge Database</a></p>

          <ul>
            ${result.rows.map(e => `
              <li style="margin-bottom: 20px;">
                <strong>${escapeHtml(e.name || 'Untitled Event')}</strong><br/>
                Token: ${escapeHtml(e.public_token || '(missing)')}<br/>
                Status: ${e.is_published ? 'Published' : 'Draft'}<br/>
                <a href="/search?event=${encodeURIComponent(e.public_token || '')}">View Search</a><br/>
                <a href="/admin/events/${encodeURIComponent(e.public_token || '')}/import">Import Guests</a><br/>
                ${e.is_published
                  ? `<a href="/admin/events/${encodeURIComponent(e.public_token || '')}/unpublish">Unpublish</a>`
                  : `<a href="/admin/events/${encodeURIComponent(e.public_token || '')}/publish">Publish</a>`
                }
              </li>
            `).join('')}
          </ul>

          <p><a href="/">Home</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/admin/events/new', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Create Event</title>
      </head>
      <body>
        <h1>Create Event</h1>

        <form method="POST" action="/admin/events/new">
          <p>
            <input name="name" placeholder="Event name" required />
          </p>
          <p>
            <button type="submit">Create Event</button>
          </p>
        </form>

        <p><a href="/admin/events">Back to Events</a></p>
      </body>
    </html>
  `);
});

app.post('/admin/events/new', async (req, res) => {
  const name = (req.body.name || '').trim();

  if (!name) {
    return res.status(400).send('Event name is required');
  }

  try {
    let token = generateToken();

    for (let i = 0; i < 10; i++) {
      const existing = await pool.query(
        `SELECT id FROM events WHERE public_token = $1`,
        [token]
      );

      if (existing.rows.length === 0) {
        break;
      }

      token = generateToken();
    }

    await pool.query(
      `
      INSERT INTO events (name, public_token, is_published)
      VALUES ($1, $2, false)
      `,
      [name, token]
    );

    res.redirect('/admin/events');
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/admin/events/:token/import', async (req, res) => {
  const token = req.params.token;

  try {
    const eventResult = await pool.query(
      `
      SELECT id, name, public_token
      FROM events
      WHERE public_token = $1
      `,
      [token]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).send('Event not found');
    }

    const event = eventResult.rows[0];

    res.send(`
      <html>
        <head>
          <title>Import Guests</title>
        </head>
        <body>
          <h1>Import Guests</h1>
          <p>Event: <strong>${escapeHtml(event.name)}</strong></p>

          <p>Paste CSV with this header:</p>
          <pre>full_name,company,table_name,seat</pre>

          <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/import">
            <textarea
              name="csv"
              rows="12"
              cols="80"
              placeholder="full_name,company,table_name,seat
John Smith,Acme Corp,Table 1,A1
Jane Doe,Globex,Table 2,B3"
            ></textarea>
            <br/><br/>
            <button type="submit">Import Guests</button>
          </form>

          <p><a href="/admin/events">Back to Events</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.post('/admin/events/:token/import', async (req, res) => {
  const token = req.params.token;
  const csv = req.body.csv || '';

  try {
    const eventResult = await pool.query(
      `
      SELECT id, name
      FROM events
      WHERE public_token = $1
      `,
      [token]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).send('Invalid event');
    }

    const event = eventResult.rows[0];
    const lines = csv
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length < 2) {
      return res.send('No guest rows found. Include a header row and at least one data row.');
    }

    const rows = lines.slice(1);
    let imported = 0;

    for (const line of rows) {
      const parts = line.split(',').map(part => part.trim());

      const full_name = parts[0] || '';
      const company = parts[1] || '';
      const table_name = parts[2] || '';
      const seat = parts[3] || '';

      if (!full_name) {
        continue;
      }

      await pool.query(
        `
        INSERT INTO guests (event_id, full_name, company, table_name, seat)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [event.id, full_name, company, table_name, seat]
      );

      imported += 1;
    }

    res.send(`
      <html>
        <head>
          <title>Import Complete</title>
        </head>
        <body>
          <h1>Import Complete</h1>
          <p>Imported ${imported} guests into ${escapeHtml(event.name)}.</p>
          <p><a href="/search?event=${encodeURIComponent(token)}">Open Public Search</a></p>
          <p><a href="/admin/events">Back to Events</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/admin/events/:token/publish', async (req, res) => {
  const token = req.params.token;

  try {
    await pool.query(
      `
      UPDATE events
      SET is_published = true
      WHERE public_token = $1
      `,
      [token]
    );

    res.redirect('/admin/events');
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/admin/events/:token/unpublish', async (req, res) => {
  const token = req.params.token;

  try {
    await pool.query(
      `
      UPDATE events
      SET is_published = false
      WHERE public_token = $1
      `,
      [token]
    );

    res.redirect('/admin/events');
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/admin/purge', async (req, res) => {
  try {
    const eventCountResult = await pool.query(`SELECT COUNT(*)::int AS count FROM events`);
    const guestCountResult = await pool.query(`SELECT COUNT(*)::int AS count FROM guests`);

    const eventCount = eventCountResult.rows[0].count;
    const guestCount = guestCountResult.rows[0].count;

    res.send(`
      <html>
        <head>
          <title>Purge Database</title>
        </head>
        <body>
          <h1>Purge Database</h1>

          <p>This will delete all events and all guests.</p>
          <p>Events: ${eventCount}</p>
          <p>Guests: ${guestCount}</p>

          <form method="POST" action="/admin/purge">
            <p>Type <strong>PURGE</strong> to confirm:</p>
            <input name="confirmText" />
            <button type="submit">Purge Database</button>
          </form>

          <p><a href="/admin/events">Back to Events</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.post('/admin/purge', async (req, res) => {
  const confirmText = (req.body.confirmText || '').trim();

  if (confirmText !== 'PURGE') {
    return res.status(400).send('Purge cancelled. Type PURGE exactly.');
  }

  try {
    await pool.query('BEGIN');
    await pool.query(`DELETE FROM guests`);
    await pool.query(`DELETE FROM events`);
    await pool.query('COMMIT');

    res.send(`
      <html>
        <head>
          <title>Purge Complete</title>
        </head>
        <body>
          <h1>Purge Complete</h1>
          <p>All guests and events have been deleted.</p>
          <p><a href="/admin/events">Back to Events</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/health', async (req, res) => {
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

app.get('/setup', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        name TEXT,
        public_token TEXT UNIQUE,
        is_published BOOLEAN DEFAULT false,
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
      ADD COLUMN IF NOT EXISTS seat TEXT;
    `);

    await pool.query(`
      ALTER TABLE guests
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS events_public_token_idx
      ON events(public_token);
    `);

    res.send('Setup complete');
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
