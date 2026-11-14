import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 100, 1), 500);
  const where = [], vals = [];
  if (sp.get("failed") === "1") where.push("NOT success");
  const q = (sp.get("q") || "").trim().toLowerCase();
  if (q) { vals.push(`%${q}%`); where.push(`(lower(coalesce(email,'')) LIKE $${vals.length} OR lower(event) LIKE $${vals.length} OR lower(coalesce(app,'')) LIKE $${vals.length})`); }
  vals.push(limit);
  const { rows } = await query(`SELECT id, at, event, success, email, app, ip, detail FROM audit_events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY at DESC LIMIT $${vals.length}`, vals);
  const { rows: stats } = await query(`SELECT count(*) FILTER (WHERE event='login' AND success)::int AS logins_ok,
      count(*) FILTER (WHERE event='login' AND NOT success)::int AS logins_failed,
      (SELECT count(*)::int FROM sessions WHERE NOT revoked AND expires_at > now()) AS active_sessions
    FROM audit_events WHERE at > now() - interval '24 hours'`);
  return NextResponse.json({ events: rows, stats: stats[0] });
}
