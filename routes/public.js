const express = require('express');
const { pool } = require('../db');
const { escapeHtml, renderLayout, renderTopNav, renderSearchPage } = require('../render');

const router = express.Router();

router.get('/', (req, res) => {
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
            <h2>System Status</h2>
            <p class="muted">Check database connectivity and basic app health.</p>
            <div class="actions">
              <a class="button secondary" href="/health">Health Check</a>
            </div>
          </div>
        </div>
      `
    )
  );
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
        logo_url,
        primary_color,
        tertiary_color,
        venue
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
