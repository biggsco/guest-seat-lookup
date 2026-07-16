const express = require('express');
const { renderLayout, escapeHtml } = require('../render');
const { pool } = require('../db');
const { hashPassword, validatePasswordComplexity } = require('../lib/adminUsers');

const router = express.Router();

const VENUES = [
  'Adelaide Convention Centre',
  'Adelaide Entertainment Centre',
  'The Drive'
];

function requireSuperAdmin(req, res, next) {
  if (!req.session?.adminUser) return res.redirect(302, '/admin/login');
  if (!req.session.adminUser.isSuperAdmin) {
    return res.status(403).send(renderLayout('Forbidden', '<section class="panel"><h1>Forbidden</h1><p>Only super admins can manage admins.</p></section>'));
  }
  return next();
}

router.get('/admin/users', requireSuperAdmin, async (req, res) => {
  const users = await pool.query('SELECT id, username, is_super_admin FROM admins ORDER BY username');

  const rows = users.rows.map((u) => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${u.is_super_admin ? 'Yes' : 'No'}</td>
      <td style="white-space:nowrap;">
        <form method="POST" action="/admin/users/${u.id}/toggle-super" style="display:inline;">
          <button class="button secondary" type="submit">${u.is_super_admin ? 'Demote' : 'Promote'}</button>
        </form>
        ${req.session.adminUser.id === u.id ? '' : `
          <form method="POST" action="/admin/users/${u.id}/delete" style="display:inline;" onsubmit="return confirm('Delete this admin?')">
            <button class="button danger" type="submit">Delete</button>
          </form>
        `}
      </td>
    </tr>
  `).join('');

  res.send(renderLayout('Admin Users', `
    <section class="panel">
      <h1>Admin Users</h1>
      <p class="muted">All admins appear here. Microsoft Entra users are added automatically on first sign-in and can be promoted to super admin below. Local accounts require a password.</p>

      <p><a class="button" href="/admin/users/new">Add Local Admin</a></p>

      <table>
        <thead><tr><th>Username</th><th>Super Admin</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <p><a class="button secondary" href="/admin/events">Back to Events</a></p>
    </section>
  `));
});

router.get('/admin/users/new', requireSuperAdmin, (req, res) => {
  const venueCheckboxes = VENUES.map((v) => `
    <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
      <input type="checkbox" name="venues" value="${escapeHtml(v)}" />
      ${escapeHtml(v)}
    </label>
  `).join('');

  res.send(renderLayout('Create Admin User', `
    <div class="panel" style="max-width: 560px; margin: 0 auto;">
      <h1 style="margin-top:0;">Create Admin User</h1>
      <form method="POST" action="/admin/users/create">
        <div class="field">
          <label for="username">Username</label>
          <input id="username" name="username" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" type="password" name="password" minlength="12" required />
        </div>
        <div class="field">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" name="is_super_admin" value="1" />
            Super admin
          </label>
        </div>
        <div class="field">
          <label>Venue access</label>
          <div style="margin-top:6px;">
            ${venueCheckboxes}
          </div>
          <p class="muted small">Users will only see/manage events in selected venues.</p>
        </div>
        <div class="actions">
          <button class="button" type="submit">Create Admin</button>
          <a class="button secondary" href="/admin/users">Cancel</a>
        </div>
      </form>
    </div>
  `));
});

router.post('/admin/users/create', requireSuperAdmin, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const isSuperAdmin = req.body.is_super_admin === '1';
  const venues = Array.isArray(req.body.venues)
    ? req.body.venues
    : req.body.venues ? [req.body.venues] : [];

  const validationError = validatePasswordComplexity(password);
  if (!username || validationError) return res.redirect('/admin/users/new');

  await pool.query(
    'INSERT INTO admins (username, password_hash, is_super_admin, allowed_venues) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING',
    [username, hashPassword(password), isSuperAdmin, venues]
  );
  return res.redirect('/admin/users');
});

router.post('/admin/users/:id/toggle-super', requireSuperAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (req.session.adminUser.id === userId) return res.redirect('/admin/users');

  const target = await pool.query('SELECT id, is_super_admin FROM admins WHERE id = $1', [userId]);
  if (!target.rows[0]) return res.redirect('/admin/users');

  if (target.rows[0].is_super_admin) {
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM admins WHERE is_super_admin = TRUE');
    if (count.rows[0].c <= 1) return res.redirect('/admin/users');
  }

  await pool.query('UPDATE admins SET is_super_admin = NOT is_super_admin, updated_at = NOW() WHERE id = $1', [userId]);
  return res.redirect('/admin/users');
});

router.post('/admin/users/:id/delete', requireSuperAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (req.session.adminUser.id === userId) return res.redirect('/admin/users');

  const target = await pool.query('SELECT is_super_admin FROM admins WHERE id = $1', [userId]);
  if (target.rows[0]?.is_super_admin) {
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM admins WHERE is_super_admin = TRUE');
    if (count.rows[0].c <= 1) return res.redirect('/admin/users');
  }

  await pool.query('DELETE FROM admins WHERE id = $1', [userId]);
  return res.redirect('/admin/users');
});

module.exports = router;
