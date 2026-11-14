import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hashPassword, verifyPassword, passwordProblem } from "@/lib/password";
import { jsonError, originOk } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { userFromRequest, revokeUserSessions } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req) {
  if (!originOk(req)) return jsonError(403, "Origin not allowed", "bad_origin");
  const cu = await userFromRequest(req);
  if (!cu) return jsonError(401, "Not signed in", "unauthenticated");
  const b = await req.json().catch(() => ({}));
  const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [cu.user.id]);
  if (!(await verifyPassword(String(b.current || ""), rows[0].password_hash))) {
    await audit(req, { event: "password_change", success: false, userId: cu.user.id, email: cu.user.email, detail: "wrong current password" });
    return jsonError(400, "Your current password is incorrect", "invalid_credentials");
  }
  const problem = passwordProblem(b.next);
  if (problem) return jsonError(400, problem, "validation_error");
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [await hashPassword(b.next), cu.user.id]);
  await revokeUserSessions(cu.user.id, cu.claims.sid || null); // sign out every other device, keep this one
  await audit(req, { event: "password_change", userId: cu.user.id, email: cu.user.email });
  return NextResponse.json({ ok: true });
}
