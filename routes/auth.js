const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { escapeHtml, renderLayout } = require('../render');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();

const BOOTSTRAP_SECRET = process.env.BOOTSTRAP_SECRET || '';

async function getAdminByUsername(username) {
  const result = await pool.query(
    `
    SELECT id, username, password_hash, created_at
    FROM admins
    WHERE username = $1
    `,
    [username]
  );

  return result.rows[0] || null;
}

async function countAdmins() {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM admins`);
  return result.rows[0].count;
}

router.get('/admin/login', async (req, res) => {
  const nextUrl = (req.query.next || '/admin/events').toString();
  const adminCount = await countAdmins();

  res.send(
    renderLayout(
      'Admin Login',
      `
        <div class="panel" style="max-width: 520px; margin: 40px auto 0;">
          <h1 style="margin-top: 0;">Admin Login</h1>
          <p class="muted">Sign in to manage events and guest lists.</p>

          ${
            adminCount === 0
              ? `
                <div class="notice warning">
                  No admin users exist yet. Create the first one at
                  <span class="code-line">/admin/bootstrap?secret=YOUR_BOOTSTRAP_SECRET</span>.
                </div>
              `
              : ''
          }

          <form method="POST" action="/admin/login">
            <input type="hidden" name="next" value="${escapeHtml(nextUrl)}" />

            <div class="field">
              <label for="username">Username</label>
              <input id="username" name="username" required />
            </div>

            <div class="field">
              <label for="password">Password</label>
              <input id="password" type="password" name="password" required />
            </div>

            <div class="actions">
              <button type="submit">Log In</button>
              <a class="button secondary" href="/">Home</a>
            </div>
          </form>
        </div>
      `
    )
  );
});

router.post('/admin/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = String(req.body.password || '');
  const nextUrl = (req.body.next || '/admin/events').toString();

  try {
    const admin = await getAdminByUsername(username);

    if (!admin) {
      return res.status(401).send(
        renderLayout(
          'Admin Login',
          `
            <div class="panel" style="max-width: 520px; margin: 40px auto 0;">
              <h1 style="margin-top: 0;">Admin Login</h1>
              <div class="notice danger">Invalid username or password.</div>
              <div class="actions">
                <a class="button secondary" href="/admin/login">Try Again</a>
              </div>
            </div>
          `
        )
      );
    }

    const ok = await bcrypt.compare(password, admin.password_hash);

    if (!ok) {
      return res.status(401).send(
        renderLayout(
          'Admin Login',
          `
            <div class="panel" style="max-width: 520px; margin: 40px auto 0;">
              <h1 style="margin-top: 0;">Admin Login</h1>
              <div class="notice danger">Invalid username or password.</div>
              <div class="actions">
                <a class="button secondary" href="/admin/login">Try Again</a>
              </div>
            </div>
          `
        )
      );
    }

    req.session.adminUser = {
      id: admin.id,
      username: admin.username
    };

    res.redirect(nextUrl.startsWith('/admin') ? nextUrl : '/admin/events');
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

router.get('/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

router.get('/admin/bootstrap', async (req, res) => {
  const providedSecret = String(req.query.secret || '');

  if (!BOOTSTRAP_SECRET || providedSecret !== BOOTSTRAP_SECRET) {
    return res.status(403).send(
      renderLayout(
        'Bootstrap Forbidden',
        `
          <div class="panel" style="max-width: 640px; margin: 40px auto 0;">
            <h1 style="margin-top: 0;">Bootstrap Forbidden</h1>
            <div class="notice danger">Valid bootstrap secret required.</div>
          </div>
        `
      )
    );
  }

  const adminCount = await countAdmins();

  if (adminCount > 0) {
    return res.send(
      renderLayout(
        'Bootstrap Complete',
        `
          <div class="panel" style="max-width: 640px; margin: 40px auto 0;">
            <h1 style="margin-top: 0;">Admin Already Exists</h1>
            <p class="muted">You already have at least one admin account.</p>
            <div class="actions">
              <a class="button" href="/admin/login">Go to Login</a>
            </div>
          </div>
        `
      )
    );
  }

  res.send(
    renderLayout(
      'Create First Admin',
      `
        <div class="panel" style="max-width: 640px; margin: 40px auto 0;">
          <h1 style="margin-top: 0;">Create First Admin</h1>
          <p class="muted">This page only works with the correct bootstrap secret and only while no admin users exist.</p>

          <form method="POST" action="/admin/bootstrap">
            <input type="hidden" name="secret" value="${escapeHtml(providedSecret)}" />

            <div class="field">
              <label for="username">Username</label>
              <input id="username" name="username" required />
            </div>

            <div class="field">
              <label for="password">Password</label>
              <input id="password" type="password" name="password" required />
            </div>

            <div class="actions">
              <button type="submit">Create Admin</button>
              <a class="button secondary" href="/">Home</a>
            </div>
          </form>
        </div>
      `
    )
  );
});

router.post('/admin/bootstrap', async (req, res) => {
  const secret = String(req.body.secret || '');
  const username = (req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!BOOTSTRAP_SECRET || secret !== BOOTSTRAP_SECRET) {
    return res.status(403).send('Invalid bootstrap secret.');
  }

  const adminCount = await countAdmins();

  if (adminCount > 0) {
    return res.status(400).send('Admin already exists.');
  }

  if (!username || !password) {
    return res.status(400).send('Username and password are required.');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO admins (username, password_hash)
      VALUES ($1, $2)
      RETURNING id, username
      `,
      [username, passwordHash]
    );

    req.session.adminUser = {
      id: result.rows[0].id,
      username: result.rows[0].username
    };

    res.redirect('/admin/events');
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

module.exports = router;
