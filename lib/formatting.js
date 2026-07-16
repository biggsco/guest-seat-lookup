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
    // Avoid substring-matching 'name' inside 'first name' / 'last name' etc.
    // by requiring the header to start with or equal the keyword.
    const startsIndex = lowered.findIndex(h => h === keyword || h.startsWith(keyword));
    if (startsIndex !== -1) return startsIndex;
  }

  for (const keyword of keywords) {
    const containsIndex = lowered.findIndex(h => h.includes(keyword));
    if (containsIndex !== -1) return containsIndex;
  }

  return '';
}

module.exports = {
  normalizeCell,
  formatDateTime,
  formatDate,
  detectColumnIndex
};
