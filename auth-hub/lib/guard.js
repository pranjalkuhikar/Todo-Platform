import { NextResponse } from "next/server";

export const jsonError = (status, error, code) => NextResponse.json({ error, code }, { status });

// CSRF defence for state-changing requests: a browser must send an Origin that matches this host.
// (Cookies are also SameSite=Lax.) Non-browser clients send no Origin and are not a CSRF vector.
export function originOk(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
}
