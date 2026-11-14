import { pool } from "./db";
import { logger } from "./logger";

// Starter todos, inserted ONLY when the table is empty (so your own edits/deletes are never overwritten).
const SAMPLE_TODOS = [
  ["Welcome! Tick me to mark this as done", false],
  ["Edit or delete any todo to try the app", false],
  ["Add your own todo with the form above", false],
  ["Open Grafana (localhost:3001) to watch requests", false],
  ["Check these rows in Adminer (localhost:8081)", false],
  ["Read the guides in the docs/ folder", true],
];

export async function seedIfEmpty() {
  const placeholders = SAMPLE_TODOS.map((_, i) => "($" + (i * 2 + 1) + "::text, $" + (i * 2 + 2) + "::boolean, 'demo')").join(", ");
  const params = SAMPLE_TODOS.flat();
  const { rowCount } = await pool.query(
    `INSERT INTO todos (title, done, user_id)
     SELECT * FROM (VALUES ${placeholders}) AS v(title, done, user_id)
     WHERE NOT EXISTS (SELECT 1 FROM todos)`,
    params
  );
  if (rowCount > 0) logger.info("seeded sample todos", { count: rowCount });
}
