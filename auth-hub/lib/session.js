// Sessions (the long-lived "remember me" part), access cookies, and "who is calling" helpers.
import crypto from "node:crypto";
import { config } from "./config.js";
import { query } from "./db.js";
import { mintAccessToken, verifyAccessToken } from "./tokens.js";

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// ---- apps a user may open ----
export async function loadAccess(userId) {
  const { rows } = await query(
    `SELECT a.slug, a.name, a.description, a.url, a.icon, ua.app_role
       FROM user_apps ua JOIN apps a ON a.slug = ua.app_slug WHERE ua.user_id = $1 ORDER BY a.name`, [userId]);
  return { list: rows, map: Object.fromEntries(rows.map((r) => [r.slug, r.app_role])) };
}

// ---- sessions ----
export async function createSession(userId, ip, userAgent) {
  const token = crypto.randomBytes(32).toString("base64url");
  const { rows } = await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4, $5) RETURNING id`,
    [userId, sha256(token), config.sessionIdleDays, ip, (userAgent || "").slice(0, 300)]);
  return { token, id: rows[0].id };
}

// Valid = not revoked, not expired, not older than the absolute maximum, and the user is still enabled.
// Using a session slides its idle expiry forward.
export async function findSession(token) {
  if (!token) return null;
  const { rows } = await query(
    `SELECT s.id AS sid, u.id, u.email, u.name, u.role, u.default_app
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND NOT s.revoked AND s.expires_at > now()
        AND s.created_at > now() - make_interval(days => $2) AND NOT u.disabled`, [sha256(token), config.sessionMaxDays]);
  if (!rows[0]) return null;
  await query("UPDATE sessions SET last_used_at = now(), expires_at = LEAST(now() + make_interval(days => $2), created_at + make_interval(days => $3)) WHERE id = $1",
    [rows[0].sid, config.sessionIdleDays, config.sessionMaxDays]);
  return rows[0];
}

export const revokeSession = (token) => token ? query("UPDATE sessions SET revoked = true WHERE token_hash = $1", [sha256(token)]) : null;
export const revokeUserSessions = (userId, exceptId = null) =>
  query("UPDATE sessions SET revoked = true WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)", [userId, exceptId]);

// ---- cookies ----
const base = { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, ...(config.cookieDomain ? { domain: config.cookieDomain } : {}) };

// The access token is readable by every app (path "/"). The long-lived session token is only ever sent to
// this hub's /sso/* endpoints (path "/sso"), so the other apps on the same host can never see or steal it.
export function setAccessCookie(res, token) {
  res.cookies.set(config.cookies.access, token, { ...base, path: "/", maxAge: config.accessTtlSeconds });
}
export function setSessionCookie(res, token) {
  res.cookies.set(config.cookies.session, token, { ...base, path: "/sso", maxAge: config.sessionMaxDays * 86400 });
}
export function clearCookies(res) {
  res.cookies.set(config.cookies.access, "", { ...base, path: "/", maxAge: 0 });
  res.cookies.set(config.cookies.session, "", { ...base, path: "/sso", maxAge: 0 });
}

// Mint a fresh access token + set it, for a user we already authenticated.
export async function issueAccess(res, user, sessionId) {
  const access = await loadAccess(user.id);
  setAccessCookie(res, await mintAccessToken(user, access.map, sessionId));
  return access;
}

// ---- who is calling (hub's own pages and APIs) ----
export async function userFromToken(token) {
  if (!token) return null;
  let claims;
  try { claims = await verifyAccessToken(token); } catch { return null; }
  const { rows } = await query("SELECT id, email, name, role, default_app, disabled FROM users WHERE id = $1", [claims.sub]);
  if (!rows[0] || rows[0].disabled) return null; // disabled users lose hub access immediately
  return { user: rows[0], claims };
}
export function userFromRequest(req) {
  const h = req.headers.get("authorization");
  return userFromToken(req.cookies.get(config.cookies.access)?.value || (h?.startsWith("Bearer ") ? h.slice(7) : null));
}
