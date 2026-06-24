const express = require('express');
const { pool } = require('../db');
const {
  escapeHtml,
  renderLayout,
  renderPreviewTable,
  renderMappingSelect
} = require('../render');
const { requireAdmin, adminNav } = require('../lib/auth');
const {
  normalizeCell,
  formatDateTime,
  formatDate,
  detectColumnIndex
} = require('../lib/formatting');
const {
  guestUpload,
  logoUpload,
  generateUploadToken,
  parseWorkbookFromBuffer
} = require('../lib/uploads');
const QRCode = require('qrcode');

const router = express.Router();

router.use('/admin', requireAdmin);

const uploadSessions = new Map();

function generateToken() {
  return Math.random().toString(36).slice(2, 10);
}

function parseEventDateInput(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function getPublicSearchUrl(req, token) {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const baseUrl = configuredBaseUrl || `${req.protocol}://${req.get('host')}`;

  return `${baseUrl}/e/${encodeURIComponent(token)}`;
}

async function getEventByToken(token) {
  const result = await pool.query(
    `
    SELECT
      e.id,
      e.name,
      e.public_token,
      e.is_published,
      e.event_date,
      e.created_at,
      e.last_imported_at,
      e.last_import_file_name,
      e.brand_color,
      (e.logo_data IS NOT NULL) AS has_logo,
      COUNT(g.id)::int AS guest_count
    FROM events e
    LEFT JOIN guests g ON g.event_id = e.id
    WHERE e.public_token = $1
    GROUP BY
      e.id,
      e.name,
      e.public_token,
      e.is_published,
      e.event_date,
      e.created_at,
      e.last_imported_at,
      e.last_import_file_name,
      e.brand_color,
      e.logo_data
    `,
    [token]
  );

  return result.rows[0] || null;
}

function renderEventActions(event) {
  const token = encodeURIComponent(event.public_token || '');

  return `
    <div class="actions">
      <a class="button secondary" href="/admin/events/${token}">Manage</a>
      <a class="button secondary" href="/admin/events/${token}/upload">Upload Excel</a>
      <a class="button secondary" href="/e/${token}">View Search</a>
      ${event.is_published
        ? `<form method="POST" action="/admin/events/${token}/unpublish" style="display:inline;"><button class="button secondary" type="submit">Unpublish</button></form>`
        : `<form method="POST" action="/admin/events/${token}/publish" style="display:inline;"><button class="button" type="submit">Publish</button></form>`}
      <form method="POST" action="/admin/events/${token}/delete" style="display:inline;" onsubmit="return confirm('Delete this event and all guests?')">
        <button class="button danger" type="submit">Delete</button>
      </form>
    </div>
  `;
}

router.get('/admin/events', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        e.id,
        e.name,
        e.public_token,
        e.is_published,
        e.event_date,
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
        e.event_date,
        e.created_at,
        e.last_imported_at,
        e.last_import_file_name
      ORDER BY e.id DESC
      `
    );

    const eventsHtml = result.rows.length
      ? `
        <div class="grid cards">
          ${result.rows.map((event) => `
            <div class="card">
              <div class="event-card-header">
                <div>
                  <h2 class="event-card-title">${escapeHtml(event.name || 'Untitled Event')}</h2>
                  <div class="muted small" style="margin-top:6px;">${escapeHtml(formatDate(event.event_date))}</div>
                </div>
                <span class="badge ${event.is_published ? 'published' : 'draft'}">${event.is_published ? 'Published' : 'Draft'}</span>
              </div>

              <div class="stats">
                <div class="stat">
                  <div class="stat-label">Guests</div>
                  <div class="stat-value">${event.guest_count}</div>
                </div>
                <div class="stat">
                  <div class="stat-label">Last Import</div>
                  <div class="small">${escapeHtml(event.last_import_file_name || 'None')}</div>
                </div>
              </div>

              <div class="event-meta">
                <div>Public link: <a href="/e/${encodeURIComponent(event.public_token || '')}">/e/${escapeHtml(event.public_token || '')}</a></div>
                <div>Updated: ${escapeHtml(formatDateTime(event.last_imported_at))}</div>
              </div>

              ${renderEventActions(event)}
            </div>
          `).join('')}
        </div>
      `
      : `
        <div class="empty-state">
          <h2 style="margin-top:0;">No events yet</h2>
          <p>Create an event, upload an Excel file, and publish the lookup page.</p>
          <div class="actions" style="justify-content:center;">
            <a class="button" href="/admin/events/new">Create Event</a>
          </div>
        </div>
      `;

    const body = `
      ${adminNav(req, [{ href: '/', label: 'Home' }])}
      <div class="hero">
        <div>
          <h1>Events</h1>
          <p>Signed in as <strong>${escapeHtml(req.session.adminUser.username)}</strong>.</p>
        </div>
        <div class="actions" style="margin-top:0;">
          <a class="button" href="/admin/events/new">Create Event</a>
        </div>
      </div>
      ${eventsHtml}
    `;

    res.send(renderLayout('Admin Events', body));
  } catch (err) {
    res.status(500).send(renderLayout('Error', `<div class="notice danger">${escapeHtml(err.message)}</div>`));
  }
});

router.get('/admin/events/new', (_req, res) => {
  const body = `
    ${adminNav(_req, [{ href: '/admin/events', label: 'Events' }])}
    <div class="panel" style="max-width: 720px; margin: 0 auto;">
      <h1 style="margin-top:0;">Create Event</h1>
      <form method="POST" action="/admin/events/new">
        <div class="field">
          <label for="name">Event name</label>
          <input id="name" type="text" name="name" required />
        </div>
        <div class="field">
          <label for="event_date">Event date</label>
          <input id="event_date" type="date" name="event_date" />
        </div>
        <div class="actions">
          <button type="submit">Create Event</button>
          <a class="button secondary" href="/admin/events">Cancel</a>
        </div>
      </form>
    </div>
  `;

  res.send(renderLayout('Create Event', body));
});

router.post('/admin/events/new', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const eventDate = parseEventDateInput(req.body?.event_date);

  if (!name) {
    return res.status(400).send(renderLayout('Validation Error', '<div class="notice danger">Event name is required.</div>'));
  }

  const token = generateToken();
  await pool.query(
    'INSERT INTO events (name, public_token, event_date, is_published) VALUES ($1, $2, $3, false)',
    [name, token, eventDate]
  );

  return res.redirect(`/admin/events/${encodeURIComponent(token)}`);
});

router.get('/admin/events/:token', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());

  if (!event) {
    return res.status(404).send(renderLayout('Not Found', '<div class="notice danger">Event not found.</div>'));
  }

  const publicSearchUrl = getPublicSearchUrl(req, event.public_token);

  return res.send(renderLayout(`Manage: ${event.name}`, `
    ${adminNav(req, [{ href: '/admin/events', label: 'Events' }])}
    <div class="panel" style="max-width: 860px; margin: 0 auto;">
      <h1 style="margin-top:0;">${escapeHtml(event.name)}</h1>
      <p class="muted">Simple guest seating lookup.</p>

      <div class="stats">
        <div class="stat">
          <div class="stat-label">Guests</div>
          <div class="stat-value">${event.guest_count}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Status</div>
          <div class="small">${event.is_published ? 'Published' : 'Draft'}</div>
        </div>
      </div>

      <div class="event-meta">
        <div>Event date: ${escapeHtml(formatDate(event.event_date))}</div>
        <div>Last import: ${escapeHtml(event.last_import_file_name || 'None')} (${escapeHtml(formatDateTime(event.last_imported_at))})</div>
      </div>

      <div class="field" style="margin-top:18px;">
        <label for="public_url">Public search URL</label>
        <input id="public_url" type="text" readonly value="${escapeHtml(publicSearchUrl)}" />
      </div>

      <div class="actions">
        <a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}/qr">Download QR Code</a>
      </div>

      ${renderEventActions(event)}

      <h2>Branding</h2>
      <p class="muted">Add a logo and accent color shown on the public lookup page and QR download.</p>
      <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/branding" enctype="multipart/form-data">
        <div class="field">
          <label for="logo">Logo (PNG, JPEG, SVG or WebP, max 2MB)</label>
          ${event.has_logo ? `<div style="margin-bottom:8px;"><img src="/e/${encodeURIComponent(event.public_token)}/logo" alt="Current logo" style="max-height:48px;" /></div>` : ''}
          <input id="logo" type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" />
        </div>
        <div class="field">
          <label for="brand_color">Accent color</label>
          <input id="brand_color" type="color" name="brand_color" value="${escapeHtml(event.brand_color || '#2563eb')}" />
        </div>
        <div class="actions">
          <button type="submit">Save Branding</button>
        </div>
      </form>
    </div>
  `));
});

router.post('/admin/events/:token/branding', logoUpload.single('logo'), async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', '<div class="notice danger">Event not found.</div>'));

  const brandColor = /^#[0-9a-fA-F]{6}$/.test(String(req.body.brand_color || '')) ? req.body.brand_color : null;

  if (req.file && req.file.buffer) {
    await pool.query(
      'UPDATE events SET logo_data = $2, logo_mime = $3, brand_color = $4 WHERE id = $1',
      [event.id, req.file.buffer, req.file.mimetype, brandColor]
    );
  } else {
    await pool.query('UPDATE events SET brand_color = $2 WHERE id = $1', [event.id, brandColor]);
  }

  return res.redirect(`/admin/events/${encodeURIComponent(event.public_token)}`);
});

router.get('/admin/events/:token/qr', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', '<div class="notice danger">Event not found.</div>'));

  const publicSearchUrl = getPublicSearchUrl(req, event.public_token);
  const png = await QRCode.toBuffer(publicSearchUrl, {
    width: 600,
    margin: 2,
    color: { dark: event.brand_color || '#000000', light: '#ffffffff' }
  });

  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', `attachment; filename="${event.public_token}-qr.png"`);
  res.send(png);
});

router.get('/admin/events/:token/upload', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', '<div class="notice danger">Event not found.</div>'));

  const body = `
    ${adminNav(req, [{ href: '/admin/events', label: 'Events' }])}
    <div class="panel" style="max-width: 840px; margin: 0 auto;">
      <h1 style="margin-top: 0;">Upload Guest List</h1>
      <p class="muted"><strong>${escapeHtml(event.name)}</strong></p>
      <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/upload" enctype="multipart/form-data">
        <div class="field">
          <label for="guest_file">Excel or CSV file</label>
          <input id="guest_file" type="file" name="guest_file" accept=".csv,.xlsx,.xls" required />
        </div>
        <div class="actions">
          <button type="submit">Continue</button>
          <a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}">Cancel</a>
        </div>
      </form>
    </div>`;

  return res.send(renderLayout(`Upload: ${event.name}`, body));
});

router.post('/admin/events/:token/upload', guestUpload.single('guest_file'), async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', '<div class="notice danger">Event not found.</div>'));

  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).send(renderLayout('Upload Error', '<div class="notice danger">Please select a file to upload.</div>'));
    }

    const parsed = parseWorkbookFromBuffer(req.file.buffer, req.file.originalname || 'upload');
    const sessionToken = generateUploadToken();
    uploadSessions.set(sessionToken, { eventId: event.id, parsed });

    const headers = parsed.headers;
    const nameIndex = detectColumnIndex(headers, ['full name', 'name', 'guest name', 'attendee']);
    const firstNameIndex = detectColumnIndex(headers, ['first name', 'firstname', 'given name', 'first']);
    const lastNameIndex = detectColumnIndex(headers, ['last name', 'lastname', 'surname', 'family name', 'last']);
    const companyIndex = detectColumnIndex(headers, ['company', 'organisation', 'organization', 'business']);
    const tableIndex = detectColumnIndex(headers, ['table', 'table name', 'table no', 'table number', 'seat']);

    const body = `
      ${adminNav(req, [{ href: '/admin/events', label: 'Events' }])}
      <div class="panel" style="max-width: 1100px; margin: 0 auto;">
        <h1 style="margin-top:0;">Map Columns</h1>
        <p class="muted">${escapeHtml(parsed.originalName)} · ${parsed.rows.length} rows detected</p>
        <div class="table-wrap">${renderPreviewTable(parsed.headers, parsed.rows, 8)}</div>
        <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/upload/confirm">
          <input type="hidden" name="upload_token" value="${escapeHtml(sessionToken)}" />
          <div class="field"><label>Full name column</label>${renderMappingSelect('full_name_col', headers, nameIndex)}</div>
          <div class="field"><label>First name column</label>${renderMappingSelect('first_name_col', headers, firstNameIndex)}</div>
          <div class="field"><label>Last name column</label>${renderMappingSelect('last_name_col', headers, lastNameIndex)}</div>
          <div class="field"><label>Company column</label>${renderMappingSelect('company_col', headers, companyIndex)}</div>
          <div class="field"><label>Table column</label>${renderMappingSelect('table_col', headers, tableIndex)}</div>
          <div class="actions"><button type="submit">Import Guest List</button><a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}/upload">Start over</a></div>
        </form>
      </div>`;

    return res.send(renderLayout(`Map Columns: ${event.name}`, body, { fullWidth: true }));
  } catch (err) {
    return res.status(400).send(renderLayout('Upload Error', `<div class="panel"><h1>Upload Error</h1><div class="notice danger">${escapeHtml(err.message)}</div><a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}/upload">Back</a></div>`));
  }
});

router.post('/admin/events/:token/upload/confirm', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', '<div class="notice danger">Event not found.</div>'));

  const uploadToken = String(req.body.upload_token || '').trim();
  const state = uploadSessions.get(uploadToken);
  if (!state || state.eventId !== event.id) {
    return res.status(400).send(renderLayout('Upload Expired', `<div class="panel"><div class="notice danger">Upload session expired. Please upload the file again.</div><a class="button" href="/admin/events/${encodeURIComponent(event.public_token)}/upload">Upload Again</a></div>`));
  }

  const fullNameCol = Number(req.body.full_name_col);
  const firstNameCol = Number(req.body.first_name_col);
  const lastNameCol = Number(req.body.last_name_col);
  const companyCol = Number(req.body.company_col);
  const tableCol = Number(req.body.table_col);

  if (!Number.isInteger(tableCol) || tableCol < 0) {
    return res.status(400).send(renderLayout('Mapping Error', '<div class="notice danger">Table column is required.</div>'));
  }

  const rows = state.parsed.rows.map((row) => {
    const fullName = Number.isInteger(fullNameCol) && fullNameCol >= 0 ? normalizeCell(row[fullNameCol]) : '';
    const firstName = Number.isInteger(firstNameCol) && firstNameCol >= 0 ? normalizeCell(row[firstNameCol]) : '';
    const lastName = Number.isInteger(lastNameCol) && lastNameCol >= 0 ? normalizeCell(row[lastNameCol]) : '';
    const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim();

    return {
      fullName: fullName || combinedName,
      company: Number.isInteger(companyCol) && companyCol >= 0 ? normalizeCell(row[companyCol]) : '',
      tableName: normalizeCell(row[tableCol])
    };
  }).filter((row) => row.tableName && (row.fullName || row.company));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM guests WHERE event_id = $1', [event.id]);
    for (const row of rows) {
      await client.query(
        'INSERT INTO guests (event_id, full_name, company, table_name) VALUES ($1, $2, $3, $4)',
        [event.id, row.fullName, row.company, row.tableName]
      );
    }
    await client.query('UPDATE events SET last_imported_at = NOW(), last_import_file_name = $2 WHERE id = $1', [event.id, state.parsed.originalName]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    uploadSessions.delete(uploadToken);
  }

  return res.redirect(`/admin/events/${encodeURIComponent(event.public_token)}`);
});

router.post('/admin/events/:token/publish', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', '<div class="notice danger">Event not found.</div>'));
  await pool.query('UPDATE events SET is_published = true WHERE id = $1', [event.id]);
  return res.redirect('/admin/events');
});

router.post('/admin/events/:token/unpublish', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', '<div class="notice danger">Event not found.</div>'));
  await pool.query('UPDATE events SET is_published = false WHERE id = $1', [event.id]);
  return res.redirect('/admin/events');
});

router.post('/admin/events/:token/delete', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', '<div class="notice danger">Event not found.</div>'));
  await pool.query('DELETE FROM guests WHERE event_id = $1', [event.id]);
  await pool.query('DELETE FROM events WHERE id = $1', [event.id]);
  return res.redirect('/admin/events');
});

module.exports = router;
