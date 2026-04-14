const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');
const { pool, testDb } = require('./db');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadSessions = new Map();

function generateToken() {
  return Math.random().toString(36).slice(2, 10);
}

function generateUploadToken() {
  return crypto.randomBytes(12).toString('hex');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeCell(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function formatDateTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function detectColumnIndex(headers, keywords) {
  const lowered = headers.map(h => String(h || '').toLowerCase().trim());

  for (const keyword of keywords) {
    const exactIndex = lowered.findIndex(h => h === keyword);
    if (exactIndex !== -1) return exactIndex;
  }

  for (const keyword of keywords) {
    const containsIndex = lowered.findIndex(h => h.includes(keyword));
    if (containsIndex !== -1) return containsIndex;
  }

  return '';
}

function parseWorkbookFromBuffer(fileBuffer, originalName) {
  const workbook = XLSX.read(fileBuffer, {
    type: 'buffer',
    raw: false
  });

  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error('No sheet found in uploaded file');
  }

  const worksheet = workbook.Sheets[firstSheetName];

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    defval: ''
  });

  if (!rows.length) {
    throw new Error('The uploaded file is empty');
  }

  const headers = rows[0].map((cell, index) => {
    const value = normalizeCell(cell);
    return value || `Column ${index + 1}`;
  });

  const dataRows = rows.slice(1).map(row => {
    const normalized = headers.map((_, index) => normalizeCell(row[index]));
    return normalized;
  });

  const nonEmptyRows = dataRows.filter(row =>
    row.some(cell => String(cell).trim() !== '')
  );

  return {
    originalName,
    firstSheetName,
    headers,
    rows: nonEmptyRows
  };
}

function renderLayout(title, body, options = {}) {
  const pageTitle = escapeHtml(title || 'Event Seating');
  const fullWidth = options.fullWidth ? 'container wide' : 'container';

  return `
    <html>
      <head>
        <title>${pageTitle}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          :root {
            --bg: #f5f7fb;
            --panel: #ffffff;
            --text: #172033;
            --muted: #5f6b85;
            --border: #dbe2ee;
            --primary: #2457ff;
            --primary-dark: #1945d8;
            --success: #18794e;
            --success-bg: #eaf8f0;
            --warning: #9a6700;
            --warning-bg: #fff4d6;
            --danger: #b42318;
            --danger-bg: #fef3f2;
            --shadow: 0 12px 36px rgba(18, 35, 66, 0.08);
            --radius: 18px;
          }

          * { box-sizing: border-box; }

          body {
            margin: 0;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: linear-gradient(180deg, #f8faff 0%, #f3f6fb 100%);
            color: var(--text);
          }

          a {
            color: var(--primary);
            text-decoration: none;
          }

          a:hover {
            text-decoration: underline;
          }

          .container {
            max-width: 1060px;
            margin: 0 auto;
            padding: 32px 20px 56px;
          }

          .container.wide {
            max-width: 1240px;
          }

          .hero {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 24px;
            margin-bottom: 28px;
            flex-wrap: wrap;
          }

          .hero h1 {
            margin: 0 0 10px;
            font-size: 36px;
            line-height: 1.05;
            letter-spacing: -0.03em;
          }

          .hero p {
            margin: 0;
            color: var(--muted);
            font-size: 16px;
            line-height: 1.6;
            max-width: 760px;
          }

          .panel {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            padding: 22px;
            margin-bottom: 20px;
          }

          .panel h2,
          .panel h3 {
            margin-top: 0;
            letter-spacing: -0.02em;
          }

          .panel p:last-child {
            margin-bottom: 0;
          }

          .grid {
            display: grid;
            gap: 18px;
          }

          .grid.cards {
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          }

          .grid.two {
            grid-template-columns: 1.3fr 0.9fr;
          }

          @media (max-width: 900px) {
            .grid.two {
              grid-template-columns: 1fr;
            }
          }

          .card {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            padding: 22px;
          }

          .muted {
            color: var(--muted);
          }

          .small {
            font-size: 14px;
          }

          .badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 7px 12px;
            border-radius: 999px;
            font-size: 13px;
            font-weight: 700;
          }

          .badge.draft {
            background: var(--warning-bg);
            color: var(--warning);
          }

          .badge.published {
            background: var(--success-bg);
            color: var(--success);
          }

          .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 14px;
            margin-top: 18px;
          }

          .stat {
            background: #f8faff;
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 16px;
          }

          .stat-label {
            color: var(--muted);
            font-size: 13px;
            margin-bottom: 8px;
          }

          .stat-value {
            font-size: 24px;
            font-weight: 800;
            letter-spacing: -0.03em;
          }

          .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 18px;
          }

          .button,
          button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            min-height: 42px;
            padding: 0 16px;
            border: none;
            border-radius: 12px;
            background: var(--primary);
            color: white;
            font-weight: 700;
            font-size: 14px;
            cursor: pointer;
            box-shadow: none;
          }

          .button:hover,
          button:hover {
            background: var(--primary-dark);
            text-decoration: none;
          }

          .button.secondary {
            background: white;
            color: var(--text);
            border: 1px solid var(--border);
          }

          .button.secondary:hover {
            background: #f8faff;
          }

          .button.success {
            background: var(--success);
          }

          .button.success:hover {
            background: #0f6a42;
          }

          .button.danger,
          .danger-zone button {
            background: var(--danger);
          }

          .button.danger:hover,
          .danger-zone button:hover {
            background: #912018;
          }

          form.inline {
            display: inline;
          }

          label {
            display: block;
            font-size: 14px;
            font-weight: 700;
            margin-bottom: 8px;
          }

          input[type="text"],
          input[type="file"],
          textarea,
          select {
            width: 100%;
            min-height: 46px;
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 12px 14px;
            font-size: 15px;
            background: white;
            color: var(--text);
          }

          textarea {
            min-height: 140px;
            resize: vertical;
          }

          input[type="text"]:focus,
          input[type="file"]:focus,
          textarea:focus,
          select:focus {
            outline: 3px solid rgba(36, 87, 255, 0.14);
            border-color: var(--primary);
          }

          .field {
            margin-bottom: 16px;
          }

          .field-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 16px;
          }

          .search-shell {
            max-width: 760px;
            margin: 0 auto;
          }

          .search-card {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 24px;
            box-shadow: var(--shadow);
            padding: 28px;
          }

          .search-card h1 {
            margin: 0 0 10px;
            font-size: 34px;
            letter-spacing: -0.03em;
          }

          .search-form {
            display: flex;
            gap: 12px;
            margin-top: 20px;
            margin-bottom: 10px;
            flex-wrap: wrap;
          }

          .search-form input[type="text"] {
            flex: 1 1 280px;
          }

          .results-list {
            display: grid;
            gap: 14px;
            margin-top: 18px;
          }

          .result-card {
            padding: 18px;
            border: 1px solid var(--border);
            border-radius: 16px;
            background: #fbfcff;
          }

          .result-card h3 {
            margin: 0 0 8px;
            font-size: 19px;
          }

          .table-wrap {
            overflow-x: auto;
            border: 1px solid var(--border);
            border-radius: 16px;
            background: white;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            background: white;
          }

          th, td {
            text-align: left;
            padding: 12px 14px;
            border-bottom: 1px solid var(--border);
            vertical-align: top;
            font-size: 14px;
          }

          th {
            font-size: 13px;
            color: var(--muted);
            background: #f8faff;
            font-weight: 800;
            letter-spacing: 0.01em;
          }

          tr:last-child td {
            border-bottom: none;
          }

          .event-card-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 14px;
          }

          .event-card-title {
            margin: 0;
            font-size: 22px;
            letter-spacing: -0.02em;
          }

          .event-meta {
            display: grid;
            gap: 8px;
            margin-top: 12px;
            font-size: 14px;
            color: var(--muted);
          }

          .code-line {
            display: inline-block;
            background: #f4f7ff;
            border: 1px solid var(--border);
            color: #29416e;
            border-radius: 10px;
            padding: 6px 10px;
            font-size: 13px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          }

          .empty-state {
            text-align: center;
            padding: 40px 24px;
            border: 1px dashed var(--border);
            border-radius: 18px;
            color: var(--muted);
            background: rgba(255,255,255,0.7);
          }

          .notice {
            border-radius: 14px;
            padding: 14px 16px;
            margin-bottom: 16px;
            font-size: 14px;
          }

          .notice.info {
            background: #eef4ff;
            color: #29416e;
            border: 1px solid #cfe0ff;
          }

          .notice.warning {
            background: var(--warning-bg);
            color: var(--warning);
            border: 1px solid #f2d38a;
          }

          .notice.danger {
            background: var(--danger-bg);
            color: var(--danger);
            border: 1px solid #f7c9c5;
          }

          .danger-zone {
            border: 1px solid #f3c6c3;
            background: #fff8f7;
            border-radius: 18px;
            padding: 18px;
          }

          .top-nav {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 20px;
          }

          .top-nav a {
            display: inline-flex;
            align-items: center;
            min-height: 38px;
            padding: 0 12px;
            border-radius: 999px;
            background: white;
            border: 1px solid var(--border);
            color: var(--text);
            font-size: 14px;
            font-weight: 700;
          }

          .top-nav a:hover {
            background: #f8faff;
            text-decoration: none;
          }

          .footer-link {
            margin-top: 18px;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="${fullWidth}">
          ${body}
        </div>
      </body>
    </html>
  `;
}

function renderTopNav(links = []) {
  return `
    <div class="top-nav">
      ${links.map(link => `
        <a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>
      `).join('')}
    </div>
  `;
}

async function getEventByToken(token) {
  const result = await pool.query(
    `
    SELECT
      e.id,
      e.name,
      e.public_token,
      e.is_published,
      e.created_at,
      e.last_imported_at,
      e.last_import_file_name,
      COUNT(g.id)::int AS guest_count
    FROM events e
    LEFT JOIN guests g ON g.event_id = e.id
    WHERE e.public_token = $1
    GROUP BY
      e.id,
      e.name,
      e.public_token,
      e.is_published,
      e.created_at,
      e.last_imported_at,
      e.last_import_file_name
    `,
    [token]
  );

  return result.rows[0] || null;
}

function renderSearchPage(event, q, results) {
  const resultsHtml = q
    ? results.length > 0
      ? `
        <div class="results-list">
          ${results.map(row => `
            <div class="result-card">
              <h3>${escapeHtml(row.full_name || 'No name')}</h3>
              <div class="muted">${escapeHtml(row.company || 'No company')}</div>
              <div style="margin-top: 10px;"><strong>Table:</strong> ${escapeHtml(row.table_name || 'Not assigned')}</div>
            </div>
          `).join('')}
        </div>
      `
      : `
        <div class="empty-state" style="margin-top: 18px;">
          No results found for <strong>${escapeHtml(q)}</strong>.
        </div>
      `
    : `
      <div class="notice info" style="margin-top: 18px;">
        Search by guest name or company.
      </div>
    `;

  return renderLayout(
    event.name,
    `
      <div class="search-shell">
        <div class="search-card">
          <div class="muted small" style="margin-bottom: 8px;">Guest seating lookup</div>
          <h1>${escapeHtml(event.name)}</h1>
          <p class="muted" style="margin: 0 0 8px;">
            Search your name or company to find your assigned table.
          </p>

          <form method="GET" action="/e/${encodeURIComponent(event.public_token)}" class="search-form">
            <input
              type="text"
              name="q"
              placeholder="Enter guest name or company"
              value="${escapeHtml(q)}"
              autofocus
            />
            <button type="submit">Search</button>
          </form>

          ${resultsHtml}
        </div>
      </div>
    `
  );
}

app.get('/', (req, res) => {
  res.send(
    renderLayout(
      'Guest Seating Lookup',
      `
        <div class="hero">
          <div>
            <h1>Guest Seating Lookup</h1>
            <p>
              Upload event guest lists, map columns from CSV or Excel files, publish events,
              and let guests search their table assignment through a public event link.
            </p>
          </div>
        </div>

        <div class="grid cards">
          <div class="card">
            <h2>Admin</h2>
            <p class="muted">Create events, upload guest files, publish when ready, and manage imports.</p>
            <div class="actions">
              <a class="button" href="/admin/events">Open Admin</a>
            </div>
          </div>

          <div class="card">
            <h2>System Status</h2>
            <p class="muted">Check database connectivity and basic app health.</p>
            <div class="actions">
              <a class="button secondary" href="/health">Health Check</a>
              <a class="button secondary" href="/setup">Setup / Update DB</a>
            </div>
          </div>

          <div class="card">
            <h2>Reset Data</h2>
            <p class="muted">Clear all events and guests when you want a clean test environment.</p>
            <div class="actions">
              <a class="button danger" href="/admin/purge">Purge Database</a>
            </div>
          </div>
        </div>
      `
    )
  );
});

app.get('/search', async (req, res) => {
  const token = (req.query.event || '').trim();
  const q = (req.query.q || '').trim();

  if (!token) {
    return res.send(
      renderLayout(
        'Missing Event',
        `
          ${renderTopNav([{ href: '/', label: 'Home' }])}
          <div class="panel">
            <h1>Missing event token</h1>
            <p class="muted">Use a link like <span class="code-line">/e/abc12345</span>.</p>
          </div>
        `
      )
    );
  }

  return res.redirect(`/e/${encodeURIComponent(token)}${q ? `?q=${encodeURIComponent(q)}` : ''}`);
});

app.get('/e/:token', async (req, res) => {
  const token = (req.params.token || '').trim();
  const q = (req.query.q || '').trim();

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
      return res.send(
        renderLayout(
          'Event Not Available',
          `
            <div class="search-shell">
              <div class="search-card">
                <h1>Event not found</h1>
                <p class="muted">This event does not exist or has not been published yet.</p>
                <div class="actions">
                  <a class="button secondary" href="/">Home</a>
                </div>
              </div>
            </div>
          `
        )
      );
    }

    const event = eventResult.rows[0];
    let results = [];

    if (q) {
      const dbResult = await pool.query(
        `
        SELECT full_name, company, table_name
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

    res.send(renderSearchPage(event, q, results));
  } catch (err) {
    res.status(500).send(
      renderLayout(
        'Search Error',
        `
          <div class="panel">
            <h1>Search Error</h1>
            <div class="notice danger">${escapeHtml(err.message)}</div>
            <a class="button secondary" href="/">Home</a>
          </div>
        `
      )
    );
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
      SELECT full_name, company, table_name
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
      SELECT
        e.id,
        e.name,
        e.public_token,
        e.is_published,
        e.created_at,
        e.last_imported_at,
        e.last_import_file_name,
        COUNT(g.id)::int AS guest_count
      FROM events e
      LEFT JOIN guests g ON g.event_id = e.id
      GROUP BY
        e.id,
        e.name,
        e.public_token,
        e.is_published,
        e.created_at,
        e.last_imported_at,
        e.last_import_file_name
      ORDER BY e.id DESC
      `
    );

    const body = `
      ${renderTopNav([
        { href: '/', label: 'Home' },
        { href: '/admin/purge', label: 'Purge Database' }
      ])}

      <div class="hero">
        <div>
          <h1>Events</h1>
          <p>Create events, upload guest files, publish when ready, and manage each event from one place.</p>
        </div>
        <div class="actions" style="margin-top: 0;">
          <a class="button" href="/admin/events/new">Create Event</a>
        </div>
      </div>

      ${
        result.rows.length
          ? `<div class="grid cards">
              ${result.rows.map(e => `
                <div class="card">
                  <div class="event-card-header">
                    <div>
                      <h2 class="event-card-title">${escapeHtml(e.name || 'Untitled Event')}</h2>
                      <div class="muted small" style="margin-top: 6px;">
                        <span class="code-line">${escapeHtml(e.public_token || '')}</span>
                      </div>
                    </div>
                    <div>
                      <span class="badge ${e.is_published ? 'published' : 'draft'}">
                        ${e.is_published ? 'Published' : 'Draft'}
                      </span>
                    </div>
                  </div>

                  <div class="stats">
                    <div class="stat">
                      <div class="stat-label">Guests</div>
                      <div class="stat-value">${e.guest_count}</div>
                    </div>
                    <div class="stat">
                      <div class="stat-label">Last Import</div>
                      <div class="small">${escapeHtml(e.last_import_file_name || 'None')}</div>
                    </div>
                  </div>

                  <div class="event-meta">
                    <div>Public URL: <a href="/e/${encodeURIComponent(e.public_token || '')}">/e/${escapeHtml(e.public_token || '')}</a></div>
                    <div>Updated: ${escapeHtml(formatDateTime(e.last_imported_at))}</div>
                  </div>

                  <div class="actions">
                    <a class="button secondary" href="/admin/events/${encodeURIComponent(e.public_token || '')}">Manage</a>
                    <a class="button secondary" href="/e/${encodeURIComponent(e.public_token || '')}">View Search</a>
                    <a class="button secondary" href="/admin/events/${encodeURIComponent(e.public_token || '')}/upload">Upload File</a>
                  </div>
                </div>
              `).join('')}
            </div>`
          : `
            <div class="empty-state">
              <h2 style="margin-top: 0;">No events yet</h2>
              <p>Create your first event to start importing guest lists and publishing search pages.</p>
              <div class="actions" style="justify-content: center;">
                <a class="button" href="/admin/events/new">Create Event</a>
              </div>
            </div>
          `
      }
    `;

    res.send(renderLayout('Admin Events', body));
  } catch (err) {
    res.status(500).send(renderLayout('Error', `<div class="notice danger">${escapeHtml(err.message)}</div>`));
  }
});

app.get('/admin/events/new', (req, res) => {
  res.send(
    renderLayout(
      'Create Event',
      `
        ${renderTopNav([
          { href: '/admin/events', label: 'Back to Events' }
        ])}

        <div class="panel" style="max-width: 720px; margin: 0 auto;">
          <h1 style="margin-top: 0;">Create Event</h1>
          <p class="muted">Create a new event workspace and generate its public token automatically.</p>

          <form method="POST" action="/admin/events/new">
            <div class="field">
              <label for="name">Event Name</label>
              <input id="name" name="name" placeholder="Example: Annual Gala 2026" required />
            </div>

            <div class="actions">
              <button type="submit">Create Event</button>
              <a class="button secondary" href="/admin/events">Cancel</a>
            </div>
          </form>
        </div>
      `
    )
  );
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

    res.redirect(`/admin/events/${encodeURIComponent(token)}`);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/admin/events/:token', async (req, res) => {
  const token = req.params.token;

  try {
    const event = await getEventByToken(token);

    if (!event) {
      return res.status(404).send(renderLayout('Not Found', `<div class="notice danger">Event not found.</div>`));
    }

    const recentGuestsResult = await pool.query(
      `
      SELECT full_name, company, table_name
      FROM guests
      WHERE event_id = $1
      ORDER BY id ASC
      LIMIT 12
      `,
      [event.id]
    );

    const body = `
      ${renderTopNav([
        { href: '/admin/events', label: 'Back to Events' },
        { href: `/e/${event.public_token}`, label: 'Open Public Search' }
      ])}

      <div class="hero">
        <div>
          <h1>${escapeHtml(event.name)}</h1>
          <p>Manage event status, upload a new guest list, and monitor what is currently live.</p>
        </div>
        <div>
          <span class="badge ${event.is_published ? 'published' : 'draft'}">
            ${event.is_published ? 'Published' : 'Draft'}
          </span>
        </div>
      </div>

      <div class="grid two">
        <div>
          <div class="panel">
            <h2>Overview</h2>

            <div class="stats">
              <div class="stat">
                <div class="stat-label">Guest Count</div>
                <div class="stat-value">${event.guest_count}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Public Token</div>
                <div class="small"><span class="code-line">${escapeHtml(event.public_token)}</span></div>
              </div>
              <div class="stat">
                <div class="stat-label">Last Import</div>
                <div class="small">${escapeHtml(formatDateTime(event.last_imported_at))}</div>
              </div>
            </div>

            <div class="event-meta" style="margin-top: 18px;">
              <div>Last Import File: ${escapeHtml(event.last_import_file_name || 'None')}</div>
              <div>Public URL: <a href="/e/${encodeURIComponent(event.public_token)}">/e/${escapeHtml(event.public_token)}</a></div>
            </div>

            <div class="actions">
              <a class="button" href="/admin/events/${encodeURIComponent(event.public_token)}/upload">Upload Guest File</a>
              ${
                event.is_published
                  ? `<a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}/unpublish">Unpublish</a>`
                  : `<a class="button success" href="/admin/events/${encodeURIComponent(event.public_token)}/publish">Publish</a>`
              }
            </div>
          </div>

          <div class="panel">
            <h2>Guest Preview</h2>
            ${
              recentGuestsResult.rows.length
                ? `
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Company</th>
                          <th>Table</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${recentGuestsResult.rows.map(row => `
                          <tr>
                            <td>${escapeHtml(row.full_name || '')}</td>
                            <td>${escapeHtml(row.company || '')}</td>
                            <td>${escapeHtml(row.table_name || '')}</td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                `
                : `<div class="empty-state">No guests imported yet.</div>`
            }
          </div>
        </div>

        <div>
          <div class="panel">
            <h2>Actions</h2>
            <div class="actions">
              <a class="button secondary" href="/e/${encodeURIComponent(event.public_token)}">View Search</a>
              <a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}/upload">Upload File</a>
            </div>
          </div>

          <div class="danger-zone">
            <h3 style="margin-top: 0;">Danger Zone</h3>
            <p class="muted">These actions change or remove data for this event.</p>
            <div class="actions">
              <a class="button danger" href="/admin/events/${encodeURIComponent(event.public_token)}/clear">Clear Guest List</a>
              <a class="button danger" href="/admin/events/${encodeURIComponent(event.public_token)}/delete">Delete Event</a>
            </div>
          </div>
        </div>
      </div>
    `;

    res.send(renderLayout(`Manage ${event.name}`, body, { fullWidth: true }));
  } catch (err) {
    res.status(500).send(renderLayout('Error', `<div class="notice danger">${escapeHtml(err.message)}</div>`));
  }
});

app.get('/admin/events/:token/upload', async (req, res) => {
  const token = req.params.token;

  try {
    const event = await getEventByToken(token);

    if (!event) {
      return res.status(404).send(renderLayout('Not Found', `<div class="notice danger">Event not found.</div>`));
    }

    const body = `
      ${renderTopNav([
        { href: `/admin/events/${event.public_token}`, label: 'Back to Event' },
        { href: '/admin/events', label: 'All Events' }
      ])}

      <div class="panel" style="max-width: 860px; margin: 0 auto;">
        <h1 style="margin-top: 0;">Upload Guest File</h1>
        <p class="muted">Event: <strong>${escapeHtml(event.name)}</strong></p>

        <div class="notice info">
          Upload a CSV or Excel file. The first sheet will be used for Excel files.
          This import can either replace the current guest list or append to it.
        </div>

        <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/upload" enctype="multipart/form-data">
          <div class="field">
            <label for="guestFile">Guest File</label>
            <input id="guestFile" type="file" name="guestFile" accept=".csv,.xlsx,.xls" required />
          </div>

          <div class="field">
            <label for="importMode">Import Mode</label>
            <select id="importMode" name="importMode">
              <option value="replace">Replace existing guest list</option>
              <option value="append">Append to existing guest list</option>
            </select>
          </div>

          <div class="actions">
            <button type="submit">Upload and Preview</button>
            <a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}">Cancel</a>
          </div>
        </form>
      </div>
    `;

    res.send(renderLayout(`Upload File - ${event.name}`, body));
  } catch (err) {
    res.status(500).send(renderLayout('Error', `<div class="notice danger">${escapeHtml(err.message)}</div>`));
  }
});

app.post('/admin/events/:token/upload', upload.single('guestFile'), async (req, res) => {
  const token = req.params.token;
  const importMode = (req.body.importMode || 'replace').trim() === 'append' ? 'append' : 'replace';

  try {
    const event = await getEventByToken(token);

    if (!event) {
      return res.status(404).send('Invalid event');
    }

    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    const parsed = parseWorkbookFromBuffer(req.file.buffer, req.file.originalname);

    if (!parsed.headers.length) {
      return res.status(400).send('No columns found');
    }

    if (!parsed.rows.length) {
      return res.status(400).send('No guest rows found');
    }

    const uploadToken = generateUploadToken();

    const defaultFullName = detectColumnIndex(parsed.headers, [
      'full name', 'fullname', 'guest name', 'name', 'attendee'
    ]);

    const defaultCompany = detectColumnIndex(parsed.headers, [
      'company', 'organisation', 'organization', 'business', 'employer'
    ]);

    const defaultTable = detectColumnIndex(parsed.headers, [
      'table', 'table name', 'table number', 'table no'
    ]);

    uploadSessions.set(uploadToken, {
      createdAt: Date.now(),
      eventId: event.id,
      eventName: event.name,
      eventToken: event.public_token,
      originalName: parsed.originalName,
      sheetName: parsed.firstSheetName,
      headers: parsed.headers,
      rows: parsed.rows,
      importMode,
      defaults: {
        full_name: defaultFullName,
        company: defaultCompany,
        table_name: defaultTable
      }
    });

    res.redirect(`/admin/uploads/${uploadToken}/map`);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/admin/uploads/:uploadToken/map', (req, res) => {
  const uploadToken = req.params.uploadToken;
  const session = uploadSessions.get(uploadToken);

  if (!session) {
    return res.status(404).send('Upload session not found. Upload the file again.');
  }

  const defaults = session.defaults || {};

  function mappingSelectWithDefault(name, headers, defaultValue) {
    return `
      <select name="${name}">
        <option value="">-- Ignore --</option>
        ${headers.map((header, index) => `
          <option value="${index}" ${String(defaultValue) === String(index) ? 'selected' : ''}>
            ${escapeHtml(header)}
          </option>
        `).join('')}
      </select>
    `;
  }

  const body = `
    ${renderTopNav([
      { href: `/admin/events/${session.eventToken}/upload`, label: 'Back to Upload' },
      { href: `/admin/events/${session.eventToken}`, label: 'Event Details' }
    ])}

    <div class="grid two">
      <div class="panel">
        <h1 style="margin-top: 0;">Map Columns</h1>

        <div class="event-meta" style="margin-bottom: 18px;">
          <div>Event: ${escapeHtml(session.eventName)}</div>
          <div>File: ${escapeHtml(session.originalName)}</div>
          <div>Sheet: ${escapeHtml(session.sheetName)}</div>
          <div>Rows Found: ${session.rows.length}</div>
          <div>Import Mode: ${escapeHtml(session.importMode === 'append' ? 'Append' : 'Replace')}</div>
        </div>

        <form method="POST" action="/admin/uploads/${uploadToken}/import">
          <div class="field-row">
            <div class="field">
              <label>Full Name</label>
              ${mappingSelectWithDefault('full_name', session.headers, defaults.full_name)}
            </div>

            <div class="field">
              <label>Company</label>
              ${mappingSelectWithDefault('company', session.headers, defaults.company)}
            </div>

            <div class="field">
              <label>Table</label>
              ${mappingSelectWithDefault('table_name', session.headers, defaults.table_name)}
            </div>
          </div>

          <div class="notice info">
            Full Name is required. Company and Table are optional.
          </div>

          <div class="actions">
            <button type="submit">${session.importMode === 'append' ? 'Append Guests' : 'Replace Guests and Import'}</button>
            <a class="button secondary" href="/admin/events/${encodeURIComponent(session.eventToken)}/upload">Cancel</a>
          </div>
        </form>
      </div>

      <div class="panel">
        <h2 style="margin-top: 0;">Preview</h2>
        <div class="table-wrap">
          ${renderPreviewTable(session.headers, session.rows, 10)}
        </div>
      </div>
    </div>
  `;

  res.send(renderLayout('Map Columns', body, { fullWidth: true }));
});

app.post('/admin/uploads/:uploadToken/import', async (req, res) => {
  const uploadToken = req.params.uploadToken;
  const session = uploadSessions.get(uploadToken);

  if (!session) {
    return res.status(404).send('Upload session not found. Upload the file again.');
  }

  const fullNameIndex = req.body.full_name;
  const companyIndex = req.body.company;
  const tableNameIndex = req.body.table_name;

  if (fullNameIndex === '' || fullNameIndex === undefined) {
    return res.status(400).send('You must map a Full Name column.');
  }

  try {
    await pool.query('BEGIN');

    if (session.importMode === 'replace') {
      await pool.query(
        `DELETE FROM guests WHERE event_id = $1`,
        [session.eventId]
      );
    }

    let imported = 0;

    for (const row of session.rows) {
      const full_name = normalizeCell(row[Number(fullNameIndex)]);
      const company = companyIndex === '' ? '' : normalizeCell(row[Number(companyIndex)]);
      const table_name = tableNameIndex === '' ? '' : normalizeCell(row[Number(tableNameIndex)]);

      if (!full_name) {
        continue;
      }

      await pool.query(
        `
        INSERT INTO guests (event_id, full_name, company, table_name)
        VALUES ($1, $2, $3, $4)
        `,
        [session.eventId, full_name, company, table_name]
      );

      imported += 1;
    }

    await pool.query(
      `
      UPDATE events
      SET
        last_imported_at = NOW(),
        last_import_file_name = $2
      WHERE id = $1
      `,
      [session.eventId, session.originalName]
    );

    await pool.query('COMMIT');
    uploadSessions.delete(uploadToken);

    res.send(
      renderLayout(
        'Import Complete',
        `
          <div class="panel" style="max-width: 760px; margin: 0 auto;">
            <h1 style="margin-top: 0;">Import Complete</h1>
            <p class="muted">
              ${
                session.importMode === 'append'
                  ? `Appended ${imported} guests`
                  : `Replaced guest list and imported ${imported} guests`
              } into <strong>${escapeHtml(session.eventName)}</strong>.
            </p>

            <div class="actions">
              <a class="button" href="/admin/events/${encodeURIComponent(session.eventToken)}">Back to Event</a>
              <a class="button secondary" href="/e/${encodeURIComponent(session.eventToken)}">Open Public Search</a>
            </div>
          </div>
        `
      )
    );
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr);
    }

    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/admin/events/:token/publish', async (req, res) => {
  const token = req.params.token;

  try {
    const event = await getEventByToken(token);

    if (!event) {
      return res.status(404).send('Event not found');
    }

    if (event.guest_count < 1) {
      return res.status(400).send(
        renderLayout(
          'Cannot Publish',
          `
            <div class="panel" style="max-width: 720px; margin: 0 auto;">
              <h1 style="margin-top: 0;">Cannot Publish</h1>
              <div class="notice warning">This event has no guests yet.</div>
              <div class="actions">
                <a class="button secondary" href="/admin/events/${encodeURIComponent(token)}">Back to Event</a>
              </div>
            </div>
          `
        )
      );
    }

    await pool.query(
      `
      UPDATE events
      SET is_published = true
      WHERE public_token = $1
      `,
      [token]
    );

    res.redirect(`/admin/events/${encodeURIComponent(token)}`);
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

    res.redirect(`/admin/events/${encodeURIComponent(token)}`);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/admin/events/:token/clear', async (req, res) => {
  const token = req.params.token;

  try {
    const event = await getEventByToken(token);

    if (!event) {
      return res.status(404).send('Event not found');
    }

    res.send(
      renderLayout(
        'Clear Guest List',
        `
          <div class="panel" style="max-width: 760px; margin: 0 auto;">
            <h1 style="margin-top: 0;">Clear Guest List</h1>
            <p class="muted">Event: <strong>${escapeHtml(event.name)}</strong></p>
            <div class="notice danger">
              This will delete all guests for this event and set it back to Draft.
            </div>

            <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/clear">
              <div class="field">
                <label>Type CLEAR to confirm</label>
                <input name="confirmText" />
              </div>
              <div class="actions">
                <button class="danger" type="submit">Clear Guest List</button>
                <a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}">Cancel</a>
              </div>
            </form>
          </div>
        `
      )
    );
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.post('/admin/events/:token/clear', async (req, res) => {
  const token = req.params.token;
  const confirmText = (req.body.confirmText || '').trim();

  if (confirmText !== 'CLEAR') {
    return res.status(400).send('Clear cancelled. Type CLEAR exactly.');
  }

  try {
    const event = await getEventByToken(token);

    if (!event) {
      return res.status(404).send('Event not found');
    }

    await pool.query('BEGIN');

    await pool.query(
      `DELETE FROM guests WHERE event_id = $1`,
      [event.id]
    );

    await pool.query(
      `
      UPDATE events
      SET is_published = false
      WHERE id = $1
      `,
      [event.id]
    );

    await pool.query('COMMIT');

    res.send(
      renderLayout(
        'Guest List Cleared',
        `
          <div class="panel" style="max-width: 760px; margin: 0 auto;">
            <h1 style="margin-top: 0;">Guest List Cleared</h1>
            <p class="muted">All guests for <strong>${escapeHtml(event.name)}</strong> were removed and the event is now Draft.</p>
            <div class="actions">
              <a class="button" href="/admin/events/${encodeURIComponent(event.public_token)}">Back to Event</a>
            </div>
          </div>
        `
      )
    );
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr);
    }

    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/admin/events/:token/delete', async (req, res) => {
  const token = req.params.token;

  try {
    const event = await getEventByToken(token);

    if (!event) {
      return res.status(404).send('Event not found');
    }

    res.send(
      renderLayout(
        'Delete Event',
        `
          <div class="panel" style="max-width: 760px; margin: 0 auto;">
            <h1 style="margin-top: 0;">Delete Event</h1>
            <p class="muted">Event: <strong>${escapeHtml(event.name)}</strong></p>
            <div class="notice danger">
              This will permanently delete the event and all associated guests.
            </div>

            <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/delete">
              <div class="field">
                <label>Type DELETE to confirm</label>
                <input name="confirmText" />
              </div>
              <div class="actions">
                <button class="danger" type="submit">Delete Event</button>
                <a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}">Cancel</a>
              </div>
            </form>
          </div>
        `
      )
    );
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.post('/admin/events/:token/delete', async (req, res) => {
  const token = req.params.token;
  const confirmText = (req.body.confirmText || '').trim();

  if (confirmText !== 'DELETE') {
    return res.status(400).send('Delete cancelled. Type DELETE exactly.');
  }

  try {
    const event = await getEventByToken(token);

    if (!event) {
      return res.status(404).send('Event not found');
    }

    await pool.query('BEGIN');
    await pool.query(`DELETE FROM guests WHERE event_id = $1`, [event.id]);
    await pool.query(`DELETE FROM events WHERE id = $1`, [event.id]);
    await pool.query('COMMIT');

    res.send(
      renderLayout(
        'Event Deleted',
        `
          <div class="panel" style="max-width: 760px; margin: 0 auto;">
            <h1 style="margin-top: 0;">Event Deleted</h1>
            <p class="muted"><strong>${escapeHtml(event.name)}</strong> and all its guests were deleted.</p>
            <div class="actions">
              <a class="button" href="/admin/events">Back to Events</a>
            </div>
          </div>
        `
      )
    );
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr);
    }

    res.status(500).send(escapeHtml(err.message));
  }
});

app.get('/admin/purge', async (req, res) => {
  try {
    const eventCountResult = await pool.query(`SELECT COUNT(*)::int AS count FROM events`);
    const guestCountResult = await pool.query(`SELECT COUNT(*)::int AS count FROM guests`);

    const eventCount = eventCountResult.rows[0].count;
    const guestCount = guestCountResult.rows[0].count;

    res.send(
      renderLayout(
        'Purge Database',
        `
          ${renderTopNav([{ href: '/admin/events', label: 'Back to Events' }])}

          <div class="panel" style="max-width: 760px; margin: 0 auto;">
            <h1 style="margin-top: 0;">Purge Database</h1>
            <div class="notice danger">
              This will delete all events and all guests.
            </div>

            <div class="stats">
              <div class="stat">
                <div class="stat-label">Events</div>
                <div class="stat-value">${eventCount}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Guests</div>
                <div class="stat-value">${guestCount}</div>
              </div>
            </div>

            <form method="POST" action="/admin/purge" style="margin-top: 18px;">
              <div class="field">
                <label>Type PURGE to confirm</label>
                <input name="confirmText" />
              </div>
              <div class="actions">
                <button class="danger" type="submit">Purge Database</button>
                <a class="button secondary" href="/admin/events">Cancel</a>
              </div>
            </form>
          </div>
        `
      )
    );
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

    res.send(
      renderLayout(
        'Purge Complete',
        `
          <div class="panel" style="max-width: 760px; margin: 0 auto;">
            <h1 style="margin-top: 0;">Purge Complete</h1>
            <p class="muted">All guests and events have been deleted.</p>
            <div class="actions">
              <a class="button" href="/admin/events">Back to Events</a>
            </div>
          </div>
        `
      )
    );
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr);
    }

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
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS public_token TEXT;
    `);

    await pool.query(`
      ALTER TABLE events
      ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false;
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
      CREATE UNIQUE INDEX IF NOT EXISTS events_public_token_idx
      ON events(public_token);
    `);

    res.send(
      renderLayout(
        'Setup Complete',
        `
          <div class="panel" style="max-width: 760px; margin: 0 auto;">
            <h1 style="margin-top: 0;">Setup Complete</h1>
            <p class="muted">Database tables and columns are ready.</p>
            <div class="actions">
              <a class="button" href="/admin/events">Go to Events</a>
            </div>
          </div>
        `
      )
    );
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
