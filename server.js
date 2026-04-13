const express = require('express');
const { testDb } = require('./db');

const app = express();

const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

app.use(express.json());

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Guest Seating Lookup</title></head>
      <body>
        <h1>Guest Seating Lookup</h1>
        <p>Backend is running.</p>
        <ul>
          <li><a href="/search">Public Search</a></li>
          <li><a href="/admin">Admin</a></li>
          <li><a href="/health">Health</a></li>
        </ul>
      </body>
    </html>
  `);
});

app.get('/search', (req, res) => {
  res.send(`
    <html>
      <head><title>Search</title></head>
      <body>
        <h1>Public Search Page</h1>
        <p>This will later search guests by name or company.</p>
      </body>
    </html>
  `);
});

app.get('/admin', (req, res) => {
  res.send(`
    <html>
      <head><title>Admin</title></head>
      <body>
        <h1>Admin Placeholder</h1>
        <p>This will later manage events, uploads, and publishing.</p>
      </body>
    </html>
  `);
});

app.get('/health', async (req, res) => {
  try {
    const db = await testDb();

    res.status(200).json({
      ok: true,
      app: 'guest-seat-lookup',
      db: 'connected',
      time: db.now
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      app: 'guest-seat-lookup',
      db: 'disconnected',
      error: error.message
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});
