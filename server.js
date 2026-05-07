const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple');
const { pool } = require('./db');

const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const adminEventRoutes = require('./routes/adminEvents');
const adminUserRoutes = require('./routes/adminUsers');
const setupRoutes = require('./routes/setup');

const app = express();
const PgSession = pgSession(session);

const PORT = process.env.PORT || 10000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: process.env.SESSION_TABLE_NAME || 'user_sessions',
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false
  })
);

app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/', adminEventRoutes);
app.use('/', adminUserRoutes);
app.use('/', setupRoutes);

app.listen(PORT, HOST, () => {
  console.log(`Running on ${PORT}`);
});
