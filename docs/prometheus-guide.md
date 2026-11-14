# Prometheus guide: how to see your app's metrics

Written for someone seeing Prometheus for the first time.
Covers the Next.js app (`nextjs`) and the Express app (`express`) in this folder.

---

## 1. What is what

| Tool | Port | Stores | You use it to see |
|---|---|---|---|
| Your app | 3000 / 4000 | nothing, it just counts | raw numbers at `/api/metrics` (Next.js) or `/metrics` (Express) |
| **Prometheus** | 9090 | **metrics** (numbers over time) | "how many?", "how fast?", "how busy?" |
| **Loki** | 3100 | **logs** (one text line per event) | "what exactly happened?" (viewed in Grafana) |
| **Grafana** | 3001 | nothing, it draws | graphs and logs from Prometheus and Loki |

**Important:** Prometheus shows numbers, not log lines. For log lines use Grafana, then Explore, then Loki.

How the numbers get there: every 5 seconds Prometheus opens your app's metrics page, reads the numbers and
saves them with a timestamp. That is how it can draw graphs of the past.

---

## 2. Before you start

1. Docker Desktop is running.
2. From the `Testing` folder: `docker compose up -d`
3. The app is running: `cd nextjs-app && npm run dev` (or `cd node-app && npm run dev`)
4. Make some activity: use the app, add/delete todos, or run curl. **No activity means no numbers to look at.**

### Check Prometheus is reading your app
1. Open http://localhost:9090
2. Top menu: **Status → Targets**
3. Find the rows `nextjs`, `express`, `postgres`.
   - **UP** (green) = working.
   - **DOWN** (red) = Prometheus cannot reach the app. Is it running? Read the error text in that row.

---

## 3. How to run a query (the 4 steps)

1. Open http://localhost:9090 and click **Query** in the top menu.
2. Click the big text box and type a query from section 5, for example `http_requests_total`.
3. Click the blue **Execute** button.
4. Look at the result under the box:
   - **Table** tab: the current numbers. **Start here.**
   - **Graph** tab: the same thing drawn over time. Use the time buttons (5m, 1h...) to zoom.

Tip: start typing `http_` or `todo_` and Prometheus suggests metric names.
If you see **"Empty query result"** see section 7.

---

## 4. How to read a result

```
http_requests_total{app="nextjs", method="DELETE", route="/api/todos/[id]", status="204"}   15
└─────── name ────┘└──────────────────────── labels ──────────────────────────────────┘   └ value
```

- **name**: what is being measured.
- **labels** (inside `{ }`): which requests it counts. Each combination of labels is a separate row.
- **value**: the number. Here, 15 deletes returned status 204.

### The metric types

| Type | Behaviour | Example | How to use it |
|---|---|---|---|
| **Counter** | only goes up (resets to 0 when the app restarts) | `http_requests_total` | use `rate(...)` for "per second" |
| **Gauge** | goes up and down | `process_resident_memory_bytes` | read it directly |
| **Histogram** | counts how many fall in each "speed bucket" | `http_request_duration_seconds` | has `_sum`, `_count`, `_bucket` parts |

For a histogram:
- `_count` = how many requests, `_sum` = total seconds they took.
- **Average time = `_sum / _count`.** Example: `0.0499 / 15 = 0.0033 s` = 3.3 ms per request.
- `_bucket{le="0.01"}` = how many finished in 10 ms or less. Used to calculate p50 / p95 (see below).

### Status codes
`2xx` success (200 ok, 201 created, 204 deleted) · `4xx` the caller's mistake (400 bad input, 404 not found) ·
`5xx` the app's fault (500). A growing `5xx` is the number to worry about.

---

## 5. Queries to try (copy, paste, Execute)

Replace `nextjs` with `express` to look at the other app.

### What is happening
| Query | Shows |
|---|---|
| `http_requests_total` | every request kind and how many happened |
| `http_requests_total{app="nextjs"}` | only the Next.js app |
| `http_requests_total{method="POST"}` | only POST (creates) |
| `http_requests_total{status="404"}` | only "not found" responses |
| `sum(http_requests_total)` | one number: all requests ever |
| `sum by (app) (http_requests_total)` | total per app (compare Next.js vs Express) |
| `sum by (status) (http_requests_total)` | totals grouped by status code |
| `sum by (route) (http_requests_total)` | which endpoints are used most |

### Per second ("right now")
| Query | Shows |
|---|---|
| `rate(http_requests_total[1m])` | requests/second per kind, over the last minute |
| `sum(rate(http_requests_total[1m]))` | total requests/second right now |
| `sum by (app) (rate(http_requests_total[1m]))` | requests/second per app |

Shows 0 if nothing happened in the last minute. Make some requests first.

### Speed
| Query | Shows |
|---|---|
| `http_request_duration_seconds_sum / http_request_duration_seconds_count` | average time per request kind (seconds) |
| `1000 * http_request_duration_seconds_sum / http_request_duration_seconds_count` | same, in milliseconds |
| `histogram_quantile(0.5, sum by (le, app) (rate(http_request_duration_seconds_bucket[5m])))` | **p50**: typical speed |
| `histogram_quantile(0.95, sum by (le, app) (rate(http_request_duration_seconds_bucket[5m])))` | **p95**: 95% of requests are faster than this |
| `histogram_quantile(0.99, sum by (le, app) (rate(http_request_duration_seconds_bucket[5m])))` | **p99**: the slow tail |

### Errors
| Query | Shows |
|---|---|
| `sum(rate(http_requests_total{status=~"5.."}[5m]))` | server errors per second (should be 0) |
| `sum(rate(http_requests_total{status=~"4.."}[5m]))` | client errors per second |
| `sum(http_requests_total{status=~"5.."})` | total server errors since start |

### What users do
| Query | Shows |
|---|---|
| `todo_operations_total` | creates, updates, deletes, lists, gets |
| `todo_operations_total{op="create"}` | how many todos were created |
| `todo_operations_total{op="delete"}` | how many were deleted |
| `sum by (op) (increase(todo_operations_total[5m]))` | what users did in the last 5 minutes |

### Health of the app itself
| Query | Shows |
|---|---|
| `up` | 1 = Prometheus can reach it, 0 = down |
| `process_resident_memory_bytes / 1024 / 1024` | memory used, in MB |
| `rate(process_cpu_seconds_total[1m])` | CPU use (1 = one full core) |
| `nodejs_eventloop_lag_seconds` | how overloaded Node is (higher = slower) |
| `nodejs_heap_size_used_bytes / 1024 / 1024` | JavaScript memory, in MB |

### Database (Postgres)
| Query | Shows |
|---|---|
| `pg_up` | 1 = database reachable |
| `pg_stat_database_numbackends` | open connections per database |

### Not sure what exists?
Click the **globe icon / "metrics explorer"** next to the Execute button to browse every metric name, or type
`{__name__=~".+"}` to list everything (long).

---

## 6. Try it yourself (2 minutes)

1. Query `todo_operations_total{op="create"}`, Execute, and note the number.
2. Add a todo in the app.
3. Wait ~5 seconds, Execute again. The number went up by 1.
4. Switch to the **Graph** tab to see the line step up.

Now load it up: from `Testing`, run `node load-test/load.js --target next --duration 30`.
While it runs, query `sum by (app) (rate(http_requests_total[1m]))` on the Graph tab and watch it rise, then fall.

---

## 7. If something looks wrong

| Problem | Reason / fix |
|---|---|
| "Empty query result" | Typo in the name (use the suggestions); no requests made yet; or Status → Targets shows DOWN |
| Target is DOWN | App is not running, or wrong port. Next.js must be on 3000, Express on 4000 |
| `rate(...)` shows nothing/0 | No requests in the last minute. Make some, wait 5-10 s, Execute again |
| Numbers dropped back to 0 | You restarted the app. Counters reset on restart (`rate()` handles this) |
| Page won't open | Docker is not running, or run `docker compose up -d` in `Testing` |

## 8. Where to go next
- **Grafana** (http://localhost:3001): the dashboard "Observability Lab" runs these same queries and draws them for you.
  Click a panel title, then Edit, to see the query behind it.
- **Logs**: Grafana → Explore → Loki → `{app="nextjs"}`.
- **User tracking over time** (retention, funnels): PostHog or Mixpanel, see the main `README.md`.
