const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple');
const helmet = require('helmet');
const { pool } = require('./db');

const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const adminEventRoutes = require('./routes/adminEvents');
const adminUserRoutes = require('./routes/adminUsers');
const setupRoutes = require('./routes/setup');
const { ensureAdminUserTable, upsertSuperAdminFromEnv } = require('./lib/adminUsers');
const { ensureGuestSeatsTable } = require('./lib/guestSeats');

const app = express();
const PgSession = pgSession(session);

const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production.');
}

if (isProduction) {
  // Origin sits behind exactly one local reverse proxy/TLS terminator fed by
  // Cloudflare (firewall restricts inbound HTTPS to Cloudflare + approved IPs).
  // "1" trusts the single immediate hop's X-Forwarded-* headers; raise this
  // only if another proxy hop is added in front of Node.
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/', adminEventRoutes);
app.use('/', adminUserRoutes);
app.use('/', setupRoutes);

async function start() {
  await ensureAdminUserTable();
  await ensureGuestSeatsTable();
  await upsertSuperAdminFromEnv();

  app.listen(PORT, HOST, () => {
    console.log(`Running on ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
