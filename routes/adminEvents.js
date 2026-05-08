const express = require('express');
const { renderLayout } = require('../render');

const router = express.Router();

router.get('/admin/events', (_req, res) => {
  res.status(200).send(
    renderLayout(
      'Admin Events',
      `
      <h1>Admin: Events</h1>
      <p>No events are loaded yet.</p>
      <p><a href="/admin/users">View users</a></p>
      `
    )
  );
});

module.exports = router;
