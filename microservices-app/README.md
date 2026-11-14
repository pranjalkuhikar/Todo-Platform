# TaskGate: microservices todo app (frontend + API gateway + todo service)

Sign-in is NOT part of this app. Users sign in once at the central **AuthHub** (`../auth-hub`, port 4500), which sends
them back here if they have been given access to this app. This app only *verifies* the signed token AuthHub issues.

```
                         ┌────────────── private Docker network ──────────────┐
 browser ──► gateway ────┤► todo-service  :4002  (todo CRUD)  ─► Postgres: tododb
            :8080        └► frontend      :3000  (Next.js UI)
        (only public port)
     │
     └─► not signed in? redirected to AuthHub :4500 (login) ─► back to :8080
```

| Path | Goes to |
|---|---|
| `/api/auth/me`, `/api/auth/logout` | answered by the gateway itself (identity comes from the AuthHub token) |
| `/api/todos/*` | todo-service |
| everything else (`/`, …) | frontend |

**What the gateway does**: the single public entry point. It verifies the AuthHub token (public keys only, no shared
secret), rate-limits, blocks foreign origins on writes (CSRF), adds a request id, applies security headers, times out
slow services (502/504 instead of hanging), and tells todo-service who the caller is via headers only it can set
(`INTERNAL_TOKEN`). todo-service refuses any call that did not come through the gateway.

## Run everything
You need Docker and AuthHub running first (AuthHub needs the Postgres from the repo-root `docker compose up -d`).
```bash
# 1. repo root: Postgres + monitoring
cd Testing && docker compose up -d
# 2. AuthHub (sign-in), in its own terminal
cd auth-hub && npm run dev                     # http://localhost:4500   (npm run seed:demo for demo users)
# 3. this app
cd microservices-app
cp .env.example .env                           # then set INTERNAL_TOKEN:  openssl rand -hex 16
docker compose up -d --build
```
Open **http://localhost:8080**. You land on AuthHub's login; sign in as a user who has the *microservices* app
(demo: `carol@demo.test` / `Demo-Pass-1234!`). Users without access see AuthHub's "no access" page.
You do **not** run `npm start` for these services: Docker builds and starts each one.
Give a user access to this app in AuthHub's admin console (app slug `microservices`).

## Develop without rebuilding images
```bash
docker compose up -d postgres                       # Postgres on localhost:5433
cd todo-service && npm install && npm run dev       # :4002   (each in its own terminal)
cd gateway      && npm install && npm run dev       # :8080
cd frontend     && npm install && npm run dev       # :3000   (use it through http://localhost:8080)
```
The services read `microservices-app/.env`. The table is created automatically on startup (`src/migrations/*.sql`).

## API (through the gateway)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/auth/me` | current user (from the AuthHub token) |
| POST | `/api/auth/logout` | clears the cookie and returns AuthHub's logout URL |
| GET | `/api/todos?limit&offset&done&q` | your todos + `total` + `stats` |
| POST / GET / PATCH / PUT / DELETE | `/api/todos[/:id]` | CRUD, only your own todos |
| GET | `/healthz`, `/readyz` | liveness / readiness (readiness checks AuthHub and todo-service) |

Use `Authorization: Bearer <token>` from scripts, or the `ah_token` cookie from the browser. There is no
register/login endpoint here: those live in AuthHub (`POST /sso/login`). Login history and analytics are in AuthHub's audit log.

## Observability
- **Metrics**: `todo_operations_total{op}` and the HTTP histograms at the todo-service `/metrics` (port 4002) and the gateway (port 9100), both published on localhost only and scraped by the repo-root Prometheus.
- **Logs**: one JSON line per request with `request_id` (same id in gateway + service logs). Set `LOKI_URL` to also push to Loki.
- **Product analytics**: set `POSTHOG_KEY` or `MIXPANEL_TOKEN` (events: `todo_created/updated/deleted`).

## Test
```bash
node scripts/smoke-test.js     # ~30 end-to-end checks against http://localhost:8080 (needs AuthHub + demo users)
```
Covers the AuthHub redirect, token checks (missing/garbage/forged/alg=none), a user without access, CRUD, validation,
spoofed headers, the CSRF origin check, and (with `SECOND_USER=...`) that users cannot see each other's todos.

## Before real production
- Put HTTPS in front (load balancer / Caddy / Nginx), then set `COOKIE_SECURE=true`, `ALLOWED_ORIGINS=https://your.domain`
  and `TRUST_PROXY=1`.
- Use strong `INTERNAL_TOKEN`, `POSTGRES_PASSWORD`; keep them in a secret manager, not in git.
- Rate limits are in memory: with several gateway replicas, use a shared store (Redis).
- Logout ends the AuthHub session (revoked server-side); access tokens are short-lived and expire on their own.
- Back up Postgres; run migrations from CI if you scale services beyond one replica each (they are lock-safe, so it also works on startup).
