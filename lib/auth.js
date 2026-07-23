const { renderTopNav } = require('../render');
const { pool } = require('../db');

async function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminUser) {
    return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl || '/admin/events')}`);
  }

  const result = await pool.query(
    'SELECT id FROM admins WHERE id = $1',
    [req.session.adminUser.id]
  );

  if (!result.rows[0]) {
    return req.session.destroy(() =>
      res.redirect('/admin/login?error=Your+access+has+been+revoked.')
    );
  }

  return next();
}

function requireSuperAdmin(req, res, next) {
  if (
    req.session &&
    req.session.adminUser &&
    req.session.adminUser.isSuperAdmin
  ) {
    return next();
  }

  return res.status(403).send('Super admin access required.');
}

function adminNav(req, extraLinks = []) {
  const links = [
    { href: '/admin/events', label: 'Events' },
    ...extraLinks,
    { href: '/admin/logout', label: 'Log Out' }
  ];

  if (
    req.session &&
    req.session.adminUser &&
    req.session.adminUser.isSuperAdmin
  ) {
    links.splice(1, 0, { href: '/admin/users', label: 'Admins' });
  }

  return renderTopNav(links);
}

module.exports = {
  requireAdmin,
  requireSuperAdmin,
  adminNav
};
