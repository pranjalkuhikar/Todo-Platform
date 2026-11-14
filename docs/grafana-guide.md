# Grafana guide: see what your apps are doing

Grafana is only a **screen**. It stores nothing. It asks other tools for data and draws it:

```
Your app ──numbers──► Prometheus ─┐
   │                              ├──► Grafana  (http://localhost:3001)
   └──log lines─────► Loki ───────┤
Postgres (database rows) ─────────┘
```

| Data source (in Grafana) | What it gives | Language to ask |
|---|---|---|
| **Prometheus** | numbers over time (requests, speed, memory) | PromQL, e.g. `rate(http_requests_total[1m])` |
| **Loki** | log lines (one per request) | LogQL, e.g. `{app="nextjs"}` |
| **Postgres (nextapp)** / **Postgres (nodeapp)** | rows straight from the database | SQL |

They are all pre-configured. Nothing to set up.

---

## 1. Start and open

```bash
cd /Users/pranjalkuhikar/Desktop/Testing
docker compose up -d                 # Docker Desktop must be running
cd nextjs-app && npm run dev         # the app (Grafana shows nothing if the app is not running)
```

Open **http://localhost:3001**. No login needed locally. (The "Sign in" button in the corner is optional.)

Two ready-made dashboards (menu on the left → **Dashboards**):

| Dashboard | Direct link | For |
|---|---|---|
| **Observability Lab: Next.js vs Express** | http://localhost:3001/d/obs-lab | traffic, speed, errors, logs |
| **Postgres** | http://localhost:3001/d/pg-lab | the database (see `postgres-guide.md`) |

At the top right set **Last 15 minutes** and refresh **5s**, so you see what you are doing right now.

---

## 2. Dashboard "Observability Lab": every panel

Every panel is one query. Open the panel menu (hover, press `e`) → **Edit** to see it.

### Top row: single numbers (right now)
| Panel | Meaning | Query behind it |
|---|---|---|
| **Active users (last 5m, from logs)** | how many different `user_id`s made a request in the last 5 minutes. Requests without an `x-user-id` header count as `anonymous` | Loki: `count(sum by (user_id) (count_over_time({app=~".+"} \| json \| user_id != "" [5m])))` |
| **Requests / sec (now)** | requests per second over the last 30 s | `sum by (app) (rate(http_requests_total[30s]))` |
| **Error rate 5xx (now)** | server errors per second. **Should be empty or 0** | `...{status=~"5.."}...` |
| **Todos created (total)** | todos created since the app started | `sum by (app) (todo_operations_total{op="create"})` |

"No data" or `0` just means nothing happened in that window. It is not a fault.

### Graphs over time
| Panel | What to look for |
|---|---|
| **Request rate by app** | how busy each app is. Spikes = you used the app or ran the load test |
| **Latency p95 / p50 by app** | speed. p50 = typical request, p95 = slow end (95% are faster than this). A big gap between them = some requests are slow |
| **Responses by status code** | `200/201/204` = fine, `400/404` = bad input / not found, `500` = app bug |
| **User actions (CRUD ops / sec)** | what users do: create, update, delete, list, get |
| **Memory (RSS)** | RAM used by each app. A line that keeps climbing can mean a memory leak |
| **Log volume by level** | log lines per second: `info`, `warn`, `error` |

### Log panels (from Loki)
| Panel | Shows |
|---|---|
| **Warnings & errors** | only log lines with level `warn` or `error` (failed requests) |
| **All logs (live)** | every request, as it happens. Click a line to expand its fields |

A log line looks like:
```json
{"level":"info","app":"nextjs","method":"POST","route":"/api/todos","status":201,"duration_ms":4.2,"user_id":"alice"}
```

Next.js and Express appear on the same graphs (`app="nextjs"` and `app="express"`), so you can compare them.
Express only shows up while `node-app` is running.

---

## 3. Explore: ask your own questions

Left menu → **Explore**. Choose the data source at the top.

### Logs: pick **Loki**
Type a query and press **Run query** (top right):

| Query | Shows |
|---|---|
| `{app="nextjs"}` | all Next.js logs |
| `{app="express"}` | all Express logs |
| `{app="nextjs", level="error"}` | only errors |
| `{app=~".+"} \| json \| user_id="alice"` | everything alice did |
| `{app=~".+"} \| json \| status >= 400` | all failed requests |
| `{app=~".+"} \| json \| duration_ms > 50` | slow requests (over 50 ms) |
| `{app=~".+"} \| json \| route="/api/todos" \| method="POST"` | all todo creations |

`|= "text"` searches for plain text, e.g. `{app="nextjs"} |= "alice"`.

### Numbers: pick **Prometheus**
The same queries as in `prometheus-guide.md`, but with nicer graphs, e.g.
`sum by (app) (rate(http_requests_total[1m]))`.

### Database: pick **Postgres (nextapp)**
Switch the editor to **Code** and run SQL, e.g. `select * from todos order by id desc limit 20`.

---

## 4. Do it yourself: watch your actions appear

1. Open http://localhost:3001/d/obs-lab (15 min, 5 s refresh).
2. Create todos in the app, or run:
   ```bash
   curl -X POST localhost:3000/api/todos -H 'Content-Type: application/json' -H 'x-user-id: alice' -d '{"title":"hello"}'
   ```
3. Within about 10 seconds: **Requests / sec** and **Request rate** rise, **Todos created** goes up,
   **Active users** shows 1, and the request appears in **All logs**.
4. Make a deliberate error: `curl localhost:3000/api/todos/999999`. A `404` appears in
   **Responses by status code** and in **Warnings & errors**.
5. Heavy traffic: `node load-test/load.js --target next --duration 30`, and watch every panel fill up.
   (Don't run the load test with a real PostHog/Mixpanel key set.)

---

## 5. Handy Grafana controls

| Control | Where | Use |
|---|---|---|
| Time range | top right clock | "Last 5 minutes" to zoom in, "Last 6 hours" for history |
| Refresh | top right | `5s` live, or `Off` to freeze the screen while you read |
| Zoom | drag across a graph | zoom into that period |
| Hover | over a graph | exact values at that moment |
| Click legend name | below a graph | hide/show one line |
| Panel menu (`e`) | hover a panel | Edit, see the query, **Explore** to dig deeper |
| Dashboards → Import | left menu | add others from grafana.com |

Changes you make by clicking are lost if the container is recreated, because dashboards come from files in
`infra/grafana/dashboards/`. To keep a change, edit the JSON file there (or ask Claude to).

---

## 6. If something is empty or wrong

| Problem | Fix |
|---|---|
| Page won't open | Docker not running → `docker compose up -d` in `Testing` |
| All panels "No data" | App not running, or no requests lately. Make requests, wait 10 s. Check http://localhost:9090/targets: `nextjs` must be UP |
| Graphs OK, log panels empty | Loki is down (`docker compose ps`) or the app never started logging. Make a request |
| Only Next.js appears | Normal. Start `node-app` (`npm run dev`) to see `express` too |
| Numbers dropped to 0 | The app was restarted. Counters reset when an app restarts |
| Postgres panels empty | `docker compose ps` → `postgres` and `postgres-exporter` must be running |

## 7. Ports in this setup

| Thing | URL | Runs in |
|---|---|---|
| Grafana | http://localhost:3001 | Docker |
| Prometheus | http://localhost:9090 | Docker |
| Loki | http://localhost:3100 (API only) | Docker |
| Adminer (Postgres UI) | http://localhost:8081 | Docker |
| Postgres | localhost:5432 | Docker |
| Next.js app | http://localhost:3000 | **your Mac** |
| Express app | http://localhost:4000 | **your Mac** |
