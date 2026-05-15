const express = require('express');
const { renderLayout, escapeHtml } = require('../render');
const { searchGuest } = require('../lib/guestSeats');
const { formatError } = require('../lib/formatting');

const router = express.Router();

router.get('/', (_req, res) => {
  res.status(200).send(
    renderLayout(
      'Guest Seating Lookup',
      `
      <section class="panel"><h1>Guest Seating Lookup</h1>
      <p>Find your table assignment or sign in to manage events.</p>
      <form method="GET" action="/search">
        <label>Guest name</label>
        <input name="q" required />
        <p><button class="button" type="submit">Search</button></p>
      </form>
      <p><a class="button" href="/admin/login?next=/admin/events">Admin sign in</a></p></section>
      `
    )
  );
});

router.get('/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  try {
    const results = query ? await searchGuest(query) : [];
    const rows = results
      .map((row) => `<tr><td>${escapeHtml(row.event_name)}</td><td>${escapeHtml(row.guest_name)}</td><td>${escapeHtml(row.table_name)}</td></tr>`)
      .join('');

    res.status(200).send(renderLayout('Search Guests', `<section class="panel"><h1>Search Guests</h1><form method="GET" action="/search"><input name="q" value="${escapeHtml(query)}" required /><button class="button" type="submit">Search</button></form>${query ? `<p class="muted">Results for ${escapeHtml(query)}:</p>` : ''}${results.length ? `<table><thead><tr><th>Event</th><th>Guest</th><th>Table</th></tr></thead><tbody>${rows}</tbody></table>` : query ? '<p>No matches found.</p>' : ''}<p><a class="button" href="/">Back</a></p></section>`));
  } catch (err) {
    res.status(500).send(renderLayout('Search Guests', `<section class="panel"><h1>Search Guests</h1><p>${escapeHtml(formatError(err, 'Search failed.'))}</p><p><a class="button" href="/">Back</a></p></section>`));
  }
});

router.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

module.exports = router;
