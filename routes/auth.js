const express = require('express');
const { renderLayout, escapeHtml } = require('../render');
const { formatError } = require('../lib/formatting');
const { buildNextPath, getEntraConfig, createOauthState, parseJwt } = require('../lib/auth');

const router = express.Router();

router.get('/auth/entra', (req, res) => {
  const config = getEntraConfig();
  const nextPath = buildNextPath(req.query.next);

  if (!config) {
    return res.redirect(
      302,
      `/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(
        'Entra auth is not configured yet. Ask an admin to set ENTRA_* environment variables.'
      )}`
    );
  }

  const state = createOauthState();
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
  const nextPath = buildNextPath(req.session.oauthNext || '/admin/events');

  if (!config) {
    return res.redirect(
      302,
      `/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('Entra auth configuration is missing.')}`
    );
  }

  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return res.redirect(
      302,
      `/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(formatError(errorDescription, 'Authentication failed.'))}`
    );
  }

  if (!code || !state || state !== req.session.oauthState) {
    return res.redirect(
      302,
      `/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('Invalid OAuth state or missing authorization code.')}`
    );
  }

  try {
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
      throw new Error(`Token exchange failed: ${details}`);
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
    const target = req.session.oauthNext || '/admin/events';
    delete req.session.oauthNext;

    return res.redirect(302, target);
  } catch (err) {
    return res.redirect(
      302,
      `/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(formatError(err, 'Authentication failed.'))}`
    );
  }
});

router.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect(302, '/admin/login');
  });
});

router.get('/admin/login', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  const error = req.query.error ? escapeHtml(req.query.error) : '';

  return res.status(200).send(
    renderLayout(
      'Admin Sign in',
      `
      <section class="panel">
        <h1>Admin sign in</h1>
        <p class="muted">Use Microsoft Entra to access event management.</p>
        ${error ? `<div class="result-card">${error}</div>` : ''}
        <p><a class="button" href="/auth/entra?next=${encodeURIComponent(nextPath)}">Continue with Entra</a></p>
      </section>
      `
    )
  );
});

router.get('/admin/login/entra', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  return res.redirect(302, `/auth/entra?next=${encodeURIComponent(nextPath)}`);
});

module.exports = router;
