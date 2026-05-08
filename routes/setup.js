const express = require('express');
const { renderLayout } = require('../render');

const router = express.Router();

router.get('/setup', (_req, res) => {
  res.status(200).send(
    renderLayout(
      'Setup',
      `
      <section class="panel"><h1>Setup</h1>
      <p>Application setup endpoint is reachable.</p></section>
      `
    )
  );
});

module.exports = router;
