const express = require('express');

const router = express.Router();

router.get('/', (_req, res) => {
  res.status(200).send('Guest Seating Lookup');
});

router.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

module.exports = router;
