const { Issuer, generators } = require('openid-client');

let _client = null;

async function getClient() {
  if (_client) return _client;

  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('ENTRA_TENANT_ID, ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET are required when ENTRA_ENABLED=true.');
  }


  const issuer = await Issuer.discover(
    `https://login.microsoftonline.com/${tenantId}/v2.0`
  );

  _client = new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [getRedirectUri()],
    response_types: ['code']
  });

  return _client;
}

function getRedirectUri(req) {
  const configured = String(process.env.ENTRA_REDIRECT_URI || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (configured) return `${configured.replace(/\/auth\/entra\/callback$/, '')}/auth/entra/callback`;
  if (req) return `${req.protocol}://${req.get('host')}/auth/entra/callback`;
  throw new Error('ENTRA_REDIRECT_URI or PUBLIC_BASE_URL must be set.');
}

async function buildAuthUrl(req) {
  const client = await getClient();
  const state = generators.state();
  const verifier = generators.codeVerifier();
  const challenge = generators.codeChallenge(verifier);

  const url = client.authorizationUrl({
    scope: 'openid email profile',
    redirect_uri: getRedirectUri(req),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  return { url, state, verifier };
}

async function exchangeCode(req, params) {
  const client = await getClient();
  const oidc = req.session.entraOidc || {};
  const redirectUri = getRedirectUri(req);

  const tokenSet = await client.callback(redirectUri, params, {
    state: oidc.state,
    code_verifier: oidc.verifier
  });

  const claims = tokenSet.claims();
  const email = (claims.email || claims.preferred_username || '').toLowerCase().trim();

  return { email };
}

function isEntraEnabled() {
  return String(process.env.ENTRA_ENABLED || '').toLowerCase() === 'true';
}

function getAllowedDomain() {
  return String(process.env.ENTRA_ALLOWED_EMAIL_DOMAIN || '').toLowerCase().trim();
}

module.exports = { buildAuthUrl, exchangeCode, isEntraEnabled, getAllowedDomain };
