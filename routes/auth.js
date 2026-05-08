const express = require('express');
const { renderLayout, escapeHtml } = require('../render');

const router = express.Router();

function safeDecode(value, rounds = 5) {
  let decoded = String(value || '');

  for (let i = 0; i < rounds; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }

  return decoded;
}

function buildNextPath(next) {
  if (!next || typeof next !== 'string') return '/admin/events';

  const decoded = safeDecode(next).trim();
  const normalized = decoded.startsWith('/') ? decoded : `/${decoded}`;

  if (normalized.startsWith('/admin/login')) return '/admin/events';

  return normalized;
}

router.get('/auth/entra', (req, res) => {
  const nextPath = buildNextPath(req.query.next);

  const isConfigured = Boolean(
    process.env.ENTRA_TENANT_ID &&
      process.env.ENTRA_CLIENT_ID &&
      process.env.ENTRA_CLIENT_SECRET &&
      process.env.ENTRA_REDIRECT_URI
  );

  if (!isConfigured) {
    return res.redirect(
      302,
      `/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(
        'Entra auth is not configured yet. Ask an admin to set ENTRA_* environment variables.'
      )}`
    );
  }

  return res.status(501).send(
    renderLayout(
      'Sign in',
      `
      <h1>Sign in unavailable</h1>
      <p>Entra sign-in is configured, but the callback flow is not implemented on this branch yet.</p>
      <p><a href="${escapeHtml(nextPath)}">Continue</a></p>
      `
    )
  );
});

router.get('/admin/login', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  const error = req.query.error ? escapeHtml(req.query.error) : '';

  return res.status(200).send(
    renderLayout(
      'Admin Sign in',
      `
      <h1>Admin sign in</h1>
      ${error ? `<div class="result-card">${error}</div>` : ''}
      <p>Use Microsoft Entra to continue to the admin area.</p>
      <p><a href="/auth/entra?next=${encodeURIComponent(nextPath)}">Continue with Entra</a></p>
      `
    )
  );
});

router.get('/admin/login/entra', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  return res.redirect(302, `/auth/entra?next=${encodeURIComponent(nextPath)}`);
});

module.exports = router;
