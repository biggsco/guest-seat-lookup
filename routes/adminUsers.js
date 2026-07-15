const express = require('express');
const { renderLayout, escapeHtml } = require('../render');
const { pool } = require('../db');
const { hashPassword, validatePasswordComplexity } = require('../lib/adminUsers');

const router = express.Router();

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
        <form method="POST" action="/admin/users/${u.id}/reset-password" style="display:inline;">
          <input type="password" name="newPassword" minlength="12" required placeholder="New password (12+ chars)" style="width:200px;" />
          <button class="button" type="submit">Reset password</button>
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

      <form method="POST" action="/admin/users/create" style="display:flex; gap:8px; margin-bottom:24px; flex-wrap:wrap;">
        <input name="username" required placeholder="username or email" style="flex:1; min-width:200px;" />
        <input type="password" name="password" minlength="12" required placeholder="Strong password (12+ chars)" style="flex:1; min-width:200px;" />
        <button class="button" type="submit">Create admin</button>
      </form>

      <table>
        <thead><tr><th>Username</th><th>Super Admin</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <p><a class="button secondary" href="/admin/events">Back to Events</a></p>
    </section>
  `));
});

router.post('/admin/users/create', requireSuperAdmin, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const validationError = validatePasswordComplexity(password);
  if (!username || validationError) return res.redirect('/admin/users');

  await pool.query(
    'INSERT INTO admins (username, password_hash, is_super_admin) VALUES ($1, $2, FALSE) ON CONFLICT (username) DO NOTHING',
    [username, hashPassword(password)]
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

router.post('/admin/users/:id/reset-password', requireSuperAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const newPassword = String(req.body.newPassword || '');
  const validationError = validatePasswordComplexity(newPassword);
  if (validationError) return res.redirect('/admin/users');

  await pool.query('UPDATE admins SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hashPassword(newPassword), userId]);
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
