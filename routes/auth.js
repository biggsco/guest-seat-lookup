const express = require('express');

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

  // Break infinite login nesting loops.
  if (normalized.startsWith('/admin/login')) return '/admin/events';

  return normalized;
}

router.get('/auth/entra', (req, res) => {
  const nextPath = buildNextPath(req.query.next);

  // Placeholder until OIDC wiring is completed.
  res.status(501).json({
    error: 'Entra auth is not configured yet.',
    next: nextPath
  });
});

// Main login entry: always hand off to Entra route with a safe next path.
router.get('/admin/login', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  return res.redirect(302, `/auth/entra?next=${encodeURIComponent(nextPath)}`);
});

// Backwards-compatibility route for stale login links.
router.get('/admin/login/entra', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  return res.redirect(302, `/auth/entra?next=${encodeURIComponent(nextPath)}`);
});

module.exports = router;
