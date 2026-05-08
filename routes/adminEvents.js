const express = require('express');

const router = express.Router();

router.get('/admin/events', (_req, res) => {
  res.status(200).json({ events: [] });
});

module.exports = router;
