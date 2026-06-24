const express = require('express');
const { pool, testDb } = require('../db');
const { escapeHtml, renderLayout, renderTopNav, renderSearchPage } = require('../render');

const router = express.Router();

router.get('/', (req, res) => {
  res.send(
    renderLayout(
      'Guest Seating Lookup',
      `
        <div class="panel" style="max-width: 720px; margin: 48px auto;">
          <h1 style="margin-top:0;">Guest Seating Lookup</h1>
          <p class="muted">
            Sign in to upload a guest list and publish a simple seating search page.
          </p>
          <div class="actions">
            <a class="button" href="/admin/login">Admin Login</a>
            <a class="button secondary" href="/health">Health Check</a>
          </div>
        </div>
      `
    )
  );
});


router.get('/health', async (_req, res) => {
  try {
    const db = await testDb();
    res.json({ ok: true, database: db.now });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/search', async (req, res) => {
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

router.get('/e/:token', async (req, res) => {
  const token = (req.params.token || '').trim();
  const q = (req.query.q || '').trim();

  try {
    const eventResult = await pool.query(
      `
      SELECT
        id,
        name,
        public_token,
        brand_color,
        (logo_data IS NOT NULL) AS has_logo
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
      const parts = q.split(/\s+/).map((part) => part.trim()).filter(Boolean);
      const likeTerms = parts.map((part) => `%${part}%`);
      const dbResult = await pool.query(
        `
        SELECT full_name, company, table_name
        FROM guests
        WHERE event_id = $1
          AND (
            full_name ILIKE $2
            OR company ILIKE $2
            OR (
              cardinality($3::TEXT[]) > 0
              AND EXISTS (
                SELECT 1
                FROM unnest($3::TEXT[]) AS term
                WHERE full_name ILIKE term OR company ILIKE term
              )
            )
          )
        ORDER BY
          CASE WHEN full_name ILIKE $4 OR company ILIKE $4 THEN 0 ELSE 1 END,
          CASE
            WHEN COALESCE(NULLIF(full_name, ''), '') = '' THEN company
            ELSE full_name
          END ASC
        LIMIT 50
        `,
        [event.id, `%${q}%`, likeTerms, `${q}%`]
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

router.get('/e/:token/logo', async (req, res) => {
  const token = (req.params.token || '').trim();

  const result = await pool.query(
    'SELECT logo_data, logo_mime FROM events WHERE public_token = $1',
    [token]
  );

  const row = result.rows[0];
  if (!row || !row.logo_data) {
    return res.status(404).end();
  }

  res.set('Content-Type', row.logo_mime || 'application/octet-stream');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(row.logo_data);
});

router.get('/api/search', async (req, res) => {
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
      ORDER BY
        CASE
          WHEN COALESCE(NULLIF(full_name, ''), '') = '' THEN company
          ELSE full_name
        END ASC
      LIMIT 50
      `,
      [eventId, `%${q}%`]
    );

    res.json(dbResult.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
