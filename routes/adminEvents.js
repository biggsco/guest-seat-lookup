const express = require('express');
const crypto = require('crypto');
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

const router = express.Router();

router.use('/admin', requireAdmin);

const uploadSessions = new Map();

function generateToken() {
  return Math.random().toString(36).slice(2, 10);
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
        e.logo_url,
        e.primary_color,
        e.tertiary_color,
        e.created_at,
        e.last_imported_at,
        e.last_import_file_name
      ORDER BY e.id DESC
      `
    );

    const body = `
      ${adminNav([{ href: '/', label: 'Home' }])}

      <div class="hero">
        <div>
          <h1>Events</h1>
          <p>Signed in as <strong>${escapeHtml(req.session.adminUser.username)}</strong>.</p>
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
                    <div>Theme: ${escapeHtml(e.primary_color || '#1f3c88')} / ${escapeHtml(e.tertiary_color || '#eef3ff')}</div>
                  </div>

                  <div class="actions">
                    <a class="button secondary" href="/admin/events/${encodeURIComponent(e.public_token || '')}">Manage</a>
                    <a class="button secondary" href="/e/${encodeURIComponent(e.public_token || '')}">View Search</a>
                    <a class="button secondary" href="/admin/events/${encodeURIComponent(e.public_token || '')}/upload">Upload File</a>
                    ${
                      e.is_published
                        ? `<a class="button secondary" href="/admin/events/${encodeURIComponent(e.public_token || '')}/unpublish">Unpublish</a>`
                        : `<a class="button success" href="/admin/events/${encodeURIComponent(e.public_token || '')}/publish">Publish</a>`
                    }
                    <a class="button danger" href="/admin/events/${encodeURIComponent(e.public_token || '')}/delete">Delete</a>
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

router.get('/admin/events/new', (req, res) => {
  res.send(
    renderLayout(
      'Create Event',
      `
        ${adminNav([{ href: '/admin/events', label: 'Back to Events' }])}

        <div class="panel" style="max-width: 720px; margin: 0 auto;">
          <h1 style="margin-top: 0;">Create Event</h1>
          <form method="POST" action="/admin/events/new">
            <div class="field">
              <label for="name">Event Name</label>
              <input id="name" name="name" placeholder="Example: Annual Gala 2026" required />
            </div>

            <div class="field-row">
              <div class="field">
                <label for="primary_color">Primary Colour</label>
                <input id="primary_color" name="primary_color" type="color" value="#1f3c88" />
              </div>

              <div class="field">
                <label for="tertiary_color">Tertiary Colour</label>
                <input id="tertiary_color" name="tertiary_color" type="color" value="#eef3ff" />
              </div>
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

router.post('/admin/events/new', async (req, res) => {
  const name = (req.body.name || '').trim();
  const primaryColor = normalizeHexColor(req.body.primary_color, '#1f3c88');
  const tertiaryColor = normalizeHexColor(req.body.tertiary_color, '#eef3ff');

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
      INSERT INTO events (name, public_token, is_published, primary_color, tertiary_color)
      VALUES ($1, $2, false, $3, $4)
      `,
      [name, token, primaryColor, tertiaryColor]
    );

    res.redirect(`/admin/events/${encodeURIComponent(token)}`);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

router.get('/admin/events/:token', async (req, res) => {
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
      ${adminNav([
        { href: '/admin/events', label: 'Back to Events' },
        { href: `/e/${event.public_token}`, label: 'Open Public Search' }
      ])}

      <div class="hero">
        <div>
          <h1>${escapeHtml(event.name)}</h1>
          <p>Manage event status, upload a new guest list, update branding, and monitor what is currently live.</p>
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
              <div>Primary Colour: ${escapeHtml(event.primary_color || '#1f3c88')}</div>
              <div>Tertiary Colour: ${escapeHtml(event.tertiary_color || '#eef3ff')}</div>
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
            <h2>Branding</h2>

            ${
              event.logo_url
                ? `
                  <div style="margin-bottom: 18px;">
                    <img
                      src="${escapeHtml(event.logo_url)}"
                      alt="Event logo"
                      style="max-width: 140px; max-height: 140px; display: block; border-radius: 16px; border: 1px solid #ddd;"
                    />
                  </div>
                `
                : `<div class="notice info" style="margin-bottom: 18px;">No logo uploaded yet.</div>`
            }

            <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/branding">
              <div class="field-row">
                <div class="field">
                  <label for="primary_color">Primary Colour</label>
                  <input
                    id="primary_color"
                    name="primary_color"
                    type="color"
                    value="${escapeHtml(event.primary_color || '#1f3c88')}"
                  />
                </div>

                <div class="field">
                  <label for="tertiary_color">Tertiary Colour</label>
                  <input
                    id="tertiary_color"
                    name="tertiary_color"
                    type="color"
                    value="${escapeHtml(event.tertiary_color || '#eef3ff')}"
                  />
                </div>
              </div>

              <div class="actions">
                <button type="submit">Save Theme</button>
              </div>
            </form>

            <hr style="margin: 24px 0;" />

            <form method="POST" action="/admin/events/${encodeURIComponent(event.public_token)}/logo" enctype="multipart/form-data">
              <div class="field">
                <label for="logoFile">Event Logo</label>
                <input id="logoFile" type="file" name="logoFile" accept=".png,.jpg,.jpeg,.webp,.gif,image/*" />
              </div>

              <div class="actions">
                <button type="submit">Upload Logo</button>
                ${
                  event.logo_url
                    ? `<a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}/logo/remove">Remove Logo</a>`
                    : ''
                }
              </div>
            </form>
          </div>

          <div class="panel">
            <h2>Actions</h2>
            <div class="actions">
              <a class="button secondary" href="/e/${encodeURIComponent(event.public_token)}">View Search</a>
              <a class="button secondary" href="/admin/events/${encodeURIComponent(event.public_token)}/upload">Upload File</a>
            </div>
          </div>

          <div class="danger-zone">
            <h3 style="margin-top: 0;">Danger Zone</h3>
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

router.post('/admin/events/:token/branding', async (req, res) => {
  const token = req.params.token;

  try {
    const event = await getEventByToken(token);

    if (!event) {
      return res.status(404).send('Event not found');
    }

    const primaryColor = normalizeHexColor(req.body.primary_color, '#1f3c88');
    const tertiaryColor = normalizeHexColor(req.body.tertiary_color, '#eef3ff');

    await pool.query(
      `
      UPDATE events
      SET
        primary_color = $2,
        tertiary_color = $3
      WHERE public_token = $1
      `,
      [token, primaryColor, tertiaryColor]
    );

    res.redirect(`/admin/events/${encodeURIComponent(token)}`);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

router.post('/admin/events/:token/logo', logoUpload.single('logoFile'), async (req, res) => {
  const token = req.params.token;

  try {
    const event = await getEventByToken(token);

    if (!event) {
      return res.status(404).send('Event not found');
    }

    if (!req.file) {
      return res.status(400).send('No logo file uploaded');
    }

    const dataUrl = imageBufferToDataUrl(req.file);

    await pool.query(
      `
      UPDATE events
      SET logo_url = $2
      WHERE public_token = $1
      `,
      [token, dataUrl]
    );

    res.redirect(`/admin/events/${encodeURIComponent(token)}`);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

router.get('/admin/events/:token/logo/remove', async (req, res) => {
  const token = req.params.token;

  try {
    await pool.query(
      `
      UPDATE events
      SET logo_url = NULL
      WHERE public_token = $1
      `,
      [token]
    );

    res.redirect(`/admin/events/${encodeURIComponent(token)}`);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

router.get('/admin/events/:token/upload', async (req, res) => {
  const token = req.params.token;

  try {
    const event = await getEventByToken(token);

    if (!event) {
      return res.status(404).send(renderLayout('Not Found', `<div class="notice danger">Event not found.</div>`));
    }

    const body = `
      ${adminNav([
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

router.post('/admin/events/:token/upload', guestUpload.single('guestFile'), async (req, res) => {
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
        full_name: detectColumnIndex(parsed.headers, ['full name', 'fullname', 'guest name', 'name', 'attendee']),
        first_name: detectColumnIndex(parsed.headers, ['first name', 'firstname', 'given name', 'given', 'forename', 'fname', 'first']),
        last_name: detectColumnIndex(parsed.headers, ['last name', 'lastname', 'surname', 'family name', 'lname', 'last']),
        company: detectColumnIndex(parsed.headers, ['company', 'organisation', 'organization', 'business', 'employer']),
        table_name: detectColumnIndex(parsed.headers, ['table', 'table name', 'table number', 'table no'])
      }
    });

    res.redirect(`/admin/uploads/${uploadToken}/map`);
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

router.get('/admin/uploads/:uploadToken/map', (req, res) => {
  const uploadToken = req.params.uploadToken;
  const sessionState = uploadSessions.get(uploadToken);

  if (!sessionState) {
    return res.status(404).send('Upload session not found. Upload the file again.');
  }

  const body = `
    ${adminNav([
      { href: `/admin/events/${sessionState.eventToken}/upload`, label: 'Back to Upload' },
      { href: `/admin/events/${sessionState.eventToken}`, label: 'Event Details' }
    ])}

    <div class="grid two">
      <div class="panel">
        <h1 style="margin-top: 0;">Map Columns</h1>

        <div class="event-meta" style="margin-bottom: 18px;">
          <div>Event: ${escapeHtml(sessionState.eventName)}</div>
          <div>File: ${escapeHtml(sessionState.originalName)}</div>
          <div>Sheet: ${escapeHtml(sessionState.sheetName)}</div>
          <div>Rows Found: ${sessionState.rows.length}</div>
          <div>Import Mode: ${escapeHtml(sessionState.importMode === 'append' ? 'Append' : 'Replace')}</div>
        </div>

        <form method="POST" action="/admin/uploads/${uploadToken}/import">
          <div class="field-row">
            <div class="field">
              <label>Full Name</label>
              ${renderMappingSelect('full_name', sessionState.headers, sessionState.defaults.full_name)}
            </div>

            <div class="field">
              <label>First Name</label>
              ${renderMappingSelect('first_name', sessionState.headers, sessionState.defaults.first_name)}
            </div>

            <div class="field">
              <label>Last Name</label>
              ${renderMappingSelect('last_name', sessionState.headers, sessionState.defaults.last_name)}
            </div>

            <div class="field">
              <label>Company</label>
              ${renderMappingSelect('company', sessionState.headers, sessionState.defaults.company)}
            </div>

            <div class="field">
              <label>Table</label>
              ${renderMappingSelect('table_name', sessionState.headers, sessionState.defaults.table_name)}
            </div>
          </div>

          <div class="notice info">
            Each imported guest row must include at least a name or a company. If Full Name is empty, First Name and Last Name will be combined.
          </div>

          <div class="actions">
            <button type="submit">${sessionState.importMode === 'append' ? 'Append Guests' : 'Replace Guests and Import'}</button>
            <a class="button secondary" href="/admin/events/${encodeURIComponent(sessionState.eventToken)}/upload">Cancel</a>
          </div>
        </form>
      </div>

      <div class="panel">
        <h2 style="margin-top: 0;">Preview</h2>
        <div class="table-wrap">
          ${renderPreviewTable(sessionState.headers, sessionState.rows, 10)}
        </div>
      </div>
    </div>
  `;

  res.send(renderLayout('Map Columns', body, { fullWidth: true }));
});

router.post('/admin/uploads/:uploadToken/import', async (req, res) => {
  const uploadToken = req.params.uploadToken;
  const sessionState = uploadSessions.get(uploadToken);

  if (!sessionState) {
    return res.status(404).send('Upload session not found. Upload the file again.');
  }

  const fullNameIndex = req.body.full_name;
  const firstNameIndex = req.body.first_name;
  const lastNameIndex = req.body.last_name;
  const companyIndex = req.body.company;
  const tableNameIndex = req.body.table_name;

  const hasAnyNameMapping =
    (fullNameIndex !== '' && fullNameIndex !== undefined) ||
    (firstNameIndex !== '' && firstNameIndex !== undefined) ||
    (lastNameIndex !== '' && lastNameIndex !== undefined);

  const hasCompanyMapping =
    (companyIndex !== '' && companyIndex !== undefined);

  if (!hasAnyNameMapping && !hasCompanyMapping) {
    return res.status(400).send('Map at least one of: Full Name, First Name, Last Name, or Company.');
  }

  try {
    await pool.query('BEGIN');

    if (sessionState.importMode === 'replace') {
      await pool.query(
        `DELETE FROM guests WHERE event_id = $1`,
        [sessionState.eventId]
      );
    }

    let imported = 0;

    for (const row of sessionState.rows) {
      const fullNameDirect =
        fullNameIndex === '' ? '' : normalizeCell(row[Number(fullNameIndex)]);

      const firstName =
        firstNameIndex === '' ? '' : normalizeCell(row[Number(firstNameIndex)]);

      const lastName =
        lastNameIndex === '' ? '' : normalizeCell(row[Number(lastNameIndex)]);

      const company =
        companyIndex === '' ? '' : normalizeCell(row[Number(companyIndex)]);

      const table_name =
        tableNameIndex === '' ? '' : normalizeCell(row[Number(tableNameIndex)]);

      const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim();
      const full_name = fullNameDirect || combinedName;

      if (!full_name && !company) {
        continue;
      }

      await pool.query(
        `
        INSERT INTO guests (event_id, full_name, company, table_name)
        VALUES ($1, $2, $3, $4)
        `,
        [sessionState.eventId, full_name, company, table_name]
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
      [sessionState.eventId, sessionState.originalName]
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
                sessionState.importMode === 'append'
                  ? `Appended ${imported} guests`
                  : `Replaced guest list and imported ${imported} guests`
              } into <strong>${escapeHtml(sessionState.eventName)}</strong>.
            </p>

            <div class="actions">
              <a class="button" href="/admin/events/${encodeURIComponent(sessionState.eventToken)}">Back to Event</a>
              <a class="button secondary" href="/e/${encodeURIComponent(sessionState.eventToken)}">Open Public Search</a>
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

router.get('/admin/events/:token/publish', async (req, res) => {
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

router.get('/admin/events/:token/unpublish', async (req, res) => {
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

router.get('/admin/events/:token/clear', async (req, res) => {
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

router.post('/admin/events/:token/clear', async (req, res) => {
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

router.get('/admin/events/:token/delete', async (req, res) => {
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

router.post('/admin/events/:token/delete', async (req, res) => {
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

module.exports = router;
