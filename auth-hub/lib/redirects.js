// Where may we send a user after login? Only to the hub itself or to a registered app they can access.
// (An open redirect would let an attacker bounce people from the real login page to a phishing site.)
import { query } from "./db.js";
import { config } from "./config.js";

const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };

export async function listApps() {
  return (await query("SELECT slug, name, description, url, icon FROM apps ORDER BY name")).rows;
}

// Returns a safe absolute-or-relative destination, or null if `returnTo` is not allowed.
export function safeReturn(returnTo, apps, accessMap) {
  if (!returnTo || typeof returnTo !== "string" || returnTo.length > 2000) return null;
  if (returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.startsWith("/\\")) return returnTo; // hub-relative
  const origin = originOf(returnTo);
  if (!origin) return null;
  if (origin === originOf(config.publicUrl)) return returnTo;
  const app = apps.find((a) => originOf(a.url) === origin);
  if (!app) return null;
  if (accessMap && !accessMap[app.slug]) return null; // registered app, but this user has no access to it
  return returnTo;
}

export const appForUrl = (apps, url) => apps.find((a) => originOf(a.url) === originOf(url)) || null;

// The routing rule: no access to the requested app → explanation page; explicit return URL → only app →
// default app → launcher page. Returns a path ("/…") or an absolute app URL.
export function destination({ returnTo, appSlug, apps, access, defaultApp }) {
  const target = appSlug ? apps.find((a) => a.slug === appSlug) : returnTo ? appForUrl(apps, returnTo) : null;
  if (target && !access.map[target.slug]) return `/forbidden?app=${encodeURIComponent(target.slug)}`;
  const ok = safeReturn(returnTo, apps, access.map);
  if (ok) return ok;
  if (target) return target.url;
  if (access.list.length === 1) return access.list[0].url;
  const def = access.list.find((a) => a.slug === defaultApp);
  if (def) return def.url;
  return "/";
}
