const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { escapeHtml, renderLayout } = require('../render');
const { requireAdmin, adminNav } = require('../lib/auth');

const router = express.Router();

const ENTRA_TENANT_ID = String(process.env.ENTRA_TENANT_ID || 'common').trim();
const ENTRA_CLIENT_ID = String(process.env.ENTRA_CLIENT_ID || '').trim();
const ENTRA_CLIENT_SECRET = String(process.env.ENTRA_CLIENT_SECRET || '').trim();
const ENTRA_REDIRECT_URI = String(process.env.ENTRA_REDIRECT_URI || '').trim();
const ENTRA_SCOPES = String(process.env.ENTRA_SCOPES || 'openid profile email').trim();

function isEntraEnabled() {
  return Boolean(ENTRA_CLIENT_ID && ENTRA_CLIENT_SECRET && ENTRA_REDIRECT_URI);
}

function entraAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: ENTRA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: ENTRA_REDIRECT_URI,
    response_mode: 'query',
    scope: ENTRA_SCOPES,
    state
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(ENTRA_TENANT_ID)}/oauth2/v2.0/authorize?${params.toString()}`;
}

function decodeJwtPayload(token) {
  const segments = String(token || '').split('.');
  if (segments.length < 2) return null;
  const b64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function getAdminByUsername(username) {
  const result = await pool.query(
    `
    SELECT id, username, password_hash, is_super_admin, allowed_venues
    FROM admins
    WHERE username = $1
    `,
    [username]
  );

  return result.rows[0] || null;
}

function renderLoginPage({ next = '/admin/events', username = '', error = '' } = {}) {
  const ssoButton = isEntraEnabled()
    ? `
      <div class="field" style="margin-top: 16px;">
        <a class="button secondary" href="/admin/login/entra?next=${encodeURIComponent(next)}">Sign in with Microsoft</a>
      </div>
    `
    : '';

  return renderLayout(
    'Admin Login',
    `
      <div class="panel" style="max-width: 520px; margin: 48px auto;">
        <h1 style="margin-top: 0;">Admin Login</h1>
        <p class="muted">Sign in to manage events and uploads.</p>

        ${error ? `<div class="notice danger">${escapeHtml(error)}</div>` : ''}

        <form method="POST" action="/admin/login">
          <input type="hidden" name="next" value="${escapeHtml(next)}" />

          <div class="field">
            <label for="username">Username</label>
            <input id="username" name="username" autocomplete="username" required value="${escapeHtml(username)}" />
          </div>

          <div class="field">
            <label for="password">Password</label>
            <input id="password" type="password" name="password" autocomplete="current-password" required />
          </div>

          <div class="actions">
            <button type="submit">Log In</button>
            <a class="button secondary" href="/">Home</a>
          </div>
        </form>
        ${ssoButton}
      </div>
    `
  );
}

router.get('/admin/login/entra', (req, res) => {
  if (!isEntraEnabled()) {
    return res.status(404).send('Microsoft SSO is not configured.');
  }

  const next = (req.query.next || '/admin/events').toString();
  const safeNext = next.startsWith('/admin') ? next : '/admin/events';
  const state = `${Math.random().toString(36).slice(2, 12)}.${Buffer.from(safeNext).toString('base64url')}`;
  req.session.entraLoginState = state;
  return res.redirect(entraAuthorizeUrl(state));
});

router.get('/admin/auth/entra/callback', async (req, res) => {
  if (!isEntraEnabled()) {
    return res.status(404).send('Microsoft SSO is not configured.');
  }

  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const expectedState = String(req.session?.entraLoginState || '');
  delete req.session.entraLoginState;

  if (!code || !state || !expectedState || state !== expectedState) {
    return res.status(400).send('Invalid SSO response state.');
  }

  try {
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(ENTRA_TENANT_ID)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: ENTRA_CLIENT_ID,
          client_secret: ENTRA_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: ENTRA_REDIRECT_URI,
          scope: ENTRA_SCOPES
        })
      }
    );

    if (!tokenRes.ok) {
      return res.status(401).send('Unable to complete Microsoft sign-in.');
    }

    const tokenBody = await tokenRes.json();
    const claims = decodeJwtPayload(tokenBody.id_token || '');
    const principal = String(claims?.preferred_username || claims?.email || claims?.upn || '').trim().toLowerCase();
    if (!principal) return res.status(401).send('Microsoft sign-in did not include an email/UPN.');

    const admin = await getAdminByUsername(principal);
    if (!admin) {
      return res.status(403).send('Your Microsoft account is not authorized for admin access.');
    }

    req.session.adminUser = {
      id: admin.id,
      username: admin.username,
      isSuperAdmin: Boolean(admin.is_super_admin),
      allowedVenues: Array.isArray(admin.allowed_venues) ? admin.allowed_venues : []
    };

    const encodedNext = state.includes('.') ? state.split('.').slice(1).join('.') : '';
    const next = encodedNext ? Buffer.from(encodedNext, 'base64url').toString('utf8') : '/admin/events';
    const safeNext = next.startsWith('/admin') ? next : '/admin/events';
    return res.redirect(safeNext);
  } catch (err) {
    return res.status(500).send(escapeHtml(err.message));
  }
});

router.get('/admin/login', (req, res) => {
  const next = (req.query.next || '/admin/events').toString();
  const safeNext = next.startsWith('/admin') ? next : '/admin/events';

  if (req.session && req.session.adminUser) {
    return res.redirect(safeNext);
  }

  res.send(renderLoginPage({ next: safeNext }));
});

router.post('/admin/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = String(req.body.password || '');
  const next = (req.body.next || '/admin/events').toString();
  const safeNext = next.startsWith('/admin') ? next : '/admin/events';

  if (!username || !password) {
    return res.status(400).send(
      renderLoginPage({
        next: safeNext,
        username,
        error: 'Username and password are required.'
      })
    );
  }

  try {
    const admin = await getAdminByUsername(username);

    if (!admin) {
      return res.status(401).send(
        renderLoginPage({
          next: safeNext,
          username,
          error: 'Invalid username or password.'
        })
      );
    }

    const valid = await bcrypt.compare(password, admin.password_hash);

    if (!valid) {
      return res.status(401).send(
        renderLoginPage({
          next: safeNext,
          username,
          error: 'Invalid username or password.'
        })
      );
    }

    req.session.adminUser = {
      id: admin.id,
      username: admin.username,
      isSuperAdmin: Boolean(admin.is_super_admin),
      allowedVenues: Array.isArray(admin.allowed_venues) ? admin.allowed_venues : []
    };

    return res.redirect(safeNext);
  } catch (err) {
    return res.status(500).send(
      renderLoginPage({
        next: safeNext,
        username,
        error: err.message
      })
    );
  }
});

router.get('/admin/logout', (req, res) => {
  if (!req.session) {
    return res.redirect('/admin/login');
  }

  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

router.get('/admin', (req, res) => {
  res.redirect('/admin/events');
});

router.get('/admin/account/password', requireAdmin, (req, res) => {
  res.send(
    renderLayout(
      'Update Password',
      `
        ${adminNav(req, [{ href: '/admin/events', label: 'Back to Events' }])}
        <div class="panel" style="max-width: 620px; margin: 0 auto;">
          <h1 style="margin-top: 0;">Update Password</h1>
          <p class="muted">Signed in as <strong>${escapeHtml(req.session.adminUser.username)}</strong>.</p>

          <form method="POST" action="/admin/account/password">
            <div class="field">
              <label for="current_password">Current Password</label>
              <input id="current_password" type="password" name="current_password" required />
            </div>
            <div class="field">
              <label for="new_password">New Password</label>
              <input id="new_password" type="password" name="new_password" required />
            </div>
            <div class="actions">
              <button type="submit">Update Password</button>
              <a class="button secondary" href="/admin/events">Cancel</a>
            </div>
          </form>
        </div>
      `
    )
  );
});

router.post('/admin/account/password', requireAdmin, async (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');

  if (!currentPassword || !newPassword) {
    return res.status(400).send('Current and new password are required.');
  }

  if (newPassword.length < 8) {
    return res.status(400).send('New password must be at least 8 characters.');
  }

  try {
    const result = await pool.query(
      `
      SELECT id, password_hash
      FROM admins
      WHERE id = $1
      `,
      [req.session.adminUser.id]
    );

    if (!result.rows[0]) {
      return res.status(404).send('Admin account not found.');
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      return res.status(401).send('Current password is incorrect.');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      `
      UPDATE admins
      SET password_hash = $2
      WHERE id = $1
      `,
      [req.session.adminUser.id, passwordHash]
    );

    return res.redirect('/admin/events');
  } catch (err) {
    return res.status(500).send(escapeHtml(err.message));
  }
});

module.exports = router;
