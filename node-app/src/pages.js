// Server-rendered CRUD pages (EJS). They use the same database and the same counters as the JSON API under /api.
const express = require("express");
const path = require("path");
const { pool } = require("./db");
const { todoOps } = require("./metrics");
const { track } = require("./analytics");
const authhub = require("./authhub");

const PAGE_SIZE = 10;
const router = express.Router();
router.use(express.urlencoded({ extended: false, limit: "20kb" }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const FILTERS = new Set(["all", "open", "done"]);
const filterOf = (v) => (FILTERS.has(v) ? v : "all");
const cleanTitle = (v) => (typeof v === "string" && v.trim().length >= 1 && v.length <= 200 ? v.trim() : null);
const back = (res, filter, kind, text) => res.redirect(`/?filter=${filterOf(filter)}${text ? `&${kind}=${encodeURIComponent(text)}` : ""}`);

// Forms can be posted from other websites while you are signed in; only accept posts that come from this site.
router.use((req, res, next) => {
  if (req.method === "GET") return next();
  const from = req.get("origin") || req.get("referer");
  let ok = false;
  try { ok = !!from && new URL(from).host === req.get("host"); } catch {}
  if (!ok) return res.status(403).type("text").send("Cross-site form posts are not allowed.");
  next();
});

// who is signed in, for the header
router.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.hubUrl = authhub.hub;
  res.locals.logoutUrl = authhub.logoutUrl(); // no "return": AuthHub ends the session everywhere and shows its login page
  next();
});

router.get("/", wrap(async (req, res) => {
  const filter = filterOf(req.query.filter);
  const where = filter === "open" ? "WHERE done = false" : filter === "done" ? "WHERE done = true" : "";
  const c = (await pool.query("SELECT count(*)::int AS all, count(*) FILTER (WHERE done)::int AS done FROM todos")).rows[0];
  const total = filter === "open" ? c.all - c.done : filter === "done" ? c.done : c.all;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(parseInt(req.query.page) || 1, 1), pages);
  const { rows } = await pool.query(`SELECT * FROM todos ${where} ORDER BY id DESC LIMIT $1 OFFSET $2`, [PAGE_SIZE, (page - 1) * PAGE_SIZE]);
  todoOps.inc({ op: "list" });
  res.render("index", { todos: rows, filter, page, pages, counts: { all: c.all, done: c.done, open: c.all - c.done }, msg: req.query.msg || "", err: req.query.err || "" });
}));

router.post("/todos", wrap(async (req, res) => {
  const title = cleanTitle(req.body.title);
  if (!title) return back(res, req.body.filter, "err", "Title must be 1 to 200 characters.");
  const { rows } = await pool.query("INSERT INTO todos (title, done, user_id) VALUES ($1, false, $2) RETURNING id", [title, req.userId]);
  todoOps.inc({ op: "create" }); track(req.userId, "todo_created", { todo_id: rows[0].id });
  back(res, req.body.filter, "msg", "Todo added.");
}));

router.post("/todos/:id/toggle", wrap(async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.id)) return back(res, req.body.filter, "err", "Bad id.");
  const { rows } = await pool.query("UPDATE todos SET done = NOT done, updated_at = now() WHERE id = $1 RETURNING id", [req.params.id]);
  if (!rows[0]) return back(res, req.body.filter, "err", "That todo no longer exists.");
  todoOps.inc({ op: "update" }); track(req.userId, "todo_updated", { todo_id: rows[0].id });
  back(res, req.body.filter);
}));

router.post("/todos/:id/edit", wrap(async (req, res) => {
  const title = cleanTitle(req.body.title);
  if (!/^\d{1,10}$/.test(req.params.id) || !title) return back(res, req.body.filter, "err", "Title must be 1 to 200 characters.");
  const { rows } = await pool.query("UPDATE todos SET title = $2, updated_at = now() WHERE id = $1 RETURNING id", [req.params.id, title]);
  if (!rows[0]) return back(res, req.body.filter, "err", "That todo no longer exists.");
  todoOps.inc({ op: "update" }); track(req.userId, "todo_updated", { todo_id: rows[0].id });
  back(res, req.body.filter, "msg", "Saved.");
}));

router.post("/todos/:id/delete", wrap(async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.id)) return back(res, req.body.filter, "err", "Bad id.");
  const { rowCount } = await pool.query("DELETE FROM todos WHERE id = $1", [req.params.id]);
  if (rowCount) { todoOps.inc({ op: "delete" }); track(req.userId, "todo_deleted", { todo_id: Number(req.params.id) }); }
  back(res, req.body.filter, rowCount ? "msg" : "err", rowCount ? "Deleted." : "That todo no longer exists.");
}));

router.viewsDir = path.join(__dirname, "..", "views");
module.exports = router;
