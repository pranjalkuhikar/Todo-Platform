# 🔐 AuthHub: one login for all your apps

A centralized sign-in service (single sign-on) built with **Next.js** and **Postgres**, in plain JavaScript.
Users log in **once**; AuthHub sends each person to the app(s) **they** are allowed to use. Your apps only
*verify* a signed token. They hold no passwords and no shared secret.

```
                      ┌──────────────── AuthHub  (:4500) ────────────────┐
  user ── email + password ──►  checks password, creates a session,      │
                      │         issues a signed token (RS256):           │
                      │         "alice · may use: nextjs"                │
                      └──────────────────────────────────────────────────┘
                                │ routes the user to THEIR app(s)
          ┌─────────────────────┼──────────────────────────┐
          ▼                     ▼                          ▼
   Next.js app :3000     Node.js app :4000        Microservices gateway :8080
   proxy.js checks       Express middleware        gateway checks the token,
   the token             checks the token          passes identity to services
```

## How routing works

| User has… | After login they land on… |
|---|---|
| a `return` URL (an app sent them here) and access to it | that URL |
| exactly one app | that app |
| several apps and a *default app* set | the default app |
| several apps, no default | the launcher page (cards for each app) |
| no apps | the launcher page with "no apps assigned yet" |
| tries an app they can't use | a "no access" page (never a redirect loop) |

Because the login lives at AuthHub, opening a second app needs **no new login**: the app redirects the browser
to AuthHub, which silently re-issues a token and bounces the user straight back.

## Quick start

**Needs:** Node 20.9+, and Postgres reachable at `localhost:5432`. The existing `docker compose up -d postgres`
in the repo root provides it (user/password `app`/`app`). The `authhub` database is created automatically.

```bash
cd auth-hub
npm install
cp .env.example .env.local        # set ADMIN_EMAIL / ADMIN_PASSWORD (or leave the password empty: see below)
npm run dev                       # http://localhost:4500
npm run seed:demo                 # optional: alice, bob, carol, dave, erin (local demo only)
```

On first start AuthHub creates the database and tables, registers your three apps, generates its signing key,
and creates the first admin. If `ADMIN_PASSWORD` is empty a random password is printed **once** in the server log.

### Turn sign-in on in each app
Enforcement is **opt-in** per app (so existing clients and load tests keep working until you flip it):

| App | Start it with |
|---|---|
| **Next.js app** (`nextjs-app`) | `npm run dev` (sign-in is on by default; add `AUTH_REQUIRED=false` to switch it off for tests) |
| **Node.js app** (`node-app`) | `npm start` (sign-in is on by default; add `AUTH_REQUIRED=false` to switch it off for tests) |
| **Microservices** (`microservices-app`) | set `AUTHHUB_URL=http://localhost:4500` in `.env`, then `docker compose up -d --build gateway frontend` |

For the microservices stack, `AUTHHUB_URL` is where the **browser** reaches AuthHub. The gateway container fetches
the public keys through `AUTHHUB_INTERNAL_URL` (default `http://host.docker.internal:4500`). With AuthHub enabled,
the gateway accepts **only** AuthHub tokens and the old `/api/auth/login|register` return `410 use_authhub`.

## What each app does with the token

| | Next.js app | Node.js app | Microservices |
|---|---|---|---|
| Where | `proxy.js` + `lib/authhub.js` | `src/authhub.js` + middleware in `server.js` | `gateway/src/authhub.js` + `index.js` |
| No/invalid token, API | `401` JSON with `login_url` | `401` JSON with `login_url` | `401` JSON with `login_url` |
| No/invalid token, page | redirect to AuthHub | n/a (API only) | redirect to AuthHub |
| Valid token, wrong app | `403 no_access` | `403 no_access` | `403 no_access` |
| Identity reaches your code as | `x-user-id`, `x-user-email`, `x-user-name`, `x-user-role` (overwritten from the verified token, so clients can't forge them) | `req.user`, `req.userId` | `x-user-*` headers to services (existing mechanism) |
| Public (no login) | `/api/health`, `/api/metrics` | `/api/health`, `/metrics` | `/healthz`, `/readyz` |

## The token

An RS256-signed JWT in the `ah_token` cookie (or `Authorization: Bearer …`), valid for 10 minutes:

```json
{ "iss": "authhub", "sub": "<user uuid>", "aud": ["authhub", "nextjs", "node"],
  "email": "dave@demo.test", "name": "Dave", "role": "user",
  "apps": { "nextjs": "member", "node": "member" }, "sid": "<session id>", "exp": 1794300000 }
```

An app accepts a token only if the **audience contains its own slug**. That single check is the access control.
The public keys are served at `/.well-known/jwks.json`; apps cache them, so they keep working if AuthHub is
briefly down (a *cold-started* app with no cached keys fails **closed** with `503`, never open).

## Admin console (`/admin`)
- **Users & access**: create users, set hub role, give each user any set of apps (with a `member` or `admin` role
  per app), pick a default app, reset passwords, disable, sign out everywhere, delete.
- **Apps**: register a new app (name, slug, URL, icon). It is immediately selectable for users.
- **Audit log**: every sign-in (success and failure), denial, and admin change, with filters and 24-hour stats.

Users can change their own password and sign out of all devices at `/account`.

## Add another app
1. In **Admin → Apps → Register app**: choose a slug (e.g. `billing`) and its URL.
2. Give users access in **Users & access**.
3. In the app, verify the token. Copy `src/authhub.js` (CommonJS) or `lib/authhub.js` (ESM) from this repo's
   apps, `npm install jose`, and set `AUTHHUB_APP=billing`. Express example:

```js
const authhub = require("./authhub");
app.use(async (req, res, next) => {
  const r = await authhub.authenticate(req.get("authorization"), req.headers.cookie);
  if (!r.ok) return res.status(authhub.STATUS[r.reason]).json({ error: authhub.MESSAGES[r.reason], login_url: authhub.loginUrl(req.originalUrl) });
  req.user = r.user; // { id, email, name, appRole, role }
  next();
});
```

## Security model
- **Passwords:** scrypt with a per-user salt, constant-time comparison; unknown emails cost the same time as wrong
  passwords; min 10 characters.
- **Brute force:** 5 failed attempts per email in 15 minutes locks it; plus 20 attempts/minute per IP.
- **Generic errors:** "Invalid email or password" never says which part was wrong.
- **Two cookies, two jobs:** `ah_token` (10 min, path `/`) is what apps read. `ah_session` (7 days idle / 30 days
  max, **path `/sso` only**) is the "stay signed in" secret, and it is never sent to any other app. Both are `HttpOnly`,
  `SameSite=Lax`, and `Secure` when `COOKIE_SECURE=true`.
- **Server-side sessions:** the long-lived token is stored hashed; logout, password change, "sign out everywhere"
  and disabling a user revoke it immediately.
- **No open redirects:** `return` URLs must be the hub or a registered app the user may access.
- **Token checks:** pinned to RS256 + issuer + audience. `alg=none`, HS256 key-confusion and tampered tokens are rejected.
- **CSRF:** state-changing endpoints require an `Origin` matching the host; admin APIs also require an admin session.
- **Clickjacking:** the login page is never framable (`X-Frame-Options: DENY`).
- **Audit trail** of every security-relevant event.

### Honest limits
- **Revocation delay:** access tokens are stateless, so removing a user's app access or disabling them takes effect
  in apps within `ACCESS_TTL_SECONDS` (default 10 min). The session itself is revoked instantly, so they cannot renew.
  Lower the TTL for faster cut-off.
- **Localhost shares cookies across ports.** That is why one login works for :3000, :4000 and :8080 locally. In
  production use subdomains (`app.example.com`, `auth.example.com`) with `COOKIE_DOMAIN=.example.com`.
- **Not OAuth2/OIDC.** It is a purpose-built flow with the same shape. If you later need third-party apps, put an
  OIDC library in front.
- **No MFA, email password-reset, or key-rotation UI yet.** The signing-key table supports several keys; rotation is manual.
- **The rate limiter is in-memory** (one instance). Use a shared store behind several instances.
- There are no automated tests yet. It was verified by hand against all three apps (see the checks above).

## Production checklist
Serve everything over **HTTPS** · set `COOKIE_SECURE=true` · set `COOKIE_DOMAIN` for subdomain SSO · use a strong
`ADMIN_PASSWORD` · run behind a proxy that sets `X-Forwarded-For` · back up the `authhub` database (it holds the
signing key) · delete the demo users · register real app URLs.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AUTHHUB_URL` | `http://localhost:4500` | Public address of AuthHub (how browsers reach it) |
| `DATABASE_URL` | `postgres://app:app@localhost:5432/authhub` | Postgres; the database is created if missing |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@example.com` / random | First admin, created only while there are no users |
| `APP_NEXTJS_URL`, `APP_NODE_URL`, `APP_MICROSERVICES_URL` | ports 3000 / 4000 / 8080 | Seeded app URLs (editable later in the console) |
| `ACCESS_TTL_SECONDS` | `600` | Access-token lifetime |
| `COOKIE_SECURE` / `COOKIE_DOMAIN` | `false` / unset | HTTPS-only cookies / cookie domain for subdomain SSO |

## Endpoints

| Path | Purpose |
|---|---|
| `GET /login`, `/`, `/account`, `/admin`, `/forbidden` | UI |
| `GET /sso/authorize?app=&return=` | Apps send visitors here. Silent re-login, or the login page |
| `POST /sso/login` | Email + password → cookies + where to go next |
| `GET\|POST /sso/logout?return=` | End the session everywhere |
| `GET /.well-known/jwks.json` | Public signing keys |
| `GET /api/me` | Current user and their apps |
| `POST /api/account/password`, `/api/account/signout-all` | Self-service |
| `/api/admin/users`, `/api/admin/apps`, `/api/admin/audit` | Admin only |

## Project layout
```
app/                  pages + route handlers (sso/, api/, .well-known/)
components/           LoginForm, AdminConsole, AccountForms, Shell
lib/                  db (auto-create + migrate + seed), password, keys, tokens, session, redirects, audit, guard
scripts/seed-demo.js  demo users
```
