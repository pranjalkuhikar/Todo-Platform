import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { audit } from "@/lib/audit";
import { findSession, loadAccess, issueAccess } from "@/lib/session";
import { listApps, destination } from "@/lib/redirects";

export const dynamic = "force-dynamic";

// Apps send unauthenticated visitors here:  /sso/authorize?app=<slug>&return=<url>
//  • valid long-lived session  → silently mint a fresh access token and send the user back (single sign-on)
//  • no session                → show the login page
export async function GET(req) {
  const sp = new URL(req.url).searchParams;
  const appSlug = sp.get("app") || null;
  const returnTo = sp.get("return") || null;
  const hub = (path) => new URL(path, config.publicUrl);

  const session = await findSession(req.cookies.get(config.cookies.session)?.value);
  if (!session) {
    const q = new URLSearchParams();
    if (returnTo) q.set("return", returnTo);
    if (appSlug) q.set("app", appSlug);
    return NextResponse.redirect(hub(`/login${q.size ? "?" + q : ""}`));
  }

  const [apps, access] = await Promise.all([listApps(), loadAccess(session.id)]);
  const dest = destination({ returnTo, appSlug, apps, access, defaultApp: session.default_app });
  const denied = dest.startsWith("/forbidden");
  await audit(req, { event: "sso_authorize", success: !denied, userId: session.id, email: session.email, app: appSlug, detail: denied ? "no access to this app" : null });

  const res = NextResponse.redirect(dest.startsWith("/") ? hub(dest) : dest);
  await issueAccess(res, { id: session.id, email: session.email, name: session.name, role: session.role }, session.sid);
  return res;
}
