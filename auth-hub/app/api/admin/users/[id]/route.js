import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hashPassword, passwordProblem } from "@/lib/password";
import { jsonError } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { revokeUserSessions } from "@/lib/session";
import { requireAdmin, cleanApps, setUserApps } from "@/lib/admin";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

export async function PATCH(req, { params }) {
  const { error, admin } = await requireAdmin(req, { write: true });
  if (error) return error;
  const { id } = await params;
  if (!UUID.test(id)) return jsonError(404, "User not found", "not_found");
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [id]);
  const user = rows[0];
  if (!user) return jsonError(404, "User not found", "not_found");
  const b = await req.json().catch(() => ({}));
  const self = id === admin.id;

  // don't let an admin lock themselves out
  if (self && (b.disabled === true || b.role === "user")) return jsonError(400, "You can't disable or demote your own account", "self_lockout");

  const sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  const changes = [];

  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name || name.length > 80) return jsonError(400, "Name is required (max 80 characters)", "validation_error");
    add("name", name); changes.push("name");
  }
  if (b.role !== undefined) { if (!["admin", "user"].includes(b.role)) return jsonError(400, "Invalid role", "validation_error"); add("role", b.role); changes.push(`role=${b.role}`); }
  if (b.disabled !== undefined) { add("disabled", !!b.disabled); changes.push(b.disabled ? "disabled" : "enabled"); }

  const apps = await cleanApps(b.apps);
  if (apps.error) return jsonError(400, apps.error, "validation_error");
  const finalApps = apps.value ?? (await query("SELECT app_slug AS slug FROM user_apps WHERE user_id = $1", [id])).rows;
  if (b.default_app !== undefined || apps.value !== undefined) {
    let def = b.default_app !== undefined ? b.default_app || null : user.default_app;
    if (def && !finalApps.some((a) => a.slug === def)) def = null; // the default app must stay one of the user's apps
    add("default_app", def);
  }
  if (b.password !== undefined && b.password !== "") {
    const problem = passwordProblem(b.password);
    if (problem) return jsonError(400, problem, "validation_error");
    add("password_hash", await hashPassword(b.password)); changes.push("password reset");
  }

  if (sets.length) { vals.push(id); await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals); }
  if (apps.value !== undefined) { await setUserApps(id, apps.value); changes.push(`apps=${apps.value.map((a) => `${a.slug}:${a.role}`).join(",") || "none"}`); }

  // Disabling, resetting a password, or an explicit request signs the user out everywhere.
  if (b.disabled === true || (b.password !== undefined && b.password !== "") || b.revokeSessions === true) { await revokeUserSessions(id); changes.push("sessions revoked"); }
  await audit(req, { event: "user_updated", userId: id, email: user.email, detail: `by ${admin.email}: ${changes.join("; ") || "no change"}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const { error, admin } = await requireAdmin(req, { write: true });
  if (error) return error;
  const { id } = await params;
  if (!UUID.test(id)) return jsonError(404, "User not found", "not_found");
  if (id === admin.id) return jsonError(400, "You can't delete your own account", "self_lockout");
  const { rows } = await query("DELETE FROM users WHERE id = $1 RETURNING email", [id]);
  if (!rows[0]) return jsonError(404, "User not found", "not_found");
  await audit(req, { event: "user_deleted", email: rows[0].email, detail: `by ${admin.email}` });
  return NextResponse.json({ ok: true });
}
