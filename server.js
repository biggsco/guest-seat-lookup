const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple');
const { pool } = require('./db');

const publicRoutes = require('./routes/public.js');
const authRoutes = require('./routes/auth.js');
const adminEventRoutes = require('./routes/adminEvents.js');
const adminUserRoutes = require('./routes/adminUsers');
const setupRoutes = require('./routes/setup.js');

const app = express();
const PgSession = pgSession(session);

const PORT = process.env.PORT || 10000;
const HOST = process.env.HOST || '0.0.0.0';

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: process.env.SESSION_TABLE_NAME || 'user_sessions',
      createTableIfMissing: true
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: Number(process.env.SESSION_MAX_AGE_MS) || 1000 * 60 * 60 * 24
    }
  })
);

app.use(publicRoutes);
app.use(authRoutes);
app.use(adminEventRoutes);
app.use(adminUserRoutes);
app.use(setupRoutes);

app.use((req, res) => {
  res.status(404).send('Not Found');
});

app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
