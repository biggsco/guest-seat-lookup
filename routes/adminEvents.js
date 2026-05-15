const express = require('express');
const { renderLayout } = require('../render');

const router = express.Router();

router.get('/admin/events', (req, res) => {
  if (!req.session?.user) return res.redirect(302, '/admin/login?error=Please sign in.');
  res.status(200).send(
    renderLayout(
      'Admin Events',
      `
      <section class="panel"><h1>Admin: Events</h1>
      <p>No events are loaded yet.</p>
      <p><a class="button" href="/admin/users">View users</a></p>
      <p><a class="button" href="/auth/logout">Sign out</a></p></section>
      `
    )
  );
});

module.exports = router;
