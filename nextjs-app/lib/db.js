import { Pool } from "pg";

// Kept on globalThis so dev hot-reload doesn't open a new pool every time.
const g = globalThis;
g.__pool ??= new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://app:app@localhost:5432/nextapp",
  max: 10,
});
export const pool = g.__pool;
