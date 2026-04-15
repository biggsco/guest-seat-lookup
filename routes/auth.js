const { escapeHtml } = require('../render');

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminUser) {
    return next();
  }

  const redirectTo = encodeURIComponent(req.originalUrl || '/admin/events');
  return res.redirect(`/admin/login?next=${redirectTo}`);
}

function adminNav(extraLinks = []) {
  const links = [
    { href: '/admin/events', label: 'Events' },
    { href: '/admin/users', label: 'Admins' },
    ...extraLinks,
    { href: '/admin/logout', label: 'Log Out' }
  ];

  return `
    <div class="top-nav">
      ${links.map(link => `
        <a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>
      `).join('')}
    </div>
  `;
}

module.exports = {
  requireAdmin,
  adminNav
};
