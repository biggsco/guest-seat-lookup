const express = require('express');
const multer = require('multer');
const { renderLayout, escapeHtml } = require('../render');
const { parseRowsFromWorkbook, replaceEventSeats } = require('../lib/guestSeats');
const { formatError } = require('../lib/formatting');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function requireLogin(req, res, next) {
  if (!req.session?.user) return res.redirect(302, '/admin/login?error=Please sign in.');
  return next();
}

router.get('/admin/events', requireLogin, (req, res) => {
  const message = req.query.message ? `<div class="result-card">${escapeHtml(req.query.message)}</div>` : '';
  res.status(200).send(
    renderLayout(
      'Admin Events',
      `
      <section class="panel"><h1>Admin: Events</h1>
      ${message}
      <form method="POST" action="/admin/events/upload" enctype="multipart/form-data">
        <label>Event name</label>
        <input name="eventName" required />
        <label>Guest list file (.xlsx/.csv)</label>
        <input type="file" name="guestFile" accept=".xlsx,.xls,.csv" required />
        <p class="muted">Expected columns: guest_name (or name) and table_name (or table).</p>
        <p><button class="button" type="submit">Upload guest list</button></p>
      </form>
      <p><a class="button" href="/admin/users">View users</a></p>
      <p><a class="button" href="/auth/logout">Sign out</a></p></section>
      `
    )
  );
});

router.post('/admin/events/upload', requireLogin, upload.single('guestFile'), async (req, res) => {
  try {
    const eventName = String(req.body.eventName || '').trim();
    if (!eventName) return res.redirect(302, '/admin/events?message=Event%20name%20is%20required.');
    if (!req.file?.buffer) return res.redirect(302, '/admin/events?message=Guest%20file%20is%20required.');

    const seats = parseRowsFromWorkbook(req.file.buffer);
    if (!seats.length) return res.redirect(302, '/admin/events?message=No%20valid%20rows%20found%20in%20file.');

    await replaceEventSeats(eventName, seats);
    return res.redirect(302, `/admin/events?message=${encodeURIComponent(`Uploaded ${seats.length} guests for ${eventName}.`)}`);
  } catch (err) {
    return res.redirect(302, `/admin/events?message=${encodeURIComponent(formatError(err, 'Upload failed.'))}`);
  }
});

module.exports = router;
