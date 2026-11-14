import { NextResponse } from "next/server";
import { jsonError, originOk } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { userFromRequest, revokeUserSessions, clearCookies } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req) {
  if (!originOk(req)) return jsonError(403, "Origin not allowed", "bad_origin");
  const cu = await userFromRequest(req);
  if (!cu) return jsonError(401, "Not signed in", "unauthenticated");
  await revokeUserSessions(cu.user.id);
  await audit(req, { event: "signout_all", userId: cu.user.id, email: cu.user.email });
  const res = NextResponse.json({ ok: true });
  clearCookies(res);
  return res;
}
