const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { escapeHtml, renderLayout } = require('../render');
const { requireAdmin, adminNav } = require('../lib/auth');
const { formatDateTime } = require('../lib/formatting');

const router = express.Router();

router.use('/admin', requireAdmin);

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

router.get('/admin/users', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, username, created_at
      FROM admins
      ORDER BY created_at ASC, id ASC
      `
    );

    const body = `
      ${adminNav([{ href: '/admin/events', label: 'Back to Events' }])}

      <div class="hero">
        <div>
          <h1>Admin Users</h1>
          <p>Create additional admin users for event management.</p>
        </div>
        <div class="actions" style="margin-top: 0;">
          <a class="button" href="/admin/users/new">Create Admin User</a>
        </div>
      </div>

      <div class="panel">
        ${
          result.rows.length
            ? `
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${result.rows.map(user => `
                      <tr>
                        <td>${escapeHtml(user.username)}</td>
                        <td>${escapeHtml(formatDateTime(user.created_at))}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `
            : `<div class="empty-state">No admin users found.</div>`
        }
      </div>
    `;

    res.send(renderLayout('Admin Users', body));
  } catch (err) {
    res.status(500).send(
      renderLayout('Error', `<div class="notice danger">${escapeHtml(err.message)}</div>`)
    );
  }
});

router.get('/admin/users/new', (req, res) => {
  res.send(
    renderLayout(
      'Create Admin User',
      `
        ${adminNav([{ href: '/admin/users', label: 'Back to Admin Users' }])}

        <div class="panel" style="max-width: 720px; margin: 0 auto;">
          <h1 style="margin-top: 0;">Create Admin User</h1>

          <form method="POST" action="/admin/users/new">
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
              <a class="button secondary" href="/admin/users">Cancel</a>
            </div>
          </form>
        </div>
      `
    )
  );
});

router.post('/admin/users/new', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).send(
      renderLayout(
        'Create Admin User',
        `
          <div class="panel" style="max-width: 720px; margin: 0 auto;">
            <h1 style="margin-top: 0;">Create Admin User</h1>
            <div class="notice danger">Username and password are required.</div>
            <div class="actions">
              <a class="button secondary" href="/admin/users/new">Try Again</a>
            </div>
          </div>
        `
      )
    );
  }

  try {
    const existing = await getAdminByUsername(username);

    if (existing) {
      return res.status(400).send(
        renderLayout(
          'Create Admin User',
          `
            <div class="panel" style="max-width: 720px; margin: 0 auto;">
              <h1 style="margin-top: 0;">Create Admin User</h1>
              <div class="notice danger">That username already exists.</div>
              <div class="actions">
                <a class="button secondary" href="/admin/users/new">Try Again</a>
              </div>
            </div>
          `
        )
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
      `
      INSERT INTO admins (username, password_hash)
      VALUES ($1, $2)
      `,
      [username, passwordHash]
    );

    res.redirect('/admin/users');
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

module.exports = router;
