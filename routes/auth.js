const express = require('express');
const crypto = require('crypto');

const router = express.Router();

function safeDecode(value, rounds = 5) {
  let decoded = String(value || '');
  for (let i = 0; i < rounds; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch (error) {
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

function getEntraConfig() {
  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const redirectUri = process.env.ENTRA_REDIRECT_URI;

  if (!tenantId || !clientId || !redirectUri) {
    return null;
  }

  return { tenantId, clientId, redirectUri };
}

router.get('/auth/entra', (req, res) => {
  const config = getEntraConfig();
  if (!config) {
    return res.status(500).json({
      error: 'Entra auth configuration missing',
      required_env: ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_REDIRECT_URI']
    });
  }

  const nextPath = buildNextPath(req.query.next);
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  req.session.oauthNext = nextPath;

  const authorizeUrl = new URL(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`);
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizeUrl.searchParams.set('response_mode', 'query');
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('state', state);

  return res.redirect(302, authorizeUrl.toString());
});

router.get('/admin/login', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  return res.redirect(302, `/auth/entra?next=${encodeURIComponent(nextPath)}`);
});

router.get('/admin/login/entra', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  return res.redirect(302, `/auth/entra?next=${encodeURIComponent(nextPath)}`);
});

module.exports = router;
