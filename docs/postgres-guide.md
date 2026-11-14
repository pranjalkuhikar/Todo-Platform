# Postgres guide: see your database and everything in it

Postgres has no web page of its own. You look at it through a tool that connects to it.
In this project there are **three** ways, and you can use all of them:

| Way | Opens at | Best for |
|---|---|---|
| **Adminer** (web UI) | http://localhost:8081 | browsing tables and rows, editing data, running SQL |
| **Grafana, "Postgres" dashboard** | http://localhost:3001/d/pg-lab | live graphs: is the DB healthy, how busy, latest todos |
| **Terminal (`psql`)** | your terminal | quick checks and copy-paste SQL |

---

## 1. Facts you need

| | |
|---|---|
| Server / host | `localhost` port `5432` (from your Mac) · `postgres` (from inside Docker) |
| User / password | `app` / `app` (local lab only) |
| Database **`nextapp`** | used by the Next.js app |
| Database **`nodeapp`** | used by the Express app |
| Table in each | `todos` |

`todos` columns:

| Column | Meaning |
|---|---|
| `id` | auto number, 1, 2, 3 ... |
| `title` | the todo text (1-200 characters) |
| `done` | `true` / `false` |
| `user_id` | who created it (from the `x-user-id` header; may be empty) |
| `created_at`, `updated_at` | timestamps |

Two separate databases are used so that Next.js and Express results never mix.

## 2. Start it

```bash
cd /Users/pranjalkuhikar/Desktop/Testing
docker compose up -d        # starts Postgres, Adminer, Grafana, Prometheus, Loki
docker compose ps           # all should say "Up"; postgres should say "healthy"
```

---

## 3. Way 1: Adminer (the web UI)

1. Open **http://localhost:8081**
2. Fill in:

   | Field | Value |
   |---|---|
   | System | PostgreSQL |
   | Server | `postgres` |
   | Username | `app` |
   | Password | `app` |
   | Database | `nextapp` (or `nodeapp`) |

3. Click **Login**.

### What you see and where
- **Left side**: the list of tables. Click **todos**.
- **Select data** (top): the rows. Click the `id` header to sort. Newest todos are at the highest `id`.
- **Show structure**: the columns and their types.
- **Edit** (next to a row): change a row. **New item**: insert a row by hand.
- **SQL command** (left menu): type any SQL and click **Execute**.
- Top left, the **database name** (`nextapp`): switch to `nodeapp`, or see all tables at once.

### Check that your app is really saving
1. In the Next.js app add a todo called `hello from the app`.
2. In Adminer: `todos` → **Select data**. Your row is at the top.
3. Mark it done in the app, refresh Adminer: `done` is now `t` (true).
4. Delete it in the app: the row is gone.

That is the proof that the app saves to Postgres.

### Switching databases
Top-left link of the database name → choose `nodeapp`, or log out and log in with Database `nodeapp`.

---

## 4. Way 2: Grafana "Postgres" dashboard

Open **http://localhost:3001/d/pg-lab** (or Dashboards → **Postgres**). Set "Last 15 minutes", refresh 5 s.

| Panel | Meaning |
|---|---|
| **Postgres up** | `1` = database reachable. `0` = down |
| **Active connections** | queries running right now |
| **nextapp: total todos** | rows in the table (live SQL count) |
| **nextapp: done** | how many are marked done |
| **nextapp DB size** | disk size of the database |
| **Transactions / sec** | `commit` = successful, `rollback` = failed/undone. Rollbacks should be ~0 |
| **Rows inserted / updated / deleted per sec** | the database-level view of your creates / edits / deletes |
| **Connections by state** | `active` (working), `idle` (waiting), `idle in transaction` (watch this one) |
| **Todos created per minute (nextapp)** | bar graph from `created_at` |
| **Latest todos (nextapp)** | table of the newest 50 rows. A live view of the data in Grafana |

Create todos and watch **Rows inserted** jump and **Latest todos** update.

Where the numbers come from: **postgres-exporter** (a small Docker container) reads Postgres statistics, Prometheus
collects them, and Grafana draws them. The two "todos" panels and the latest-todos table query the database
directly via Grafana's Postgres data sources (`Postgres (nextapp)`, `Postgres (nodeapp)`).

---

## 5. Way 3: terminal

Run from the `Testing` folder:

```bash
# open an interactive session (type \q to leave)
docker compose exec postgres psql -U app -d nextapp

# or run one query
docker compose exec postgres psql -U app -d nextapp -c "SELECT * FROM todos ORDER BY id DESC LIMIT 10;"
```

Handy commands inside `psql`:

| Command | Does |
|---|---|
| `\l` | list databases |
| `\c nodeapp` | switch to another database |
| `\dt` | list tables |
| `\d todos` | show a table's columns |
| `\x` | toggle vertical output for wide rows |
| `\q` | quit |

---

## 6. SQL you can paste (Adminer "SQL command", `psql`, or Grafana Explore)

```sql
-- newest 10 todos
SELECT id, title, done, user_id, created_at FROM todos ORDER BY id DESC LIMIT 10;

-- how many in total, done, not done
SELECT count(*) AS total,
       count(*) FILTER (WHERE done)     AS done,
       count(*) FILTER (WHERE NOT done) AS not_done
FROM todos;

-- who created the most
SELECT user_id, count(*) AS todos FROM todos GROUP BY user_id ORDER BY todos DESC;

-- one user's todos
SELECT * FROM todos WHERE user_id = 'alice' ORDER BY id DESC;

-- todos per minute, last hour
SELECT date_trunc('minute', created_at) AS minute, count(*)
FROM todos WHERE created_at > now() - interval '1 hour'
GROUP BY 1 ORDER BY 1;

-- search by text
SELECT * FROM todos WHERE title ILIKE '%milk%';

-- size of the table
SELECT pg_size_pretty(pg_total_relation_size('todos')) AS size;

-- who is connected right now
SELECT datname, usename, state, query FROM pg_stat_activity WHERE datname IS NOT NULL;
```

### Changing data (be careful: there is no undo)
```sql
UPDATE todos SET done = true WHERE id = 5;
DELETE FROM todos WHERE id = 5;
DELETE FROM todos;                -- removes EVERY todo in this database!
```
Always put a `WHERE` unless you really want to touch every row.

---

## 7. Why there are so many rows

The load test (`node load-test/load.js`) creates thousands of todos with fake users (`user-1`, `user-2`, ...).
To see only real ones, filter by your `user_id` (e.g. `alice`) or sort by newest.

To empty the table but keep it:
```sql
TRUNCATE todos RESTART IDENTITY;
```
To wipe the whole lab (Postgres, logs, metrics, dashboards' data):
```bash
docker compose down -v       # then docker compose up -d to start fresh
```

---

## 8. If something does not work

| Problem | Fix |
|---|---|
| Adminer page won't open | `docker compose up -d`; check `docker compose ps` shows `adminer` |
| Adminer: "could not translate host name" | Server must be `postgres` (not `localhost`) inside Adminer |
| Adminer: login failed | user `app`, password `app`, database `nextapp` or `nodeapp` |
| App shows an error about the database | `docker compose ps` → postgres must be `healthy` |
| Port 5432 already in use | You have a local Postgres on your Mac. Stop it, or change the left side of `5432:5432` in `docker-compose.yml` |
| Grafana Postgres panels empty | `postgres-exporter` not running (`docker compose ps`) or no activity yet |
| Data is gone after `down -v` | `-v` deletes the volume. Plain `docker compose down` keeps data |
