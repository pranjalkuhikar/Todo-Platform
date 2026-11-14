import { pool } from "@/lib/db";
import { observe } from "@/lib/observe";

export const GET = observe("/api/health", async () => {
  await pool.query("SELECT 1");
  return Response.json({ status: "ok", server: "nextjs", db: "up" });
});
