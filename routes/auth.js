const express = require('express');
const { renderLayout, escapeHtml } = require('../render');
const { formatError } = require('../lib/formatting');
const { buildNextPath } = require('../lib/auth');
const { findUserByEmail, verifyPassword } = require('../lib/adminUsers');

const router = express.Router();

router.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect(302, '/admin/login');
  });
});


router.get('/auth/entra', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  return res.redirect(302, `/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('Microsoft Entra login has been removed. Use your admin email and password.')}`);
});

router.get('/admin/login/entra', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  return res.redirect(302, `/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('Microsoft Entra login has been removed. Use your admin email and password.')}`);
});

router.get('/admin/login', (req, res) => {
  const nextPath = buildNextPath(req.query.next);
  const error = req.query.error ? escapeHtml(req.query.error) : '';

  return res.status(200).send(
    renderLayout(
      'Admin Sign in',
      `
      <section class="panel">
        <h1>Admin sign in</h1>
        <p class="muted">Sign in with your admin email and password.</p>
        ${error ? `<div class="result-card">${error}</div>` : ''}
        <form method="POST" action="/admin/login">
          <input type="hidden" name="next" value="${escapeHtml(nextPath)}" />
          <label>Email</label>
          <input name="email" type="email" required />
          <label>Password</label>
          <input name="password" type="password" required />
          <p><button class="button" type="submit">Sign in</button></p>
        </form>
      </section>
      `
    )
  );
});

router.post('/admin/login', async (req, res) => {
  const nextPath = buildNextPath(req.body.next);
  try {
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const user = await findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.redirect(302, `/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('Invalid email or password.')}`);
    }

    req.session.user = { id: user.id, email: user.email, isSuperAdmin: user.is_super_admin };
    return res.redirect(302, nextPath);
  } catch (err) {
    return res.redirect(302, `/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(formatError(err, 'Unable to sign in.'))}`);
  }
});

module.exports = router;
