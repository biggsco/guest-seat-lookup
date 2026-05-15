const express = require('express');
const { renderLayout, escapeHtml } = require('../render');
const { pool } = require('../db');
const { hashPassword, validatePasswordComplexity } = require('../lib/adminUsers');

const router = express.Router();

function requireSuperAdmin(req, res, next) {
  if (!req.session?.user) return res.redirect(302, '/admin/login?error=Please sign in.');
  if (!req.session.user.isSuperAdmin) return res.status(403).send(renderLayout('Forbidden', '<section class="panel"><h1>Forbidden</h1><p>Only super admins can reset passwords.</p></section>'));
  return next();
}

router.get('/admin/users', requireSuperAdmin, async (req, res) => {
  const users = await pool.query('SELECT id, email, is_super_admin FROM admin_users ORDER BY email');
  const message = req.query.message ? `<div class="result-card">${escapeHtml(req.query.message)}</div>` : '';
  const rows = users.rows.map((u) => `<tr><td>${escapeHtml(u.email)}</td><td>${u.is_super_admin ? 'Yes' : 'No'}</td><td>
    <form method="POST" action="/admin/users/${u.id}/reset-password">
      <input type="password" name="newPassword" minlength="12" required placeholder="New password" />
      <button class="button" type="submit">Reset password</button>
    </form></td></tr>`).join('');

  res.status(200).send(renderLayout('Admin Users', `<section class="panel"><h1>Admin: Users</h1>${message}<table><thead><tr><th>Email</th><th>Super Admin</th><th>Reset Password</th></tr></thead><tbody>${rows}</tbody></table><p><a class="button" href="/admin/events">Back to events</a></p></section>`));
});

router.post('/admin/users/:id/reset-password', requireSuperAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const newPassword = String(req.body.newPassword || '');
  const validationError = validatePasswordComplexity(newPassword);
  if (validationError) {
    return res.redirect(302, `/admin/users?message=${encodeURIComponent(validationError)}`);
  }

  await pool.query('UPDATE admin_users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hashPassword(newPassword), userId]);
  return res.redirect(302, '/admin/users?message=Password reset successfully.');
});

module.exports = router;
