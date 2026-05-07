const { renderTopNav } = require('../render');

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminUser) {
    return next();
  }

  const redirectTo = encodeURIComponent(req.originalUrl || '/admin/events');
  return res.redirect(`/admin/login?next=${redirectTo}`);
}

function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.adminUser && req.session.adminUser.isSuperAdmin) {
    return next();
  }

  return res.status(403).send('Super admin access required.');
}

function adminNav(req, extraLinks = []) {
  const links = [
    { href: '/admin/events', label: 'Events' },
    { href: '/admin/account/password', label: 'My Password' },
    ...extraLinks,
    { href: '/admin/logout', label: 'Log Out' }
  ];

  if (req.session && req.session.adminUser && req.session.adminUser.isSuperAdmin) {
    links.splice(1, 0, { href: '/admin/users', label: 'Admins' });
  }

  return renderTopNav(links);
}

module.exports = {
  requireAdmin,
  requireSuperAdmin,
  adminNav
};
