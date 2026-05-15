function normalizeCell(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function formatDateTime(value) {
  if (!value) return 'Never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';

  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function formatDate(value) {
  if (!value) return 'Not set';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';

  return date.toLocaleDateString('en-AU', {
    timeZone: 'Australia/Adelaide',
    dateStyle: 'medium'
  });
}

function detectColumnIndex(headers, keywords) {
  const lowered = headers.map(h => String(h || '').toLowerCase().trim());

  for (const keyword of keywords) {
    const exactIndex = lowered.findIndex(h => h === keyword);
    if (exactIndex !== -1) return exactIndex;
  }

  for (const keyword of keywords) {
    const containsIndex = lowered.findIndex(h => h.includes(keyword));
    if (containsIndex !== -1) return containsIndex;
  }

  return '';
}

function normalizeHexColor(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;

  const match = raw.match(/^#?[0-9a-fA-F]{6}$/);
  if (!match) return fallback;

  return raw.startsWith('#') ? raw : `#${raw}`;
}

module.exports = {
  normalizeCell,
  formatDateTime,
  formatDate,
  detectColumnIndex,
  normalizeHexColor
};
