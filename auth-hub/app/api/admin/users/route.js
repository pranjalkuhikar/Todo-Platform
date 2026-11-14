import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hashPassword, passwordProblem } from "@/lib/password";
import { jsonError } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { requireAdmin, cleanApps, setUserApps, EMAIL_RE, USER_SELECT } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  const { rows } = await query(`${USER_SELECT} GROUP BY u.id ORDER BY u.created_at DESC`);
  return NextResponse.json({ users: rows });
}

export async function POST(req) {
  const { error, admin } = await requireAdmin(req, { write: true });
  if (error) return error;
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase();
  const name = String(b.name || "").trim();
  if (!EMAIL_RE.test(email)) return jsonError(400, "Enter a valid email address", "validation_error");
  if (!name || name.length > 80) return jsonError(400, "Name is required (max 80 characters)", "validation_error");
  const problem = passwordProblem(b.password);
  if (problem) return jsonError(400, problem, "validation_error");
  const role = b.role === "admin" ? "admin" : "user";
  const apps = await cleanApps(b.apps ?? []);
  if (apps.error) return jsonError(400, apps.error, "validation_error");
  let defaultApp = b.default_app || null;
  if (defaultApp && !apps.value.some((a) => a.slug === defaultApp)) return jsonError(400, "The default app must be one of the user's apps", "validation_error");

  try {
    const { rows } = await query("INSERT INTO users (email, name, password_hash, role, default_app) VALUES ($1,$2,$3,$4,$5) RETURNING id", [email, name, await hashPassword(b.password), role, defaultApp]);
    await setUserApps(rows[0].id, apps.value);
    await audit(req, { event: "user_created", userId: rows[0].id, email, detail: `by ${admin.email}; apps: ${apps.value.map((a) => a.slug).join(",") || "none"}` });
    return NextResponse.json({ id: rows[0].id }, { status: 201 });
  } catch (e) {
    if (e.code === "23505") return jsonError(409, "A user with this email already exists", "email_taken");
    throw e;
  }
}
