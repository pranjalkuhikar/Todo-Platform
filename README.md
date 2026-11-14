# Todo platform: central sign-in + three apps + observability

One repository, four connected projects. **AuthHub** is the single login; the three apps only verify the token it issues.

```
                         ┌──────────── AuthHub :4500 ────────────┐
  user ─ email+password ─►  signs in once, issues a signed token  │   (Postgres: authhub)
                         └──┬───────────────┬───────────────┬─────┘
                            ▼               ▼               ▼
                   nextjs-app :3000   node-app :4000   microservices-app :8080
                   Next.js + Postgres  Express + EJS     gateway → todo-service + frontend
                   (nextapp)           (nodeapp)         (tododb, own Postgres :5433)

   docker-compose.yml + infra/  →  Postgres, Loki (logs), Prometheus (metrics), Grafana, Adminer
```

| Folder | What it is |
|---|---|
| `auth-hub/` | Central sign-in (SSO) in Next.js. Admins see an app launcher; everyone else goes straight to their app |
| `nextjs-app/` | Todo app, Next.js 16 + Postgres, with logs, metrics and a login-aware UI |
| `node-app/` | Todo app, Express + EJS views + Postgres |
| `microservices-app/` | API gateway + todo-service + Next.js frontend in Docker (sign-in comes from AuthHub, no auth service of its own) |
| `docker-compose.yml`, `infra/` | Postgres, Grafana dashboards, Prometheus, Loki, Adminer |
| `docs/` | Troubleshooting playbook |

## Run order
```bash
docker compose up -d                                   # 1. Postgres + Grafana (http://localhost:3001) + Adminer (:8081)
cd auth-hub && npm install && npm run dev              # 2. AuthHub  http://localhost:4500   (npm run seed:demo for demo users)
cd nextjs-app && npm install && npm run dev            # 3. http://localhost:3000
cd node-app && npm install && npm start                # 4. http://localhost:4000
cd microservices-app && cp .env.example .env && docker compose up -d --build   # 5. http://localhost:8080
```
Copy each app's `.env.example` to `.env` / `.env.local` when you need to change settings. Real `.env` files are never committed.
Sign-in is required by default in every app; start one with `AUTH_REQUIRED=false` only for local tests.

Demo users (after `npm run seed:demo` in `auth-hub`, local use only, password `Demo-Pass-1234!`):
`alice@demo.test` Next.js · `bob@demo.test` Node.js · `carol@demo.test` microservices · `dave@demo.test` Next.js + Node.js.

---

# Next.js vs Express: CRUD + Postgres + Logs + Metrics

```
Testing/
├── docker-compose.yml     Postgres, Loki (logs), Prometheus (metrics), Grafana (UI)
├── infra/                 configs for the above (+ the pre-built Grafana dashboard)
├── nextjs-app/            Next.js 16, API on :3000   (database: nextapp)
├── node-app/              Express,   API on :4000   (database: nodeapp)
└── load-test/load.js      load generator
```

## 1. Start the infrastructure (once)
```bash
docker compose up -d          # needs Docker Desktop running
```
| Service    | URL                    | Use                                   |
|------------|------------------------|---------------------------------------|
| Grafana    | http://localhost:3001  | dashboards + logs (no login locally)  |
| Prometheus | http://localhost:9090  | raw metrics                           |
| Loki       | http://localhost:3100  | log storage (used through Grafana)    |
| Postgres   | localhost:5432         | user `app`, password `app`            |
| Adminer    | http://localhost:8081  | Postgres web UI: browse tables/rows (server `postgres`, user/password `app`, database `nextapp` or `nodeapp`) |

## 2. Start the apps (two terminals)
```bash
cd nextjs-app && npm install && npm run dev        # http://localhost:3000
cd node-app   && npm install && npm run dev        # http://localhost:4000
```
**For fair speed comparisons use production mode**, because `next dev` is several times slower:
```bash
cd nextjs-app && npm run build && npm start
```

## 3. The API (identical on both)
| Method | Path | What |
|---|---|---|
| GET | `/api/todos?limit=20&offset=0&done=true` | list (paginated, filterable) |
| GET | `/api/todos/:id` | read one |
| POST | `/api/todos` `{"title":"..."}` | create |
| PUT/PATCH | `/api/todos/:id` `{"title"?, "done"?}` | partial update |
| DELETE | `/api/todos/:id` | delete (204) |
| GET | `/api/health` | checks the DB connection |

Send `-H "x-user-id: alice"` to say who is calling. It shows up in logs and analytics events.
```bash
curl -X POST localhost:4000/api/todos -H 'Content-Type: application/json' -H 'x-user-id: alice' -d '{"title":"Buy milk"}'
```

## 4. Send lots of requests
```bash
node load-test/load.js                                       # both apps, 30s, 20 workers each
node load-test/load.js --duration 120 --concurrency 100      # heavier
node load-test/load.js --target next --users 200             # one app, 200 fake users
node load-test/load.js --delay 50                            # gentler (50ms pause per worker)
```
It sends a mix of list/get/create/update/delete plus a few deliberate bad requests (400/404),
so the warnings panel has something to show. It prints req/s, p50/p95/p99 latency and status codes.

## 5. See logs and metrics: http://localhost:3001
Open the dashboard **"Observability Lab: Next.js vs Express"** (it is the home page):
active users, requests/sec, latency p50/p95, status codes, CRUD operations, memory, log volume,
a **Warnings & errors** log panel and a live **All logs** panel.

For free-form log searching go to *Explore → Loki* and try:
```
{app="express"}
{app="nextjs", level="error"}
{app=~".+"} | json | status >= 400
{app=~".+"} | json | user_id="user-7"
{app=~".+"} | json | duration_ms > 50
```

How it works: each app writes one JSON log line per request to the console and pushes it to Loki,
and exposes counters/histograms at `/api/metrics` (Next) and `/metrics` (Express) for Prometheus to scrape.

## 6. User metrics (who does what)
Two layers:

1. **Already working, no account needed**: per-user activity comes from the logs (`user_id`),
   and the `todo_operations_total` counter tracks what users do. Both are on the Grafana dashboard.
2. **Product analytics (retention, funnels, cohorts)**: PostHog or Mixpanel. The apps already send
   `todo_created`, `todo_updated` and `todo_deleted` events; they only need a key.

   **PostHog (recommended)**: free tier, funnels/retention/session replay in one tool, open source.
   1. Sign up at https://posthog.com, create a project, copy the **Project API key** (`phc_...`).
   2. `node-app/.env` → `POSTHOG_KEY=phc_...`; `nextjs-app/.env.local` → `POSTHOG_KEY=phc_...`
   3. Restart the apps, run the load test, and open *Activity* in PostHog. Events appear within seconds.
   (EU project? also set `POSTHOG_HOST=https://eu.i.posthog.com`.)

   **Mixpanel**: same idea. Create a project, copy the **Project Token**, and set `MIXPANEL_TOKEN=...`
   (EU/India: set `MIXPANEL_HOST=https://api-eu.mixpanel.com`). Check Mixpanel's pricing page for current free limits.

   Tip: pick one and don't send load-test traffic to your real project; use a separate "dev" project.

## 7. Central sign-in (AuthHub)
`auth-hub/` is a single sign-on service for all three apps: users log in once and are routed to the apps they may
use. Every app requires sign-in by default (set `AUTH_REQUIRED=false` only for tests / load tests). See [auth-hub/README.md](auth-hub/README.md).
```bash
cd auth-hub && npm install && npm run dev          # http://localhost:4500 (needs the Postgres above)
```

## Reset / stop
```bash
docker compose down        # stop (keeps data)
docker compose down -v     # stop AND wipe Postgres/Loki/Prometheus/Grafana data
```
