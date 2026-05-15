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

module.exports = router;
