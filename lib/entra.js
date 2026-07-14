const { ConfidentialClientApplication, CryptoProvider } = require('@azure/msal-node');

const SCOPES = ['openid', 'email', 'profile'];

let _client = null;
let _crypto = null;

function getClient() {
  if (!_client) {
    const tenantId = process.env.ENTRA_TENANT_ID;
    const clientId = process.env.ENTRA_CLIENT_ID;
    const clientSecret = process.env.ENTRA_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error('ENTRA_TENANT_ID, ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET are required.');
    }

    _client = new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`
      }
    });
    _crypto = new CryptoProvider();
  }

  return { client: _client, crypto: _crypto };
}

function getRedirectUri(req) {
  const configured = String(process.env.ENTRA_REDIRECT_URI || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const base = configured || `${req.protocol}://${req.get('host')}`;
  return `${base}/auth/entra/callback`;
}

async function buildAuthUrl(req) {
  const { client, crypto } = getClient();
  const { verifier, challenge } = await crypto.generatePkceCodes();
  const state = crypto.createNewGuid();

  const url = await client.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: getRedirectUri(req),
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    state
  });

  return { url, state, verifier };
}

async function exchangeCode(req, code) {
  const { client } = getClient();
  const session = req.session.entraOidc || {};

  const response = await client.acquireTokenByCode({
    code,
    scopes: SCOPES,
    redirectUri: getRedirectUri(req),
    codeVerifier: session.verifier
  });

  // Prefer email claim; fall back to preferred_username (UPN is usually email in Entra)
  const claims = response.idTokenClaims || {};
  const email = (claims.email || claims.preferred_username || '').toLowerCase().trim();

  return { email, displayName: claims.name || email };
}

module.exports = { buildAuthUrl, exchangeCode };
