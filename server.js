const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple');
const { pool } = require('./db');

const publicRoutes = require('./routes/public.js');
const authRoutes = require('./routes/auth.js');
const adminEventRoutes = require('./routes/adminEvents.js');
const adminUserRoutes = require('./routes/adminUsers.js');
const setupRoutes = require('./routes/setup.js');

const app = express();
const PgSession = pgSession(session);

const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

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
      tableName: 'user_sessions',
      createTableIfMissing: true
    }),
    secret: SESSION_SECRET,
