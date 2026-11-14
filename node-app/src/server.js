const express = require("express");
const { pool } = require("./db");
const { logger, flushLogs } = require("./logger");
const { register, httpRequests, httpDuration, todoOps } = require("./metrics");
const { track } = require("./analytics");

const pages = require("./pages");
const app = express();
app.set("view engine", "ejs");
app.set("views", pages.viewsDir);
app.use(express.json({ limit: "100kb" }));

// ---- observability middleware: one log line + metrics per request ----
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  req.userId = req.get("x-user-id") || "anonymous";
  res.on("finish", () => {
    const sec = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route ? req.baseUrl + req.route.path : "unmatched";
    if (route === "/metrics") return;
    const labels = { method: req.method, route, status: res.statusCode };
    httpRequests.inc(labels);
    httpDuration.observe(labels, sec);
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]("request", {
      method: req.method,
      route,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Math.round(sec * 1000 * 100) / 100,
      user_id: req.userId,
    });
  });
  next();
});

// ---- central sign-in (AuthHub). Off unless AUTH_REQUIRED=true, so existing clients and load tests keep working ----
const authhub = require("./authhub");
const PUBLIC_PATHS = new Set(["/api/health", "/metrics"]);
if (authhub.enabled) {
  app.use(async (req, res, next) => {
    if (PUBLIC_PATHS.has(req.path)) return next();
    const r = await authhub.authenticate(req.get("authorization"), req.headers.cookie);
    if (!r.ok) {
      // a browser opening a page goes to the sign-in screen; API callers get JSON
      const here = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      if (req.method === "GET" && !req.path.startsWith("/api/") && (req.get("accept") || "").includes("text/html")) {
        if (r.reason === "hub_unavailable") return res.status(503).type("text").send("The sign-in service is unavailable. Try again shortly.");
        return res.redirect(authhub.loginUrl(here));
      }
      return res.status(authhub.STATUS[r.reason]).json({
        error: authhub.MESSAGES[r.reason], code: r.reason,
        login_url: authhub.loginUrl(`${req.protocol}://${req.get("host")}${req.originalUrl}`),
      });
    }
    req.user = r.user;
    req.userId = r.user.id; // the verified identity replaces anything a client might put in x-user-id
    next();
  });
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_ID = 2147483647;
const parseId = (v) => (/^\d+$/.test(v) && Number(v) <= MAX_ID ? Number(v) : null);

function validate(body, { requireTitle }) {
  const out = {};
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { error: "JSON object body required" };
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length < 1 || body.title.length > 200)
      return { error: "title must be a string of 1-200 characters" };
    out.title = body.title.trim();
  } else if (requireTitle) return { error: "title is required" };
  if (body.done !== undefined) {
    if (typeof body.done !== "boolean") return { error: "done must be a boolean" };
    out.done = body.done;
  }
  return { value: out };
}

app.get("/api/health", wrap(async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", server: "node-express", db: "up" });
}));

app.get("/api/me", (req, res) => (req.user ? res.json({ user: req.user }) : res.status(401).json({ error: "Not signed in (AUTH_REQUIRED is off)" })));

app.get("/metrics", wrap(async (req, res) => {
  res.set("Content-Type", register.contentType).send(await register.metrics());
}));

// READ (list, with pagination + optional ?done=true|false)
app.get("/api/todos", wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const done = req.query.done === undefined ? null : req.query.done === "true";
  const [rows, count] = await Promise.all([
    pool.query(
      "SELECT * FROM todos WHERE ($1::boolean IS NULL OR done = $1) ORDER BY id DESC LIMIT $2 OFFSET $3",
      [done, limit, offset]
    ),
    pool.query("SELECT count(*)::int AS total FROM todos WHERE ($1::boolean IS NULL OR done = $1)", [done]),
  ]);
  todoOps.inc({ op: "list" });
  res.json({ data: rows.rows, total: count.rows[0].total, limit, offset });
}));

// READ (one)
app.get("/api/todos/:id", wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "id must be a positive integer" });
  const { rows } = await pool.query("SELECT * FROM todos WHERE id = $1", [id]);
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  todoOps.inc({ op: "get" });
  res.json(rows[0]);
}));

// CREATE
app.post("/api/todos", wrap(async (req, res) => {
  const { value, error } = validate(req.body, { requireTitle: true });
  if (error) return res.status(400).json({ error });
  const { rows } = await pool.query(
    "INSERT INTO todos (title, done, user_id) VALUES ($1, COALESCE($2, false), $3) RETURNING *",
    [value.title, value.done ?? null, req.userId]
  );
  todoOps.inc({ op: "create" });
  track(req.userId, "todo_created", { todo_id: rows[0].id });
  res.status(201).json(rows[0]);
}));

// UPDATE (partial: send only the fields you want to change)
const update = wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "id must be a positive integer" });
  const { value, error } = validate(req.body, { requireTitle: false });
  if (error) return res.status(400).json({ error });
  const { rows } = await pool.query(
    `UPDATE todos SET title = COALESCE($2, title), done = COALESCE($3, done), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, value.title ?? null, value.done ?? null]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  todoOps.inc({ op: "update" });
  track(req.userId, "todo_updated", { todo_id: id });
  res.json(rows[0]);
});
app.put("/api/todos/:id", update);
app.patch("/api/todos/:id", update);

// DELETE
app.delete("/api/todos/:id", wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "id must be a positive integer" });
  const { rowCount } = await pool.query("DELETE FROM todos WHERE id = $1", [id]);
  if (!rowCount) return res.status(404).json({ error: "Not found" });
  todoOps.inc({ op: "delete" });
  track(req.userId, "todo_deleted", { todo_id: id });
  res.status(204).end();
}));

// server-rendered pages (EJS)
app.use(pages);

// bad JSON, unknown routes, and any unexpected error
app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
  logger.error("unhandled error", { error: err.message, stack: err.stack, user_id: req.userId });
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => logger.info("server started", { port: PORT }));

const shutdown = async () => {
  server.close();
  await flushLogs();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
