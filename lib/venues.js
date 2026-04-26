const VENUE_OPTIONS = [
  'Adelaide Convention Centre',
  'Adelaide Entertainment Centre',
  'The Drive'
];

function parseSelectedVenues(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  const selected = rawValues
    .map(item => String(item || '').trim())
    .filter(item => VENUE_OPTIONS.includes(item));

  return [...new Set(selected)];
}

function canAccessVenue(allowedVenues, venue) {
  if (!Array.isArray(allowedVenues) || allowedVenues.length === 0) {
    return false;
  }

  return allowedVenues.includes(String(venue || '').trim());
}

module.exports = {
  VENUE_OPTIONS,
  parseSelectedVenues,
  canAccessVenue
};
