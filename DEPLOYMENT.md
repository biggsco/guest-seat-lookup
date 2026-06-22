# Deployment & Server Setup

This guide maps the app's configuration to the security controls already in
place on the server (firewall, Cloudflare, SSH-tunnel-only Postgres, SFTP-only
upload accounts, CrowdStrike, patch window).

## 1. Network / Cloudflare

- Confirm Cloudflare is in **Full (strict)** SSL mode so the Cloudflare→origin
  leg is also encrypted, not just client→Cloudflare.
- The origin's firewall should allow inbound HTTPS only from Cloudflare's
  published IP ranges (https://www.cloudflare.com/ips/) plus any approved
  admin/office IPs — this is already in place per IT.
- The app trusts exactly **one** proxy hop (`app.set('trust proxy', 1)` in
  `server.js`), matching a single local TLS terminator/reverse proxy sitting
  between Cloudflare and Node on the box. If you ever add another proxy hop
  (e.g. an extra load balancer), bump this number — getting it wrong either
  breaks rate limiting/IP logging or lets clients spoof `X-Forwarded-For`.
- `NODE_ENV=production` enables secure, `httpOnly`, `SameSite=Lax` cookies and
  HTTP security headers (via `helmet`) — always set this in production.

## 2. PostgreSQL (SSH tunnel only)

Since Postgres only accepts connections via SSH tunnel, the app must connect
to `localhost` on the box, never directly over the network:

1. On the app server, open a persistent tunnel to the DB host:
   ```bash
   ssh -fN -L 5433:127.0.0.1:5432 dbtunnel-user@db-host
   ```
   (Run this via systemd/autossh so it survives reboots and reconnects.)
2. Set `DATABASE_URL` to point at the local tunnel endpoint, e.g.:
   ```
   DATABASE_URL=postgres://app_prod_user:***@127.0.0.1:5433/guest_seat_prod
   ```
3. `db.js` deliberately sets `ssl: false` — TLS isn't needed because traffic
   never leaves the box (the tunnel already encrypts the hop to the DB host).
   Don't add `ssl: true`/`rejectUnauthorized` here unless the tunnel setup
   changes.
4. Use the **separate production DB user** for production and a different
   one for staging, each scoped only to its own database (per IT's existing
   separation). The app user only needs DML rights on `admins`,
   `user_sessions`, `events`, `guests` — no superuser/DDL beyond what
   `CREATE TABLE IF NOT EXISTS` requires on first boot.

## 3. Environment variables

Set these on the host (e.g. in the systemd unit's `Environment=` lines or an
`.env` loaded by your process manager — never commit a `.env` file):

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `PORT` | no | defaults to `10000` |
| `DATABASE_URL` | yes | points at the local SSH tunnel, see above |
| `SESSION_SECRET` | yes | long random string; server refuses to boot without it in production |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | first boot | bootstraps the first super admin; password must meet the 12-char complexity policy in `lib/adminUsers.js`. Rotate/remove after first login if you don't want it re-applied on every restart. |
| `PUBLIC_BASE_URL` | recommended | e.g. `https://lookup.yourdomain.com`, used to build public guest-search links correctly behind Cloudflare |
| `ALLOW_SETUP_ROUTE` | no | leave unset/`false` in production; `/setup` is 404'd otherwise |

## 4. SFTP-only deploy accounts

The deploy/upload SFTP account should only ever be used to push application
code (and never hold DB credentials). Practical layout:

- `app_prod_sftp` user, chrooted to the production app directory, SFTP-only
  (no shell) — already enforced per IT.
- Separate `app_staging_sftp` user for the staging directory.
- Secrets (`SESSION_SECRET`, `DATABASE_URL`, `SUPER_ADMIN_PASSWORD`) live in
  the systemd environment file on the box, **not** inside the SFTP-uploaded
  tree, so an uploaded code change can never accidentally leak/check in
  credentials.
- After uploading new code via SFTP, run `npm ci --omit=dev` then restart the
  service (`systemctl restart guest-seat-lookup`) — don't run `npm install`
  with a non-pinned lockfile in production.

## 5. Process management & patching

- Run the app under `systemd` (or equivalent) with `Restart=on-failure` so it
  recovers automatically; the OS patch window (Mon–Thu, 00:00–05:00) may
  reboot the box, and the service should come back up along with the autossh
  tunnel unit.
- Order startup so the SSH tunnel unit starts and is healthy *before* the app
  unit (`After=` / `Wants=` in the systemd unit), otherwise the app will fail
  fast on `ensureAdminUserTable()` at boot.
- CrowdStrike Falcon sensor runs independently of the app; no app-level
  changes are needed for it.

## 6. What changed in this app to align with the above

- Added `helmet` for standard security headers.
- Added rate limiting (10 attempts / 15 min per IP+username) on
  `/admin/login` to blunt credential-stuffing/brute force even though the
  firewall already narrows who can reach the login page.
- Regenerate the session on successful login (mitigates session fixation).
- Converted the publish/unpublish/delete admin actions from `GET` to `POST`
  — combined with the existing `SameSite=Lax` session cookie, this closes a
  CSRF gap where a crafted link could have triggered a destructive action in
  a logged-in admin's browser.
- Documented (above) why `trust proxy` is pinned to `1` and why Postgres
  connects with `ssl: false`, so future changes to the network topology don't
  silently break IP attribution or get "fixed" by someone re-enabling TLS
  that the SSH tunnel already provides.

## Known residual risk (no code fix available)

`npm audit` flags the `xlsx` package (used for guest-list import) for a
prototype-pollution / ReDoS advisory with **no upstream fix published**.
Mitigation in place: uploads are restricted to authenticated admins only
(never public-facing), and `multer` enforces in-memory parsing with no path
traversal exposure. If this needs closing further, the realistic options are
switching to a maintained fork/alternative parser or moving parsing to an
isolated worker — flag if you want that scoped as separate work.
