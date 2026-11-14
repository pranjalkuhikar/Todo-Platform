import { pool } from "./db";

const MAX_ID = 2147483647;
export const parseId = (v) => (/^\d+$/.test(v) && Number(v) <= MAX_ID ? Number(v) : null);

export function validate(body, { requireTitle }) {
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

export async function listTodos({ limit = 20, offset = 0, done = null } = {}) {
  const [rows, count] = await Promise.all([
    pool.query(
      "SELECT * FROM todos WHERE ($1::boolean IS NULL OR done = $1) ORDER BY id DESC LIMIT $2 OFFSET $3",
      [done, limit, offset]
    ),
    pool.query("SELECT count(*)::int AS total FROM todos WHERE ($1::boolean IS NULL OR done = $1)", [done]),
  ]);
  return { data: rows.rows, total: count.rows[0].total, limit, offset };
}

export async function getTodo(id) {
  const { rows } = await pool.query("SELECT * FROM todos WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function createTodo({ title, done }, userId) {
  const { rows } = await pool.query(
    "INSERT INTO todos (title, done, user_id) VALUES ($1, COALESCE($2, false), $3) RETURNING *",
    [title, done ?? null, userId]
  );
  return rows[0];
}

export async function updateTodo(id, { title, done }) {
  const { rows } = await pool.query(
    `UPDATE todos SET title = COALESCE($2, title), done = COALESCE($3, done), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, title ?? null, done ?? null]
  );
  return rows[0] ?? null;
}

export async function deleteTodo(id) {
  const { rowCount } = await pool.query("DELETE FROM todos WHERE id = $1", [id]);
  return rowCount > 0;
}
