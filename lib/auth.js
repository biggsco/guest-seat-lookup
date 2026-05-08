const crypto = require('crypto');

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

function getEntraConfig() {
  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  const redirectUri = process.env.ENTRA_REDIRECT_URI;

  if (!tenantId || !clientId || !clientSecret || !redirectUri) return null;
  return { tenantId, clientId, clientSecret, redirectUri };
}

function createOauthState() {
  return crypto.randomBytes(24).toString('hex');
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;

  const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
  return JSON.parse(payload);
}

module.exports = { buildNextPath, getEntraConfig, createOauthState, parseJwt };
