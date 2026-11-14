import { db, query } from "./db.js";
import { jsonError, originOk } from "./guard.js";
import { userFromRequest } from "./session.js";

// Gate for every /api/admin/* route. Returns { admin } on success or { error: Response }.
export async function requireAdmin(req, { write = false } = {}) {
  if (write && !originOk(req)) return { error: jsonError(403, "Origin not allowed", "bad_origin") };
  const cu = await userFromRequest(req);
  if (!cu) return { error: jsonError(401, "Not signed in", "unauthenticated") };
  if (cu.user.role !== "admin") return { error: jsonError(403, "Admins only", "forbidden") };
  return { admin: cu.user, claims: cu.claims };
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// Replace the set of apps a user may open (and their role in each) in one transaction.
export async function setUserApps(userId, apps) {
  const pool = await db();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("DELETE FROM user_apps WHERE user_id = $1", [userId]);
    for (const a of apps) await c.query("INSERT INTO user_apps (user_id, app_slug, app_role) VALUES ($1,$2,$3)", [userId, a.slug, a.role === "admin" ? "admin" : "member"]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

// Validate an `apps` array from the client against the registered apps.
export async function cleanApps(input) {
  if (input === undefined) return { value: undefined };
  if (!Array.isArray(input)) return { error: "apps must be a list" };
  const { rows } = await query("SELECT slug FROM apps");
  const known = new Set(rows.map((r) => r.slug));
  const seen = new Set(), out = [];
  for (const a of input) {
    if (!a || !known.has(a.slug)) return { error: `Unknown app "${a?.slug}"` };
    if (seen.has(a.slug)) continue;
    seen.add(a.slug);
    out.push({ slug: a.slug, role: a.role === "admin" ? "admin" : "member" });
  }
  return { value: out };
}

export const USER_SELECT = `
  SELECT u.id, u.email, u.name, u.role, u.default_app, u.disabled, u.created_at, u.last_login_at,
         COALESCE(json_agg(json_build_object('slug', ua.app_slug, 'role', ua.app_role) ORDER BY ua.app_slug)
                  FILTER (WHERE ua.app_slug IS NOT NULL), '[]') AS apps
    FROM users u LEFT JOIN user_apps ua ON ua.user_id = u.id`;

export function cleanApp(b, { slugRequired }) {
  const slug = String(b.slug || "").trim().toLowerCase();
  if (slugRequired && !/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) return { error: "Slug: 2–31 characters, lowercase letters, digits and dashes" };
  const name = String(b.name ?? "").trim();
  if (b.name !== undefined && (!name || name.length > 60)) return { error: "Name is required (max 60 characters)" };
  let url;
  if (b.url !== undefined) {
    try { const u = new URL(String(b.url)); if (!/^https?:$/.test(u.protocol)) throw 0; url = u.origin + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")); }
    catch { return { error: "URL must be a valid http(s) address, e.g. http://localhost:3000" }; }
  }
  return { slug, name, url, description: String(b.description ?? "").slice(0, 200), icon: String(b.icon ?? "").slice(0, 4) || "◆" };
}
