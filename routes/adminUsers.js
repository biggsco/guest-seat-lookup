const express = require('express');
const { renderLayout } = require('../render');

const router = express.Router();

router.get('/admin/users', (_req, res) => {
  res.status(200).send(
    renderLayout(
      'Admin Users',
      `
      <h1>Admin: Users</h1>
      <p>No admin users are configured yet.</p>
      <p><a href="/admin/events">Back to events</a></p>
      `
    )
  );
});

module.exports = router;
