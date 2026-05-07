const express = require('express');

const router = express.Router();

function buildNextPath(next) {
  if (!next || typeof next !== 'string') return '/admin/events';
  return next.startsWith('/') ? next : `/${next}`;
}

router.get('/auth/entra', (req, res) => {
  const nextPath = buildNextPath(req.query.next);

  // Placeholder until OIDC wiring is completed.
  res.status(501).json({
    error: 'Entra auth is not configured yet.',
    next: nextPath
  });
});

// Backwards-compatibility route for stale login links.
router.get('/admin/login/entra', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  const target = `/auth/entra?next=${encodeURIComponent(nextPath)}`;
  return res.redirect(302, target);
});

module.exports = router;
