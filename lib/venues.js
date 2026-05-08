function normalizeVenueName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

module.exports = { normalizeVenueName };
