const express = require('express');
const { pool } = require('../db');
const { escapeHtml, renderLayout } = require('../render');
const { requireAdmin, adminNav } = require('../lib/auth');
const { buildAuthUrl, exchangeCode } = require('../lib/entra');

const router = express.Router();

function safeNext(value) {
  const n = String(value || '').trim();
  return n.startsWith('/admin') ? n : '/admin/events';
}

router.get('/admin/login', (req, res) => {
  if (req.session?.adminUser) {
    return res.redirect(safeNext(req.query.next));
  }

  const error = escapeHtml(req.query.error || '');

  res.send(
    renderLayout(
      'Admin Login',
      `
        <div class="panel" style="max-width: 520px; margin: 48px auto; text-align: center;">
          <h1 style="margin-top: 0;">Admin Login</h1>
          ${error ? `<div class="notice danger" style="text-align:left;">${error}</div>` : ''}
          <p class="muted">Sign in with your Microsoft account to manage events.</p>
          <a class="button" href="/auth/entra${req.query.next ? `?next=${encodeURIComponent(req.query.next)}` : ''}">Sign in with Microsoft</a>
        </div>
      `
    )
  );
});

router.get('/auth/entra', async (req, res) => {
  try {
    const { url, state, verifier } = await buildAuthUrl(req);

    req.session.entraOidc = {
      state,
      verifier,
      next: safeNext(req.query.next)
    };

    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );

    return res.redirect(url);
  } catch (err) {
    return res.redirect(`/admin/login?error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/auth/entra/callback', async (req, res) => {
  const oidc = req.session.entraOidc || {};
  const next = safeNext(oidc.next);

  // Validate state to prevent CSRF
  if (!oidc.state || req.query.state !== oidc.state) {
    return res.redirect('/admin/login?error=Invalid+authentication+state.+Please+try+again.');
  }

  if (req.query.error) {
    const msg = escapeHtml(req.query.error_description || req.query.error);
    return res.redirect(`/admin/login?error=${encodeURIComponent(msg)}`);
  }

  try {
    const { email } = await exchangeCode(req, req.query.code);

    if (!email) {
      return res.redirect('/admin/login?error=No+email+returned+from+Microsoft.');
    }

    const result = await pool.query(
      'SELECT id, username, is_super_admin, allowed_venues FROM admins WHERE lower(username) = lower($1)',
      [email]
    );

    const admin = result.rows[0];
    if (!admin) {
      return res.redirect('/admin/login?error=Your+Microsoft+account+is+not+authorised.+Contact+a+super+admin.');
    }

    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );

    req.session.adminUser = {
      id: admin.id,
      username: admin.username,
      isSuperAdmin: Boolean(admin.is_super_admin),
      allowedVenues: Array.isArray(admin.allowed_venues) ? admin.allowed_venues : []
    };

    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );

    return res.redirect(next);
  } catch (err) {
    return res.redirect(`/admin/login?error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/admin/logout', (req, res) => {
  if (!req.session) return res.redirect('/admin/login');
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.get('/admin', (req, res) => {
  res.redirect('/admin/events');
});

module.exports = router;
