// Runs before every request (Next.js 16 "proxy", formerly "middleware").
// Sign-in is on by default (AUTH_REQUIRED=false switches it off). It only lets signed-in users with access to THIS app through:
//   • API calls without a valid token → 401/403 JSON
//   • page visits without one         → redirect to AuthHub, which signs them in (or silently renews) and sends them back
import { NextResponse } from "next/server";
import { authenticate, authRequired, loginUrl, COOKIE, MESSAGES, STATUS } from "@/lib/authhub";

export async function proxy(request) {
  if (!authRequired()) return NextResponse.next(); // sign-in not enforced: behave exactly as before

  const r = await authenticate(request.headers.get("authorization"), request.cookies.get(COOKIE)?.value);
  if (r.ok) {
    // pass the verified identity to the page and API routes; overwrite anything the client tried to send
    const headers = new Headers(request.headers);
    headers.set("x-user-id", r.user.id);
    headers.set("x-user-email", r.user.email || "");
    headers.set("x-user-name", r.user.name || "");
    headers.set("x-user-role", r.user.appRole);
    headers.set("x-hub-role", r.user.hubRole || "");
    return NextResponse.next({ request: { headers } });
  }

  const here = request.nextUrl.href;
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: MESSAGES[r.reason], code: r.reason, login_url: loginUrl(here) }, { status: STATUS[r.reason] });
  }
  if (r.reason === "hub_unavailable") return new NextResponse("The sign-in service is unavailable. Try again shortly.", { status: 503 });
  return NextResponse.redirect(loginUrl(here)); // expired → silent renewal; no access → AuthHub explains
}

// everything except Next's static assets and the health/metrics endpoints monitoring needs
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/metrics).*)"] };
