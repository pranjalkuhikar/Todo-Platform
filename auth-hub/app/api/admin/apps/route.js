import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { requireAdmin, cleanApp } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  const { rows } = await query("SELECT a.*, (SELECT count(*)::int FROM user_apps ua WHERE ua.app_slug = a.slug) AS users FROM apps a ORDER BY a.name");
  return NextResponse.json({ apps: rows });
}

export async function POST(req) {
  const { error, admin } = await requireAdmin(req, { write: true });
  if (error) return error;
  const a = cleanApp(await req.json().catch(() => ({})), { slugRequired: true });
  if (a.error) return jsonError(400, a.error, "validation_error");
  if (!a.name || !a.url) return jsonError(400, "Name and URL are required", "validation_error");
  try {
    await query("INSERT INTO apps (slug, name, description, url, icon) VALUES ($1,$2,$3,$4,$5)", [a.slug, a.name, a.description, a.url, a.icon]);
  } catch (e) { if (e.code === "23505") return jsonError(409, "An app with this slug already exists", "slug_taken"); throw e; }
  await audit(req, { event: "app_created", app: a.slug, detail: `by ${admin.email}` });
  return NextResponse.json({ ok: true }, { status: 201 });
}
