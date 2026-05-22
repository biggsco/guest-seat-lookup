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

app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  req.csrfToken = () => req.session.csrfToken;

  if (req.method === 'POST' && req.path.startsWith('/admin')) {
    const providedToken = String(
      (req.body && req.body._csrf)
      || req.query._csrf
      || req.get('x-csrf-token')
      || ''
    );

    if (providedToken !== req.session.csrfToken) {
      return res.status(403).send('Invalid CSRF token.');
    }
  }

  const originalSend = res.send.bind(res);
  res.send = function patchedSend(body) {
    if (typeof body === 'string' && body.includes('<form') && body.includes('method="POST"')) {
      const tokenField = `<input type="hidden" name="_csrf" value="${req.csrfToken()}" />`;
      body = body.replace(/<form\b[^>]*method="POST"[^>]*>/g, (match) => {
        let updated = match;

        if (!updated.includes('name="_csrf"')) {
          updated = `${updated}\n${tokenField}`;
        }

        const actionMatch = updated.match(/\baction="([^"]*)"/);
        if (actionMatch) {
          const actionUrl = actionMatch[1];
          if (!actionUrl.includes('_csrf=')) {
            const joiner = actionUrl.includes('?') ? '&' : '?';
            const nextAction = `${actionUrl}${joiner}_csrf=${encodeURIComponent(req.csrfToken())}`;
            updated = updated.replace(/\baction="([^"]*)"/, `action="${nextAction}"`);
          }
        }

        return updated;
      });
    }
    return originalSend(body);
  };

  return next();
});

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
