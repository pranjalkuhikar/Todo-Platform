import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { audit } from "@/lib/audit";
import { findSession, revokeSession, clearCookies } from "@/lib/session";
import { listApps, safeReturn } from "@/lib/redirects";

export const dynamic = "force-dynamic";

async function endSession(req) {
  const token = req.cookies.get(config.cookies.session)?.value;
  const s = await findSession(token);
  await revokeSession(token); // revoked on the server, so the long-lived session is dead everywhere
  if (s) await audit(req, { event: "logout", userId: s.id, email: s.email });
}

// Apps link here to sign the user out of everything: /sso/logout?return=<url>
export async function GET(req) {
  await endSession(req);
  const ret = safeReturn(new URL(req.url).searchParams.get("return"), await listApps(), null);
  const res = NextResponse.redirect(new URL(ret && !ret.startsWith("/login") ? ret : "/login", config.publicUrl));
  clearCookies(res);
  return res;
}

export async function POST(req) {
  await endSession(req);
  const res = NextResponse.json({ ok: true, login_url: `${config.publicUrl}/login` });
  clearCookies(res);
  return res;
}
