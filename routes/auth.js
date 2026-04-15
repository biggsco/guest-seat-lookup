diff --git a/routes/auth.js b/routes/auth.js
index 5b04bb36ebaf9b55fee4f58b5ef1b53d0771fe8e..52e05c54f4a91e2d6383a6b38bc5b6cd929aeef4 100644
--- a/routes/auth.js
+++ b/routes/auth.js
@@ -1,32 +1,137 @@
-const { escapeHtml } = require('../render');
+const express = require('express');
+const bcrypt = require('bcryptjs');
+const { pool } = require('../db');
+const { escapeHtml, renderLayout } = require('../render');
 
-function requireAdmin(req, res, next) {
-  if (req.session && req.session.adminUser) {
-    return next();
-  }
+const router = express.Router();
 
-  const redirectTo = encodeURIComponent(req.originalUrl || '/admin/events');
-  return res.redirect(`/admin/login?next=${redirectTo}`);
+async function getAdminByUsername(username) {
+  const result = await pool.query(
+    `
+    SELECT id, username, password_hash
+    FROM admins
+    WHERE username = $1
+    `,
+    [username]
+  );
+
+  return result.rows[0] || null;
 }
 
-function adminNav(extraLinks = []) {
-  const links = [
-    { href: '/admin/events', label: 'Events' },
-    { href: '/admin/users', label: 'Admins' },
-    ...extraLinks,
-    { href: '/admin/logout', label: 'Log Out' }
-  ];
-
-  return `
-    <div class="top-nav">
-      ${links.map(link => `
-        <a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>
-      `).join('')}
-    </div>
-  `;
+function renderLoginPage({ next = '/admin/events', username = '', error = '' } = {}) {
+  return renderLayout(
+    'Admin Login',
+    `
+      <div class="panel" style="max-width: 520px; margin: 48px auto;">
+        <h1 style="margin-top: 0;">Admin Login</h1>
+        <p class="muted">Sign in to manage events and uploads.</p>
+
+        ${error ? `<div class="notice danger">${escapeHtml(error)}</div>` : ''}
+
+        <form method="POST" action="/admin/login">
+          <input type="hidden" name="next" value="${escapeHtml(next)}" />
+
+          <div class="field">
+            <label for="username">Username</label>
+            <input id="username" name="username" autocomplete="username" required value="${escapeHtml(username)}" />
+          </div>
+
+          <div class="field">
+            <label for="password">Password</label>
+            <input id="password" type="password" name="password" autocomplete="current-password" required />
+          </div>
+
+          <div class="actions">
+            <button type="submit">Log In</button>
+            <a class="button secondary" href="/">Home</a>
+          </div>
+        </form>
+      </div>
+    `
+  );
 }
 
-module.exports = {
-  requireAdmin,
-  adminNav
-};
+router.get('/admin/login', (req, res) => {
+  const next = (req.query.next || '/admin/events').toString();
+  const safeNext = next.startsWith('/admin') ? next : '/admin/events';
+
+  if (req.session && req.session.adminUser) {
+    return res.redirect(safeNext);
+  }
+
+  res.send(renderLoginPage({ next: safeNext }));
+});
+
+router.post('/admin/login', async (req, res) => {
+  const username = (req.body.username || '').trim();
+  const password = String(req.body.password || '');
+  const next = (req.body.next || '/admin/events').toString();
+  const safeNext = next.startsWith('/admin') ? next : '/admin/events';
+
+  if (!username || !password) {
+    return res.status(400).send(
+      renderLoginPage({
+        next: safeNext,
+        username,
+        error: 'Username and password are required.'
+      })
+    );
+  }
+
+  try {
+    const admin = await getAdminByUsername(username);
+
+    if (!admin) {
+      return res.status(401).send(
+        renderLoginPage({
+          next: safeNext,
+          username,
+          error: 'Invalid username or password.'
+        })
+      );
+    }
+
+    const valid = await bcrypt.compare(password, admin.password_hash);
+
+    if (!valid) {
+      return res.status(401).send(
+        renderLoginPage({
+          next: safeNext,
+          username,
+          error: 'Invalid username or password.'
+        })
+      );
+    }
+
+    req.session.adminUser = {
+      id: admin.id,
+      username: admin.username
+    };
+
+    return res.redirect(safeNext);
+  } catch (err) {
+    return res.status(500).send(
+      renderLoginPage({
+        next: safeNext,
+        username,
+        error: err.message
+      })
+    );
+  }
+});
+
+router.get('/admin/logout', (req, res) => {
+  if (!req.session) {
+    return res.redirect('/admin/login');
+  }
+
+  req.session.destroy(() => {
+    res.redirect('/admin/login');
+  });
+});
+
+router.get('/admin', (req, res) => {
+  res.redirect('/admin/events');
+});
+
+module.exports = router;
