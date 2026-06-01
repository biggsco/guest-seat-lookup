const express = require('express');
const { renderLayout, escapeHtml } = require('../render');
const { pool } = require('../db');

const router = express.Router();

router.get('/setup', async (_req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SETUP_ROUTE !== 'true') {
    return res.status(404).send('Not found');
  }

  try {
    const { ensureGuestSeatsTable } = require('../lib/guestSeats');
    await ensureGuestSeatsTable();

    res.status(200).send(renderLayout('Setup', '<section class="panel"><h1>Setup complete</h1><p>Schema checks ran successfully.</p></section>'));
  } catch (err) {
    res.status(500).send(renderLayout('Setup failed', `<section class="panel"><h1>Setup failed</h1><pre>${escapeHtml(err.message)}</pre></section>`));
  }
});

module.exports = router;
