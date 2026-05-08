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
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  const redirectUri = process.env.ENTRA_REDIRECT_URI;

  if (!tenantId || !clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { tenantId, clientId, clientSecret, redirectUri };
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;

  const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
  return JSON.parse(payload);
}

router.get('/auth/entra', (req, res) => {
  const config = getEntraConfig();
  if (!config) {
    return res.status(500).json({
      error: 'Entra auth configuration missing',
      required_env: ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ENTRA_REDIRECT_URI']
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

router.get('/auth/entra/callback', async (req, res) => {
  const config = getEntraConfig();
  if (!config) {
    return res.status(500).json({ error: 'Entra auth configuration missing' });
  }

  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return res.status(401).json({ error, error_description: errorDescription || 'Authentication failed' });
  }

  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).json({ error: 'Invalid OAuth state or missing code' });
  }

  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: String(code),
    redirect_uri: config.redirectUri,
    scope: 'openid profile email'
  });

  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!tokenResponse.ok) {
    const details = await tokenResponse.text();
    return res.status(401).json({ error: 'Token exchange failed', details });
  }

  const tokenSet = await tokenResponse.json();
  const claims = parseJwt(tokenSet.id_token);

  req.session.user = {
    sub: claims?.sub,
    email: claims?.preferred_username || claims?.email,
    name: claims?.name,
    oid: claims?.oid,
    tid: claims?.tid
  };

  delete req.session.oauthState;
  const nextPath = req.session.oauthNext || '/admin/events';
  delete req.session.oauthNext;

  return res.redirect(302, nextPath);
});

router.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect(302, '/admin/login');
  });
});

router.get('/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ authenticated: false });
  return res.status(200).json({ authenticated: true, user: req.session.user });
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
