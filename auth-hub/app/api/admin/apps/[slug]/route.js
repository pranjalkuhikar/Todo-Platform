import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { requireAdmin, cleanApp } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function PATCH(req, { params }) {
  const { error, admin } = await requireAdmin(req, { write: true });
  if (error) return error;
  const { slug } = await params;
  const b = await req.json().catch(() => ({}));
  const a = cleanApp(b, { slugRequired: false });
  if (a.error) return jsonError(400, a.error, "validation_error");
  const sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (b.name !== undefined) add("name", a.name);
  if (b.url !== undefined) add("url", a.url);
  if (b.description !== undefined) add("description", a.description);
  if (b.icon !== undefined) add("icon", a.icon);
  if (!sets.length) return NextResponse.json({ ok: true });
  vals.push(slug);
  const { rowCount } = await query(`UPDATE apps SET ${sets.join(", ")} WHERE slug = $${vals.length}`, vals);
  if (!rowCount) return jsonError(404, "App not found", "not_found");
  await audit(req, { event: "app_updated", app: slug, detail: `by ${admin.email}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const { error, admin } = await requireAdmin(req, { write: true });
  if (error) return error;
  const { slug } = await params;
  const { rowCount } = await query("DELETE FROM apps WHERE slug = $1", [slug]);
  if (!rowCount) return jsonError(404, "App not found", "not_found");
  await audit(req, { event: "app_deleted", app: slug, detail: `by ${admin.email}` });
  return NextResponse.json({ ok: true });
}
