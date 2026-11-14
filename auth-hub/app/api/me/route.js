import { NextResponse } from "next/server";
import { jsonError } from "@/lib/guard";
import { userFromRequest, loadAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const cu = await userFromRequest(req);
  if (!cu) return jsonError(401, "Not signed in", "unauthenticated");
  const access = await loadAccess(cu.user.id);
  const { id, email, name, role, default_app } = cu.user;
  return NextResponse.json({ user: { id, email, name, role, default_app }, apps: access.list });
}
