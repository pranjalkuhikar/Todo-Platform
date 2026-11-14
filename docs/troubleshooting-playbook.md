# Troubleshooting playbook: "something is wrong, where do I look?"

Method for every problem, in this order:

```
1. SEE IT      Grafana dashboard  (is something red / spiking? since when?)
2. FIND WHY    Logs               (what exactly failed, for which user?)
3. CONFIRM     Database / service (is the data or the dependency broken?)
4. FIX         then check the graph goes back to normal
```

The database is the **last** step, not the first.

## Tools and where they live

| Tool | URL / command | Answers |
|---|---|---|
| Grafana dashboard | http://localhost:3001 (Observability Lab) | is it up, busy, slow, erroring |
| Grafana Explore → Loki | http://localhost:3001/explore | what exactly happened (log lines) |
| Grafana alerts | Alerting → Alert rules | which problem is active now |
| Prometheus | http://localhost:9090 (Status → Targets, Query) | raw numbers, is a target reachable |
| Adminer | http://localhost:8081 | what is stored |
| Terminal of the app | where you ran `npm run dev` | live log lines, crash messages |
| Docker | `docker compose ps`, `docker compose logs <service>` | are containers running, their logs |

---

# PART 1: Next.js app (localhost:3000)

**Identity in tools:** logs `app="nextjs"` · metrics label `app="nextjs"` · database `nextapp` · numbers at `/api/metrics`.

**What each log line holds:** `method, route, path, status, duration_ms, user_id`. Clicks in the browser show up as
`user_id = browser-user`; curl shows whatever `x-user-id` you sent (or `anonymous`).
There is **no request id** in these logs. To find one request, match on user, route, time and status.

## Scenario 1: "The page doesn't open"
| Step | Where | What you see |
|---|---|---|
| See | Grafana → "Apps running": **nextjs DOWN** (red). After 1 min the alert "Next.js app is DOWN" fires | the app is not reachable |
| Why | the terminal where `npm run dev` runs | a crash message, or the terminal is closed |
| Check | `lsof -i :3000` | another program may already use port 3000 |
| Fix | `cd nextjs-app && npm run dev` (kill the other program if the port is taken) | tile turns green |

## Scenario 2: "Adding / saving todos fails" (500 errors)
| Step | Where | What you see |
|---|---|---|
| See | Grafana: "Error rate 5xx" panel leaves 0, "Responses by status code" shows `500`. Alert "High server error rate" goes Pending, then Firing | server errors |
| Why | Explore → Loki: `{app="nextjs", level="error"}` | lines with `"msg":"unhandled error"` and a `stack` starting `AggregateError ... pg-pool`. The `error` text is **blank** for a database that refuses connections (Node wraps the failures in an AggregateError with no message). The `pg-pool` in the stack is the clue: the database connection failed |
| Confirm | Grafana → "Postgres" dashboard: **Postgres up = 0**. Or `docker compose ps` in `Testing` | database is down |
| Fix | `cd Testing && docker compose start postgres` | |
| Verify | Postgres up = 1, the 5xx panel drops back to 0. No app restart needed: the connection pool reconnects | |

Try it safely: `docker compose stop postgres`, click around in the app, follow the table above, then start it again.

## Scenario 3: "The app is slow"
| Step | Where | What you see |
|---|---|---|
| See | "Latency p95 / p50" climbs. Alert "Slow requests (p95 over 500 ms)" | requests take longer |
| Which route | Prometheus: `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))` | the slowest endpoint |
| Which requests | Loki: `{app="nextjs"} \| json \| duration_ms > 100` | the slow lines, with route and user |
| Is it the DB | Postgres dashboard: "Active connections" near 10 means requests queue for the pool | |
| Is it the machine | Prometheus: `rate(process_cpu_seconds_total[1m])` near 1; `nodejs_eventloop_lag_seconds` rising | |
| Fix by cause | big table: add a filter / index / LIMIT · too many connections: reduce load or raise pool · dev mode: run `npm run build && npm start` | |

## Scenario 4: "A user says their todo disappeared"
| Step | Where | What you see |
|---|---|---|
| Find deletes | Loki: `{app="nextjs"} \| json \| method="DELETE" \| status=204` | who deleted, when, which `path` (the id) |
| Narrow | add `\| user_id="browser-user"` | only that user |
| Confirm | Adminer: `SELECT * FROM todos WHERE id = <id>;` | row is gone (it was deleted) or still exists (it was not) |
| Note | todos are not soft-deleted; once deleted, only a backup brings them back | this is why backups matter in production |

## Scenario 5: "Lots of 400 / 404 errors"
| Step | Where | What you see |
|---|---|---|
| See | "Responses by status code" shows 400 or 404 rising | callers send bad requests |
| Why | Loki: `{app="nextjs", level="warn"}` | which `route` and `path` (e.g. `/api/todos/999999`) |
| Meaning | 400 = bad input (empty title, bad JSON), 404 = id not found | usually a client bug, not a server fault |
| Fix | fix the caller, or the link/id that is wrong | |

---

# PART 2: Node.js / Express app (localhost:4000)

**Identity in tools:** logs `app="express"` · metrics label `app="express"` · database `nodeapp` · numbers at
`localhost:4000/metrics` · routes are named like `/api/todos/:id` (Next.js uses `[id]`).

Same log fields and the same dashboards as Next.js; everything in Part 1 works by replacing `nextjs` with `express`
and `nextapp` with `nodeapp`. Express has no web page, so test with curl.

## Scenario 6: "The API stopped responding"
| Step | Where | What you see |
|---|---|---|
| See | "Apps running": **express DOWN** | |
| Why | the terminal running `npm run dev` | a crash trace, or you stopped it |
| Check | `curl localhost:4000/api/health` | `{"status":"ok","db":"up"}` when healthy |
| Fix | `cd node-app && npm run dev` | tile goes green |

## Scenario 7: "Memory keeps growing"
| Step | Where | What you see |
|---|---|---|
| See | Grafana "Memory (RSS)": a line that only climbs and never drops | possible memory leak |
| Numbers | Prometheus: `process_resident_memory_bytes{app="express"} / 1024 / 1024` | MB used |
| Why | `nodejs_heap_size_used_bytes` also climbing = JavaScript objects piling up | |
| Fix | find what is kept forever (large arrays/caches), restart as a stop-gap, add a memory limit in production | |

## Scenario 8: "Which is faster, Next.js or Express?"
Run both in production-like mode, then `node load-test/load.js` and compare on the same graphs:
"Request rate by app" and "Latency p95 / p50 by app" show both apps side by side (`app` label).
Also compare "Memory (RSS)".

---

# PART 3: Microservices app (localhost:8080)

Architecture: `browser → gateway → todo-service / frontend`, with sign-in done by the central AuthHub (`authhub` database). todo-service has its own database (`tododb`). Only the gateway is public.

**Where things are:**
| What | Where |
|---|---|
| Logs | the terminal of `docker compose up`, or `docker compose logs -f gateway` (also `todo-service`, `frontend`) |
| Is everything up | `docker compose ps` (all should say `healthy`) and `curl localhost:8080/readyz` |
| Login analytics | the app's **Login analytics** page (admin sees everyone) |
| Databases | `docker compose exec postgres psql -U app -d tododb` |
| Metrics | each service's `/metrics`. **Not connected to Grafana yet**; Docker doesn't publish those ports |

**The key feature: the request id.** Every request gets an id. It is returned in the `x-request-id` header and in every error body
(`"request_id": "..."`), and it appears in the gateway log **and** in the service log. One id lets you follow one request across services.

Logs are JSON lines. Search with `docker compose logs gateway todo-service | grep <request_id>`.
(Logs go to Loki only if you set `LOKI_URL` in `.env`.)

## Scenario 9: "Users can't log in"
| Step | Where | What you see |
|---|---|---|
| See | app → **Login analytics** (admin): failed logins up, "Why logins failed" table | the reasons |
| Reason `wrong_password` / `unknown_user` | users typing wrong credentials | normal, unless it is a flood from one IP (attack) |
| Reason `locked_out` | an email had 5 failures in 15 min: the user gets **429** | wait 15 min, or clear it (below) |
| Check | `docker exec observability-lab-postgres-1 psql -U app -d authhub -c "SELECT email, success, detail, at FROM audit_events WHERE event = 'login' AND NOT success ORDER BY at DESC LIMIT 10;"` | exact attempts (sign-in lives in AuthHub) |
| Unlock a user | `docker exec observability-lab-postgres-1 psql -U app -d authhub -c "DELETE FROM audit_events WHERE event = 'login' AND NOT success AND email = 'x@y.com';"` | |
| Also check | the AuthHub terminal for login errors | |

## Scenario 10: "Everything returns 502 / 503 / 504"
| Step | Where | What you see |
|---|---|---|
| Meaning | **502** = a service is unreachable · **504** = a service is too slow (10 s timeout) | the gateway cannot get an answer |
| Check | `curl localhost:8080/readyz` | `{"upstreams":{"auth":"up","todos":"down"}}` tells which one |
| Why | `docker compose ps` and `docker compose logs todo-service` | crashed, unhealthy, or cannot reach its database |
| Fix | `docker compose restart todo-service` (or `up -d`); if the DB is the cause: `docker compose logs postgres` | |
| Verify | `/readyz` says `ready` | |

## Scenario 11: "One user reports an error; trace it"
1. Ask for the `request_id` shown in the error response (or read the `x-request-id` header in the browser's Network tab).
2. `docker compose logs gateway todo-service | grep <request_id>`.
3. You see the gateway line (status, duration) and the service line for the same request. The service line shows
   where it failed, and an `unhandled error` entry with the real cause if it was a 500.

## Scenario 12: "401 Unauthorized everywhere"
| Reason code in the response | Meaning | Fix |
|---|---|---|
| `missing_token` | not logged in / cookie not sent | log in again |
| `token_expired` | the login lasted 1 hour | log in again |
| `invalid_token` | wrong/tampered token, or AuthHub's signing key was rotated | sign out and sign in again through AuthHub |
| `internal_only` (from a backend) | someone called a service directly, or **`INTERNAL_TOKEN` differs** between services | same `INTERNAL_TOKEN` for all three |

## Scenario 13: "403 bad_origin" or "429 rate_limited"
- **403 `bad_origin`**: a browser from another website/domain sent a write. Add your real domain to `ALLOWED_ORIGINS` in `.env`.
- **429 `rate_limited`**: one IP sent too many requests (20 login/min, 300 API/min by default). Normal under attack;
  tune `RATE_LIMIT_*` if real users hit it. Behind a load balancer set `TRUST_PROXY=1`, otherwise all users look like one IP.

## Scenario 14: "A user sees someone else's todos?" (security check)
Cannot happen by design: every todo query filters by `user_id` taken from the gateway-verified token, and asking for another user's
todo returns 404. Verify with `node scripts/smoke-test.js` (the "isolation + security" section).

---

# Cheat sheet: symptom → first place to look

| Symptom | First look |
|---|---|
| Site/API unreachable | Grafana "Apps running" / `docker compose ps` |
| Errors (500, 502) | Grafana 5xx panel → Loki `level="error"` |
| Slow | Grafana p95 → Loki `duration_ms > 100` → Postgres dashboard |
| One user's problem | Loki `user_id="..."` (microservices: the `request_id`) |
| Login problems | Login analytics page, `login_events` table |
| Data wrong or missing | Adminer / `psql`, after the logs say which request touched it |
| Crash after a change | the terminal / `docker compose logs <service>` |

## Production reality check
- Alerts must **notify** you (email/Slack). Right now they only show inside Grafana.
- Logs must be centralised (Loki) because containers get replaced and their terminal output disappears.
- Take database backups: deleted data cannot be recovered from logs or graphs.
- Keep Grafana, Prometheus and Adminer **off the public internet** (or behind a login).
