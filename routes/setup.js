const express = require('express');

const router = express.Router();

router.get('/setup', (_req, res) => {
  res.status(200).json({ setup: 'ok' });
});

module.exports = router;
