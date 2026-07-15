const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { pool } = require('../db');
const { escapeHtml, renderLayout } = require('../render');
const { requireAdmin, adminNav } = require('../lib/auth');
const { verifyPassword, validatePasswordComplexity, hashPassword } = require('../lib/adminUsers');
const { buildAuthUrl, exchangeCode, isEntraEnabled, getAllowedDomain } = require('../lib/entra');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.username || '').toLowerCase()}`,
  message: 'Too many login attempts. Please wait 15 minutes and try again.'
});

function safeNext(value) {
  const n = String(value || '').trim();
  return n.startsWith('/admin') ? n : '/admin/events';
}

function renderLoginPage({ next = '/admin/events', username = '', error = '' } = {}) {
  const entraButton = isEntraEnabled()
    ? `
      <div style="margin-bottom: 16px;">
        <a class="button" style="width:100%; box-sizing:border-box; text-align:center;" href="/auth/entra${next !== '/admin/events' ? `?next=${encodeURIComponent(next)}` : ''}">
          Sign in with Microsoft
        </a>
      </div>
      <div class="muted" style="text-align:center; margin-bottom:16px;">or sign in with a local account</div>
    `
    : '';

  return renderLayout(
    'Admin Login',
    `
      <div class="panel" style="max-width: 520px; margin: 48px auto;">
        <h1 style="margin-top: 0;">Admin Login</h1>
        <p class="muted">Sign in to manage events and uploads.</p>

        ${error ? `<div class="notice danger">${escapeHtml(error)}</div>` : ''}

        ${entraButton}

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
      </div>
    `
  );
}

router.get('/admin/login', (req, res) => {
  const next = safeNext(req.query.next);
  if (req.session?.adminUser) return res.redirect(next);
  res.send(renderLoginPage({ next, error: req.query.error || '' }));
});

router.post('/admin/login', loginLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next);

  if (!username || !password) {
    return res.status(400).send(renderLoginPage({ next, username, error: 'Username and password are required.' }));
  }

  try {
    const result = await pool.query(
      'SELECT id, username, password_hash, is_super_admin, allowed_venues FROM admins WHERE lower(username) = lower($1)',
      [username]
    );
    const admin = result.rows[0];

    if (!admin || !admin.password_hash || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).send(renderLoginPage({ next, username, error: 'Invalid username or password.' }));
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).send(renderLoginPage({ next, username, error: err.message }));

      req.session.adminUser = {
        id: admin.id,
        username: admin.username,
        isSuperAdmin: Boolean(admin.is_super_admin),
        allowedVenues: Array.isArray(admin.allowed_venues) ? admin.allowed_venues : []
      };

      req.session.save(() => res.redirect(next));
    });
  } catch (err) {
    return res.status(500).send(renderLoginPage({ next, username, error: err.message }));
  }
});

// ── Entra routes (only active when ENTRA_ENABLED=true) ───────────────────────

router.get('/auth/entra', async (req, res) => {
  if (!isEntraEnabled()) return res.redirect('/admin/login');

  try {
    const { url, state, verifier } = await buildAuthUrl(req);

    req.session.entraOidc = { state, verifier, next: safeNext(req.query.next) };
    await new Promise((resolve, reject) =>
      req.session.save((e) => (e ? reject(e) : resolve()))
    );

    return res.redirect(url);
  } catch (err) {
    return res.redirect(`/admin/login?error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/auth/entra/callback', async (req, res) => {
  if (!isEntraEnabled()) return res.redirect('/admin/login');

  const oidc = req.session.entraOidc || {};
  const next = safeNext(oidc.next);

  if (!oidc.state || req.query.state !== oidc.state) {
    return res.redirect('/admin/login?error=Invalid+authentication+state.+Please+try+again.');
  }

  if (req.query.error) {
    return res.redirect(`/admin/login?error=${encodeURIComponent(req.query.error_description || req.query.error)}`);
  }

  try {
    const { email } = await exchangeCode(req, req.query);

    if (!email) {
      return res.redirect('/admin/login?error=No+email+returned+from+Microsoft.');
    }

    const allowedDomain = getAllowedDomain();
    if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
      return res.redirect(`/admin/login?error=Access+restricted+to+${encodeURIComponent(allowedDomain)}+accounts.`);
    }

    // Upsert into admins table so the user appears in Admin → Users
    // and can be promoted/demoted by a super admin. Preserve existing
    // is_super_admin if they already have a row.
    const upsertResult = await pool.query(
      `INSERT INTO admins (username, is_super_admin)
       VALUES ($1, FALSE)
       ON CONFLICT (username) DO UPDATE SET updated_at = NOW()
       RETURNING id, username, is_super_admin, allowed_venues`,
      [email]
    );
    const admin = upsertResult.rows[0];

    await new Promise((resolve, reject) =>
      req.session.regenerate((e) => (e ? reject(e) : resolve()))
    );

    req.session.adminUser = {
      id: admin.id,
      username: admin.username,
      isSuperAdmin: Boolean(admin.is_super_admin),
      allowedVenues: Array.isArray(admin.allowed_venues) ? admin.allowed_venues : []
    };

    await new Promise((resolve, reject) =>
      req.session.save((e) => (e ? reject(e) : resolve()))
    );

    return res.redirect(next);
  } catch (err) {
    return res.redirect(`/admin/login?error=${encodeURIComponent(err.message)}`);
  }
});

// ── Local account password management ────────────────────────────────────────

router.get('/admin/logout', (req, res) => {
  if (!req.session) return res.redirect('/admin/login');
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.get('/admin', (req, res) => res.redirect('/admin/events'));

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

  const err = validatePasswordComplexity(newPassword);
  if (err) return res.status(400).send(escapeHtml(err));

  try {
    const result = await pool.query('SELECT id, password_hash FROM admins WHERE id = $1', [req.session.adminUser.id]);
    const admin = result.rows[0];

    if (!admin) return res.status(404).send('Admin account not found.');
    if (!admin.password_hash || !verifyPassword(currentPassword, admin.password_hash)) {
      return res.status(401).send('Current password is incorrect.');
    }

    await pool.query('UPDATE admins SET password_hash = $2, updated_at = NOW() WHERE id = $1', [admin.id, hashPassword(newPassword)]);
    return res.redirect('/admin/events');
  } catch (e) {
    return res.status(500).send(escapeHtml(e.message));
  }
});

module.exports = router;
