const express = require('express');

const router = express.Router();

router.get('/admin/users', (_req, res) => {
  res.status(200).json({ users: [] });
});

module.exports = router;
