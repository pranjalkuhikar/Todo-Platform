// Server-component helper: who is looking at this page? Redirects to the SSO endpoint when nobody is,
// which silently renews the access token if the long-lived session is still valid.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "./config.js";
import { userFromToken, loadAccess } from "./session.js";

export async function requireUser(returnPath, { admin = false } = {}) {
  const token = (await cookies()).get(config.cookies.access)?.value;
  const cu = await userFromToken(token);
  if (!cu) redirect(`/sso/authorize?return=${encodeURIComponent(returnPath)}`);
  if (admin && cu.user.role !== "admin") redirect("/forbidden?app=admin");
  return { user: cu.user, access: await loadAccess(cu.user.id) };
}
