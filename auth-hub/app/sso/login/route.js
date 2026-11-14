import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { verifyPassword, DUMMY_HASH } from "@/lib/password";
import { audit, clientIp } from "@/lib/audit";
import { limited } from "@/lib/ratelimit";
import { jsonError, originOk } from "@/lib/guard";
import { createSession, loadAccess, issueAccess, setSessionCookie } from "@/lib/session";
import { listApps, destination } from "@/lib/redirects";

export const dynamic = "force-dynamic";

export async function POST(req) {
  if (!originOk(req)) return jsonError(403, "Origin not allowed", "bad_origin");
  const ip = clientIp(req);
  if (limited(`login:${ip}`, 20, 60_000)) return jsonError(429, "Too many attempts from this address. Slow down.", "rate_limited");

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return jsonError(400, "Email and password are required", "validation_error");

  // brute-force protection: too many recent failures for this email → refuse, even for the right password
  const { rows: fails } = await query(
    "SELECT count(*)::int AS n FROM audit_events WHERE event = 'login' AND NOT success AND email = $1 AND at > now() - make_interval(mins => $2)",
    [email, config.lockout.windowMinutes]);
  if (fails[0].n >= config.lockout.maxFailures) {
    await audit(req, { event: "login", success: false, email, detail: "locked out" });
    return jsonError(429, `Too many failed attempts. Try again in ${config.lockout.windowMinutes} minutes.`, "locked");
  }

  const { rows } = await query("SELECT * FROM users WHERE email = $1", [email]);
  const user = rows[0];
  const valid = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH); // same work whether or not the user exists
  if (!user || !valid || user.disabled) {
    await audit(req, { event: "login", success: false, userId: user?.id ?? null, email, detail: !user ? "unknown email" : user.disabled && valid ? "account disabled" : "wrong password" });
    return jsonError(401, "Invalid email or password", "invalid_credentials"); // never reveal which part was wrong
  }

  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
  const session = await createSession(user.id, ip, req.headers.get("user-agent"));
  const [apps, access] = await Promise.all([listApps(), loadAccess(user.id)]);
  const redirect = destination({ returnTo: body.return || null, appSlug: body.app || null, apps, access, defaultApp: user.default_app });
  await audit(req, { event: "login", success: true, userId: user.id, email, app: body.app || null });

  const res = NextResponse.json({ ok: true, redirect, user: { id: user.id, email: user.email, name: user.name, role: user.role }, apps: access.list.map((a) => a.slug) });
  setSessionCookie(res, session.token);
  await issueAccess(res, user, session.id);
  return res;
}
