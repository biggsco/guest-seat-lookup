const { renderTopNav } = require('../render');

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminUser) {
    return next();
  }

  const redirectTo = encodeURIComponent(req.originalUrl || '/admin/events');
  return res.redirect(`/admin/login?next=${redirectTo}`);
}

function adminNav(extraLinks = []) {
  return renderTopNav([
    { href: '/admin/events', label: 'Events' },
    { href: '/admin/users', label: 'Admins' },
    ...extraLinks,
    { href: '/admin/logout', label: 'Log Out' }
  ]);
}

module.exports = {
  requireAdmin,
  adminNav
};
