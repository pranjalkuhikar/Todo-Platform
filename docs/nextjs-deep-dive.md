# Next.js app: deep dive (questions and answers)

Everything here is based on the real files in `nextjs-app/`.

---

## 1. How a request becomes a database row

### Walk through: what happens when I add a todo?

```
You type "Buy milk" and click Add
  │  components/TodoApp.js        add()
  ▼
fetch POST /api/todos   {"title":"Buy milk"}  + header x-user-id: browser-user
  │
  ▼  app/api/todos/route.js       export const POST = observe(...)
  │
  ▼  lib/observe.js               starts a timer, reads the x-user-id header
  │    └─ calls your handler:
  │         1. request.json()                     read the body (bad JSON => 400)
  │         2. validate(body)                     title must be 1-200 chars (bad => 400)
  │         3. createTodo(value, userId)          lib/todos.js
  │              └─ INSERT INTO todos (title, done, user_id) VALUES ($1, ..., $3) RETURNING *
  │                                               ▲ talks to Postgres through lib/db.js
  │         4. todoOps.inc({op:"create"})         metric: "a todo was created"
  │         5. track(...)                         PostHog/Mixpanel event (only if a key is set)
  │         6. return 201 + the new row as JSON
  ▼  back in lib/observe.js (the `finally` block, runs even on errors)
       - stops the timer
       - httpRequests.inc(...) and httpDuration.observe(...)    => Prometheus numbers
       - logger.info("request", {...})                         => terminal + Loki (Grafana logs)
  ▼
Browser gets the JSON, adds the row to the screen.
```

So **one click** produces: a database row, a metric update, a log line, and (optionally) an analytics event.

### What does `lib/observe.js` do, and why does it wrap every route?
It is a "wrapper". Instead of copy-pasting timing, logging and error handling into every route, each route is written as
`observe("/api/todos", async (request) => {...})`. The wrapper:
1. starts a timer and finds who is calling (`x-user-id`, or `anonymous`),
2. runs your handler,
3. **always** (even if it crashed) records the request count, duration and one log line,
4. turns an unexpected error into a clean `500 {"error":"Internal server error"}` instead of leaking details.

That is why every endpoint automatically shows up in Prometheus and Grafana without extra code.

### Why does the page read the database directly, while the buttons call the API?
- `app/page.js` is a **server component**. It runs on the server, so it can call `listTodos()` and query Postgres
  directly. The first page load arrives already filled with todos. No extra API call needed.
- Buttons need to run in the browser (clicks, typing). The browser cannot talk to Postgres, so `TodoApp.js` calls the
  **API** (`/api/todos`), and the API talks to Postgres.

Useful detail: the browser UI sends `x-user-id: browser-user`, so todos created by clicking in the UI are saved with
`user_id = 'browser-user'`, and todos from curl use whatever you put in the header (e.g. `alice`).

---

## 2. Server components vs client components

### What is a server component?
A component that runs **only on the server**. It can read the database or files, and its code never reaches the browser.
`app/page.js` is one. It sends ready-made HTML.

A **client component** starts with `"use client"` (see `TodoApp.js`). It is sent to the browser and can react to clicks
and use `useState`.

### Why `export const dynamic = "force-dynamic"` in `app/page.js`?
By default Next.js may build a page once and reuse it (static). A todo list must be fresh, so `force-dynamic` says
"run this on every request". Without it you could see old todos.

### Where does my code run?
| File | Runs in |
|---|---|
| `app/page.js` | server |
| `components/TodoApp.js` | browser (after being rendered once on the server) |
| `app/api/**/route.js` | server |
| `lib/*.js` (db, todos, logger, metrics) | server only |
| `instrumentation.js` / `lib/seed.js` | server, once at startup |

Passwords, database URLs and `pg` must stay in server files. That is why `lib/` is never imported by the client component.

---

## 3. The database layer

### What is a connection pool, and why `max: 10`?
Opening a connection to Postgres is slow. A **pool** opens up to 10 connections once and lends them out. A request
borrows one, runs its query, and gives it back. `max: 10` means at most 10 queries run at the same moment; the rest wait
in line. Too low = requests queue up under load. Too high = Postgres gets overloaded (it has its own connection limit).
`lib/db.js` stores the pool on `globalThis` so dev hot-reload doesn't create a new pool on every code change.

### What is SQL injection, and how does `$1` protect this app?
Injection is when user text becomes part of the SQL command. If the code did
`"... WHERE title = '" + title + "'"` and someone sent `'; DELETE FROM todos; --`, the database would run the delete.
This app uses **parameters**: `INSERT ... VALUES ($1, $2, $3)` with the values passed separately. The database treats
`$1` as pure data, never as SQL. Whatever a user types stays just text.

### Why is there an index on `user_id`?
`infra/postgres/init.sh` creates `todos_user_id_idx`. An index lets Postgres find all rows for one user without reading
the whole table. Honest note: the current app queries never filter by `user_id` (they list by `id`, `done`), so the index
is there for future "show only my todos" queries and for ad-hoc searches like `WHERE user_id = 'alice'` in Adminer.

### Other details worth knowing
- `COALESCE($2, title)` in the update means "if no new value is sent, keep the old one". That makes updates partial.
- `ORDER BY id DESC LIMIT $2 OFFSET $3` is the pagination (newest first).
- The home page loads at most 50 todos (`listTodos({ limit: 50 })`).

---

## 4. Metrics in depth

### Why a histogram for latency and a counter for requests?
- A **counter** only counts events (`http_requests_total`): "how many".
- Latency is a **spread** of values, not one number. A **histogram** counts how many requests fell into each speed
  bucket, so you can ask for typical speed (p50) and slow-end speed (p95) later. An average alone hides slow requests.

### What are the buckets, and how is p95 estimated?
Buckets in `lib/metrics.js`: 2 ms, 5, 10, 25, 50, 100, 250, 500 ms, 1 s, 2.5 s.
Each bucket counts requests that took *at most* that long. For p95, Prometheus finds the bucket where the 95th
percentile falls and **estimates** a value inside it by straight-line interpolation. So p95 is an approximation, only as
precise as the buckets. Requests slower than 2.5 s all land in "everything else".

### What happens to the numbers when the app restarts?
Counters and histograms live in the app's memory, so they **reset to 0** on restart. Prometheus knows this: `rate()` and
`increase()` detect the drop and handle it. Raw totals like `sum(http_requests_total)` will look like they went down.
The database rows are not affected, because they are stored in Postgres.

### Where else do I see "who did what"?
`todo_operations_total{op=...}` (what users do), logs with `user_id` (who), and optionally PostHog/Mixpanel.

---

## 5. Performance

### Why is `npm run dev` slower than `npm start`?
`dev` compiles each route the first time it is used, keeps extra checking and hot-reload machinery on, and does not
optimise the code. `npm run build` compiles and optimises everything once, and `npm start` only serves. For speed
comparisons always use build + start (the main README says the same).

### What makes p95 go up under load, and how do I find the bottleneck?
Typical causes, in the order to check:
1. **Database queue**: more than 10 simultaneous queries wait for a pool slot. Look at Grafana's Postgres dashboard
   "Active connections" / "Connections by state".
2. **Slow queries** (no index, big table). Compare `duration_ms` in logs; try the query in Adminer.
3. **CPU or event loop**: `rate(process_cpu_seconds_total[1m])` near 1, or `nodejs_eventloop_lag_seconds` rising.
4. **Memory pressure**: "Memory (RSS)" panel climbing.

Method: run `node load-test/load.js --target next --duration 30`, watch Request rate, p95, then the Postgres and
CPU panels to see which one moves with it.

### Tip
The load test fills the database with fake rows. Clean up afterward with
`DELETE FROM todos WHERE user_id LIKE 'user-%';` (Adminer → SQL command).

---

## 6. Reliability and errors

### What happens if Postgres goes down while the app runs?
`pool.query` fails and the error is caught by `observe`. The API returns **500 "Internal server error"**, an `error`
log line (with the real message and stack) is written, and the `status="500"` counters rise, so the "Error rate 5xx"
panel in Grafana lights up. The home page itself (server component) would show a Next.js error page. When Postgres is
back, the pool reconnects on the next request. You don't need to restart the app. Try it: `docker compose stop postgres`,
click around, watch Grafana, then `docker compose start postgres`.

### What happens if Loki (the log store) is down?
Nothing bad. In `lib/logger.js`, logs are always printed to the terminal first. Sending to Loki is a background
batch every second. If a batch fails it is dropped (the app prints "N log lines were not delivered to Loki") and
requests keep working. Up to 200,000 lines are held in memory while Loki catches up.

### How do 400, 404 and 500 get produced?
| Code | Where | Example |
|---|---|---|
| 400 | `validate()` or invalid JSON in the route | empty title, title over 200 chars, non-boolean `done` |
| 404 | the `[id]` routes when no row matches | `GET /api/todos/999999` |
| 500 | `observe` catches any unexpected error | database down, a bug |
`observe` then logs them as `warn` (4xx) or `error` (5xx), which feeds the "Warnings & errors" panel.

---

## 7. Production readiness

### What would I change before deploying this for real users?
1. **Login and authorization.** Today anyone can send any `x-user-id` and see/change every todo. The user id is only a label.
2. **Database credentials from secrets**, not the default `app:app`, plus TLS to the database.
3. **Input limits and rate limiting** so one client cannot flood the API.
4. **Protect `/api/metrics`**, because it is currently public.
5. **Run in production mode** (`npm run build && npm start`) behind HTTPS, ideally in a container.
6. **Schema migrations** instead of the one-time `init.sh`, so database changes are tracked.
7. **Backups** of Postgres, and alerts (Grafana) for errors and slow requests.
8. **Health checks** for the platform (the app already has `/api/health`).

### How would I add login?
Add a users table, hash passwords (bcrypt), issue a signed token (JWT) in an httpOnly cookie, check it at the start of
each route, and save the real user id instead of the header. The new **microservices app** (`microservices-app/`) is a
full working example of exactly that, including the gateway and login analytics.

---

## 8. Hands-on experiments

1. **Add a field** `priority`: (a) `ALTER TABLE todos ADD COLUMN priority int NOT NULL DEFAULT 0;` in Adminer,
   (b) accept it in `validate()` and the SQL in `lib/todos.js`, (c) show it in `TodoApp.js`.
2. **New endpoint** `app/api/todos/stats/route.js` that returns done/not-done counts. Wrap it with `observe("/api/todos/stats", ...)`
   and find it in Prometheus under `route="/api/todos/stats"`.
3. **Break Postgres on purpose**: `docker compose stop postgres`, use the app, watch the 5xx panel, then start it again.
4. **Slow request**: add `await new Promise(r => setTimeout(r, 200))` in a handler, then search Loki for
   `{app="nextjs"} | json | duration_ms > 100` and watch p95 move.
5. **Find your own actions**: in Grafana Explore → Loki: `{app="nextjs"} | json | user_id="browser-user"`.
