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
  detectColumnIndex,
  normalizeHexColor
} = require('../lib/formatting');
const {
  guestUpload,
  logoUpload,
  generateUploadToken,
  parseWorkbookFromBuffer,
  imageBufferToDataUrl
} = require('../lib/uploads');
const { VENUE_OPTIONS, canAccessVenue } = require('../lib/venues');

const router = express.Router();

router.use('/admin', requireAdmin);

const uploadSessions = new Map();

function generateToken() {
  return Math.random().toString(36).slice(2, 10);
}

function parseEventDateInput(value) {
  const raw = String(value || '').trim();

  if (!raw) return null;

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  return raw;
}

function parseVenueInput(value) {
  const venue = String(value || '').trim();

  if (!venue) return null;

  return VENUE_OPTIONS.includes(venue) ? venue : null;
}

function renderVenueOptions(selectedVenue, availableVenues = VENUE_OPTIONS) {
  return `
    <option value="">Select a venue</option>

    ${availableVenues.map((venue) => `
      <option
        value="${escapeHtml(venue)}"
        ${venue === selectedVenue ? 'selected' : ''}
      >
        ${escapeHtml(venue)}
      </option>
    `).join('')}
  `;
}

function getAllowedVenuesForRequest(req) {
  if (req.session?.adminUser?.isSuperAdmin) {
    return VENUE_OPTIONS;
  }

  if (!Array.isArray(req.session?.adminUser?.allowedVenues)) {
    return [];
  }

  return req.session.adminUser.allowedVenues.filter((venue) =>
    VENUE_OPTIONS.includes(venue)
  );
}

function hasVenueAccess(req, venue) {
  if (req.session?.adminUser?.isSuperAdmin) {
    return true;
  }

  return canAccessVenue(getAllowedVenuesForRequest(req), venue);
}

function isPastEvent(eventDate) {
  if (!eventDate) return false;

  const date = new Date(`${eventDate}T00:00:00+09:30`);

  if (Number.isNaN(date.getTime())) return false;

  const nowInAdelaide = new Date(
    new Date().toLocaleString('en-US', {
      timeZone: 'Australia/Adelaide'
    })
  );

  nowInAdelaide.setHours(0, 0, 0, 0);

  return date < nowInAdelaide;
}

function getPublicSearchUrl(req, token) {
  const configuredBaseUrl = String(
    process.env.PUBLIC_BASE_URL || ''
  )
    .trim()
    .replace(/\/+$/, '');

  const baseUrl =
    configuredBaseUrl ||
    `${req.protocol}://${req.get('host')}`;

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
      e.logo_url,
      e.primary_color,
      e.tertiary_color,
      e.venue,
      e.event_date,
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
      e.logo_url,
      e.primary_color,
      e.tertiary_color,
      e.venue,
      e.event_date,
      e.created_at,
      e.last_imported_at,
      e.last_import_file_name
    `,
    [token]
  );

  return result.rows[0] || null;
}

router.get('/admin/events', async (req, res) => {
  try {
    const allowedVenues = getAllowedVenuesForRequest(req);

    let result = { rows: [] };

    if (
      req.session.adminUser.isSuperAdmin ||
      allowedVenues.length > 0
    ) {
      const venueCondition =
        req.session.adminUser.isSuperAdmin
          ? ''
          : 'AND e.venue = ANY($1::TEXT[])';

      const params = req.session.adminUser.isSuperAdmin
        ? []
        : [allowedVenues];

      result = await pool.query(
        `
        SELECT
          e.id,
          e.name,
          e.public_token,
          e.is_published,
          e.logo_url,
          e.primary_color,
          e.tertiary_color,
          e.venue,
          e.event_date,
          e.created_at,
          e.last_imported_at,
          e.last_import_file_name,
          COUNT(g.id)::int AS guest_count
        FROM events e
        LEFT JOIN guests g ON g.event_id = e.id
        WHERE (
          e.event_date IS NULL
          OR e.event_date >= (
            (NOW() AT TIME ZONE 'Australia/Adelaide')::DATE - 2
          )
        )
        ${venueCondition}
        GROUP BY
          e.id,
          e.name,
          e.public_token,
          e.is_published,
          e.logo_url,
          e.primary_color,
          e.tertiary_color,
          e.venue,
          e.event_date,
          e.created_at,
          e.last_imported_at,
          e.last_import_file_name
        ORDER BY e.id DESC
        `,
        params
      );
    }

    const body = `
      ${adminNav(req, [{ href: '/', label: 'Home' }])}

      <div class="hero">
        <div>
          <h1>Events</h1>

          <p>
            Signed in as
            <strong>
              ${escapeHtml(req.session.adminUser.username)}
            </strong>.
          </p>
        </div>

        <div class="actions" style="margin-top:0;">
          ${
            req.session.adminUser.isSuperAdmin ||
            getAllowedVenuesForRequest(req).length
              ? `
                <a class="button" href="/admin/events/new">
                  Create Event
                </a>
              `
              : `
                <span class="muted small">
                  No venue access assigned
                </span>
              `
          }
        </div>
      </div>

      ${
        result.rows.length
          ? `
            <div class="grid cards">

              ${result.rows.map((e) => {
                const pastEvent = isPastEvent(e.event_date);

                return `
                  <div class="card ${pastEvent ? 'past-event' : ''}">

                    <div class="event-card-header">

                      <div>
                        <h2 class="event-card-title">
                          ${escapeHtml(e.name || 'Untitled Event')}
                        </h2>

                        <div class="muted small" style="margin-top:6px;">
                          <span class="code-line">
                            ${escapeHtml(e.public_token || '')}
                          </span>
                        </div>
                      </div>

                      <div>
                        <span class="badge ${e.is_published ? 'published' : 'draft'}">
                          ${e.is_published ? 'Published' : 'Draft'}
                        </span>

                        ${
                          pastEvent
                            ? `
                              <span class="badge past-ready">
                                Past · Ready to delete
                              </span>
                            `
                            : ''
                        }
                      </div>

                    </div>

                    ${
                      e.logo_url
                        ? `
                          <div style="margin:12px 0 6px;">
                            <img
                              src="${escapeHtml(e.logo_url)}"
                              alt="Logo"
                              style="
                                max-width:56px;
                                max-height:56px;
                                border-radius:8px;
                                display:block;
                              "
                            />
                          </div>
                        `
                        : ''
                    }

                    <div class="stats">

                      <div class="stat">
                        <div class="stat-label">Guests</div>
                        <div class="stat-value">${e.guest_count}</div>
                      </div>

                      <div class="stat">
                        <div class="stat-label">Last Import</div>
                        <div class="small">
                          ${escapeHtml(e.last_import_file_name || 'None')}
                        </div>
                      </div>

                    </div>

                    <div class="event-meta">
                      <div>
                        Venue:
                        ${escapeHtml(e.venue || 'Not set')}
                      </div>

                      <div>
                        Event Date:
                        ${escapeHtml(formatDate(e.event_date))}
                      </div>

                      <div>
                        Public URL:
                        <a href="/e/${encodeURIComponent(e.public_token || '')}">
                          /e/${escapeHtml(e.public_token || '')}
                        </a>
                      </div>

                      <div>
                        Updated:
                        ${escapeHtml(formatDateTime(e.last_imported_at))}
                      </div>

                      <div>
                        Theme:
                        ${escapeHtml(e.primary_color || '#1f3c88')}
                        /
                        ${escapeHtml(e.tertiary_color || '#eef3ff')}
                      </div>
                    </div>

                    <div class="actions">

                      <a
                        class="button secondary"
                        href="/admin/events/${encodeURIComponent(e.public_token || '')}"
                      >
                        Manage
                      </a>

                      <a
                        class="button secondary"
                        href="/e/${encodeURIComponent(e.public_token || '')}"
                      >
                        View Search
                      </a>

                      <a
                        class="button secondary"
                        href="/admin/events/${encodeURIComponent(e.public_token || '')}/upload"
                      >
                        Upload File
                      </a>

                      ${
                        e.is_published
                          ? `
                            <a
                              class="button secondary"
                              href="/admin/events/${encodeURIComponent(e.public_token || '')}/unpublish"
                            >
                              Unpublish
                            </a>
                          `
                          : `
                            <a
                              class="button success"
                              href="/admin/events/${encodeURIComponent(e.public_token || '')}/publish"
                            >
                              Publish
                            </a>
                          `
                      }

                      <a
                        class="button danger"
                        href="/admin/events/${encodeURIComponent(e.public_token || '')}/delete"
                      >
                        Delete
                      </a>

                    </div>

                  </div>
                `;
              }).join('')}

            </div>
          `
          : `
            <div class="empty-state">

              <h2 style="margin-top:0;">
                No events yet
              </h2>

              <p>
                Create your first event to start importing guest lists
                and publishing search pages.
              </p>

              <div class="actions" style="justify-content:center;">
                <a class="button" href="/admin/events/new">
                  Create Event
                </a>
              </div>

            </div>
          `
      }
    `;

    res.send(
      renderLayout('Admin Events', body)
    );
  } catch (err) {
    res.status(500).send(
      renderLayout(
        'Error',
        `<div class="notice danger">${escapeHtml(err.message)}</div>`
      )
    );
  }
});

router.get('/admin/events/new', (req, res) => {
  const allowedVenues = getAllowedVenuesForRequest(req);

  if (!req.session.adminUser.isSuperAdmin && allowedVenues.length === 0) {
    return res.status(403).send(
      renderLayout(
        'Forbidden',
        `<div class="notice danger">You do not have access to create events.</div>`
      )
    );
  }

  const body = `
    ${adminNav(req, [{ href: '/admin/events', label: 'Events' }])}
    <div class="panel">
      <h1>Create Event</h1>
      <form method="POST" action="/admin/events/new">
        <label>Event name</label>
        <input type="text" name="name" required />
        <label>Venue</label>
        <select name="venue" required>${renderVenueOptions('', allowedVenues)}</select>
        <label>Event date</label>
        <input type="date" name="event_date" />
        <div class="actions">
          <button type="submit">Create Event</button>
          <a class="button secondary" href="/admin/events">Cancel</a>
        </div>
      </form>
    </div>
  `;

  return res.send(renderLayout('Create Event', body));
});

router.post('/admin/events/new', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const venue = parseVenueInput(req.body?.venue);
  const eventDate = parseEventDateInput(req.body?.event_date);

  if (!name || !venue) {
    return res.status(400).send(
      renderLayout('Validation Error', `<div class="notice danger">Event name and venue are required.</div>`)
    );
  }

  if (!hasVenueAccess(req, venue)) {
    return res.status(403).send(
      renderLayout('Forbidden', `<div class="notice danger">You do not have access to this venue.</div>`)
    );
  }

  const token = generateToken();
  await pool.query(
    `
    INSERT INTO events (name, public_token, venue, event_date, is_published)
    VALUES ($1, $2, $3, $4, false)
    `,
    [name, token, venue, eventDate]
  );

  return res.redirect(`/admin/events/${encodeURIComponent(token)}`);
});

router.get('/admin/events/:token', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());

  if (!event) {
    return res.status(404).send(renderLayout('Not Found', `<div class="notice danger">Event not found.</div>`));
  }

  if (!hasVenueAccess(req, event.venue)) {
    return res.status(403).send(renderLayout('Forbidden', `<div class="notice danger">You do not have access to this event.</div>`));
  }

  const publicSearchUrl = getPublicSearchUrl(req, event.public_token);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(publicSearchUrl)}`;

  return res.send(renderLayout(`Manage: ${event.name}`, `
    ${adminNav(req, [{ href: '/admin/events', label: 'Events' }])}
    <div class="hero"><div><h1>Manage Event</h1><p>${escapeHtml(event.name)}</p></div></div>
    <div class="grid two">
      <div class="panel">
        <h2 style="margin-top:0;">Branding & Search Theme</h2>
        <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/branding" enctype="multipart/form-data">
          <div class="field"><label>Primary color</label><input type="text" name="primary_color" value="${escapeHtml(event.primary_color || '#1f3c88')}" placeholder="#1f3c88" /></div>
          <div class="field"><label>Tertiary color</label><input type="text" name="tertiary_color" value="${escapeHtml(event.tertiary_color || '#eef3ff')}" placeholder="#eef3ff" /></div>
          <div class="field"><label>Client logo</label><input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/gif" /></div>
          ${event.logo_url ? `<div class="field"><label><input type="checkbox" name="remove_logo" value="1" /> Remove current logo</label></div>` : ''}
          <div class="actions"><button type="submit">Save Branding</button><a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}/upload">Upload Guests</a></div>
        </form>
      </div>
      <div class="panel">
        <h2 style="margin-top:0;">QR Code & Public Link</h2>
        <p class="muted">Share this QR at venue for guest self lookup.</p>
        <div class="qr-panel"><img class="qr-image" src="${qrUrl}" alt="QR code for ${escapeHtml(event.name)}" /></div>
        <div class="field" style="margin-top:12px;"><label>Public search URL</label><input type="text" readonly value="${escapeHtml(publicSearchUrl)}" /></div>
      </div>
    </div>
  `));
});

router.post('/admin/events/:token/branding', logoUpload.single('logo'), async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', `<div class="notice danger">Event not found.</div>`));
  if (!hasVenueAccess(req, event.venue)) return res.status(403).send(renderLayout('Forbidden', `<div class="notice danger">You do not have access to this event.</div>`));

  const primaryColor = normalizeHexColor(req.body.primary_color, '#1f3c88');
  const tertiaryColor = normalizeHexColor(req.body.tertiary_color, '#eef3ff');
  let logoUrl = event.logo_url;

  if (String(req.body.remove_logo || '') === '1') {
    logoUrl = null;
  }

  if (req.file) {
    logoUrl = imageBufferToDataUrl(req.file);
  }

  await pool.query('UPDATE events SET primary_color = $2, tertiary_color = $3, logo_url = $4 WHERE id = $1', [event.id, primaryColor, tertiaryColor, logoUrl]);
  return res.redirect(`/admin/events/${encodeURIComponent(event.public_token)}`);
});


router.get('/admin/events/:token/upload', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', `<div class="notice danger">Event not found.</div>`));
  if (!hasVenueAccess(req, event.venue)) return res.status(403).send(renderLayout('Forbidden', `<div class="notice danger">You do not have access to this event.</div>`));

  const body = `
    ${adminNav(req, [{ href: '/admin/events', label: 'Events' }])}
    <div class="panel" style="max-width: 840px; margin: 0 auto;">
      <h1 style="margin-top: 0;">Upload Guest List</h1>
      <p class="muted"><strong>${escapeHtml(event.name)}</strong> (${escapeHtml(event.venue || 'No venue')})</p>
      <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/upload" enctype="multipart/form-data">
        <div class="field">
          <label for="guest_file">CSV / XLSX file</label>
          <input id="guest_file" type="file" name="guest_file" accept=".csv,.xlsx,.xls" required />
        </div>
        <div class="actions">
          <button type="submit">Continue</button>
          <a class="button secondary" href="/admin/events">Cancel</a>
        </div>
      </form>
    </div>`;

  return res.send(renderLayout(`Upload: ${event.name}`, body));
});

router.post('/admin/events/:token/upload', guestUpload.single('guest_file'), async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', `<div class="notice danger">Event not found.</div>`));
  if (!hasVenueAccess(req, event.venue)) return res.status(403).send(renderLayout('Forbidden', `<div class="notice danger">You do not have access to this event.</div>`));

  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).send(renderLayout('Upload Error', '<div class="notice danger">Please select a file to upload.</div>'));
    }

    const parsed = parseWorkbookFromBuffer(req.file.buffer, req.file.originalname || 'upload');
    const sessionToken = generateUploadToken();
    uploadSessions.set(sessionToken, { eventId: event.id, parsed });

    const headers = parsed.headers;
    const nameIndex = detectColumnIndex(headers, ['full name', 'name', 'guest name', 'attendee']);
    const companyIndex = detectColumnIndex(headers, ['company', 'organisation', 'organization', 'business']);
    const tableIndex = detectColumnIndex(headers, ['table', 'table name', 'table no', 'table number', 'seat']);

    const body = `
      ${adminNav(req, [{ href: '/admin/events', label: 'Events' }])}
      <div class="panel" style="max-width: 1100px; margin: 0 auto;">
        <h1 style="margin-top:0;">Map Columns</h1>
        <p class="muted">${escapeHtml(parsed.originalName)} · ${parsed.rows.length} rows detected</p>
        ${renderPreviewTable(parsed.headers, parsed.rows, 8)}
        <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/upload/confirm">
          <input type="hidden" name="upload_token" value="${escapeHtml(sessionToken)}" />
          <div class="field"><label>Full name column</label>${renderMappingSelect('full_name_col', headers, nameIndex)}</div>
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
  if (!event) return res.status(404).send(renderLayout('Not Found', `<div class="notice danger">Event not found.</div>`));
  if (!hasVenueAccess(req, event.venue)) return res.status(403).send(renderLayout('Forbidden', `<div class="notice danger">You do not have access to this event.</div>`));

  const uploadToken = String(req.body.upload_token || '').trim();
  const state = uploadSessions.get(uploadToken);
  if (!state || state.eventId !== event.id) {
    return res.status(400).send(renderLayout('Upload Expired', `<div class="panel"><div class="notice danger">Upload session expired. Please upload the file again.</div><a class="button" href="/admin/events/${encodeURIComponent(event.public_token)}/upload">Upload Again</a></div>`));
  }

  const fullNameCol = Number(req.body.full_name_col);
  const companyCol = Number(req.body.company_col);
  const tableCol = Number(req.body.table_col);

  if (!Number.isInteger(tableCol) || tableCol < 0) {
    return res.status(400).send(renderLayout('Mapping Error', '<div class="notice danger">Table column is required.</div>'));
  }

  const rows = state.parsed.rows.map((row) => ({
    fullName: Number.isInteger(fullNameCol) && fullNameCol >= 0 ? normalizeCell(row[fullNameCol]) : '',
    company: Number.isInteger(companyCol) && companyCol >= 0 ? normalizeCell(row[companyCol]) : '',
    tableName: normalizeCell(row[tableCol])
  })).filter((r) => r.tableName && (r.fullName || r.company));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM guests WHERE event_id = $1', [event.id]);
    for (const row of rows) {
      await client.query('INSERT INTO guests (event_id, full_name, company, table_name) VALUES ($1,$2,$3,$4)', [event.id, row.fullName, row.company, row.tableName]);
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

  return res.redirect('/admin/events');
});

router.get('/admin/events/:token/publish', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', `<div class="notice danger">Event not found.</div>`));
  if (!hasVenueAccess(req, event.venue)) return res.status(403).send(renderLayout('Forbidden', `<div class="notice danger">You do not have access to this event.</div>`));
  await pool.query('UPDATE events SET is_published = true WHERE id = $1', [event.id]);
  return res.redirect('/admin/events');
});

router.get('/admin/events/:token/unpublish', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', `<div class="notice danger">Event not found.</div>`));
  if (!hasVenueAccess(req, event.venue)) return res.status(403).send(renderLayout('Forbidden', `<div class="notice danger">You do not have access to this event.</div>`));
  await pool.query('UPDATE events SET is_published = false WHERE id = $1', [event.id]);
  return res.redirect('/admin/events');
});

router.get('/admin/events/:token/delete', async (req, res) => {
  const event = await getEventByToken(String(req.params.token || '').trim());
  if (!event) return res.status(404).send(renderLayout('Not Found', `<div class="notice danger">Event not found.</div>`));
  if (!hasVenueAccess(req, event.venue)) return res.status(403).send(renderLayout('Forbidden', `<div class="notice danger">You do not have access to this event.</div>`));
  await pool.query('DELETE FROM guests WHERE event_id = $1', [event.id]);
  await pool.query('DELETE FROM events WHERE id = $1', [event.id]);
  return res.redirect('/admin/events');
});

module.exports = router;
