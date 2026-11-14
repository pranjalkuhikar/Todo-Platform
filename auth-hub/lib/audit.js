import { query } from "./db.js";

export function clientIp(req) {
  // behind a trusted proxy this header is set by the proxy; locally it is simply absent
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
}

// Every sign-in, denial, and admin change is recorded. A logging failure must never break a request.
export async function audit(req, { event, success = true, userId = null, email = null, app = null, detail = null }) {
  try {
    await query("INSERT INTO audit_events (event, success, user_id, email, app, ip, user_agent, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [
      event, success, userId, email, app, req ? clientIp(req) : null, req ? (req.headers.get("user-agent") || "").slice(0, 300) : null, detail ? String(detail).slice(0, 500) : null,
    ]);
  } catch (e) { console.error("[authhub] audit failed:", e.message); }
}
