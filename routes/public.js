const express = require('express');
const { renderLayout } = require('../render');

const router = express.Router();

router.get('/', (_req, res) => {
  res.status(200).send(
    renderLayout(
      'Guest Seating Lookup',
      `
      <section class="panel"><h1>Guest Seating Lookup</h1>
      <p>Find your table assignment or sign in to manage events.</p>
      <p><a class="button" href="/admin/login?next=/admin/events">Admin sign in</a></p></section>
      `
    )
  );
});

router.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

module.exports = router;
