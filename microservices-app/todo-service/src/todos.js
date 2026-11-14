const express = require("express");
const { z } = require("zod");
const { pool } = require("./db");
const { todoOps } = require("./metrics");
const { track } = require("./analytics");
const { wrap, requireUser } = require("./http");

const router = express.Router();
router.use(requireUser);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(200, "title must be at most 200 characters"),
  description: z.string().trim().max(2000, "description must be at most 2000 characters").optional(),
  done: z.boolean().optional(),
});
const updateSchema = createSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field to update");

function parse(schema, body) {
  const r = schema.safeParse(body);
  if (r.success) return { value: r.data };
  const details = r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
  return { error: { error: details[0]?.message ?? "Invalid request", code: "validation_error", details } };
}

function idParam(req, res, next) {
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: "id must be a UUID", code: "invalid_id" });
  next();
}

// Every query below filters on user_id: users can only ever see and change their own todos.
// Asking for someone else's todo returns 404, the same as a todo that doesn't exist.

// LIST: ?limit=20&offset=0&done=true&q=milk
router.get("/", wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const done = req.query.done === "true" ? true : req.query.done === "false" ? false : null;
  const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim().slice(0, 100) : null;
  const where = `user_id = $1 AND ($2::boolean IS NULL OR done = $2)
                 AND ($3::text IS NULL OR title ILIKE '%' || $3 || '%' OR description ILIKE '%' || $3 || '%')`;
  const [rows, count, stats] = await Promise.all([
    pool.query(`SELECT * FROM todos WHERE ${where} ORDER BY created_at DESC, id LIMIT $4 OFFSET $5`, [
      req.user.id, done, q, limit, offset,
    ]),
    pool.query(`SELECT count(*)::int AS total FROM todos WHERE ${where}`, [req.user.id, done, q]),
    pool.query(
      `SELECT count(*)::int AS all, count(*) FILTER (WHERE done)::int AS done FROM todos WHERE user_id = $1`,
      [req.user.id]
    ),
  ]);
  todoOps.inc({ op: "list" });
  res.json({ data: rows.rows, total: count.rows[0].total, limit, offset, stats: stats.rows[0] });
}));

// READ
router.get("/:id", idParam, wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM todos WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: "Not found", code: "not_found" });
  todoOps.inc({ op: "get" });
  res.json(rows[0]);
}));

// CREATE
router.post("/", wrap(async (req, res) => {
  const { value, error } = parse(createSchema, req.body);
  if (error) return res.status(400).json(error);
  const { rows } = await pool.query(
    `INSERT INTO todos (user_id, title, description, done)
     VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, false)) RETURNING *`,
    [req.user.id, value.title, value.description ?? null, value.done ?? null]
  );
  todoOps.inc({ op: "create" });
  track(req.user.id, "todo_created", { todo_id: rows[0].id });
  res.status(201).json(rows[0]);
}));

// UPDATE (partial: send only the fields you want to change)
const update = wrap(async (req, res) => {
  const { value, error } = parse(updateSchema, req.body);
  if (error) return res.status(400).json(error);
  const { rows } = await pool.query(
    `UPDATE todos SET title = COALESCE($3, title), description = COALESCE($4, description),
                      done = COALESCE($5, done), updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [req.params.id, req.user.id, value.title ?? null, value.description ?? null, value.done ?? null]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found", code: "not_found" });
  todoOps.inc({ op: "update" });
  track(req.user.id, "todo_updated", { todo_id: rows[0].id, done: rows[0].done });
  res.json(rows[0]);
});
router.put("/:id", idParam, update);
router.patch("/:id", idParam, update);

// DELETE
router.delete("/:id", idParam, wrap(async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM todos WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ error: "Not found", code: "not_found" });
  todoOps.inc({ op: "delete" });
  track(req.user.id, "todo_deleted", { todo_id: req.params.id });
  res.status(204).end();
}));

module.exports = router;
