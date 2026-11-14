// AuthHub client for CommonJS apps. Verifies the signed token issued by the central AuthHub service.
//
// The app never sees passwords and holds no secret: it downloads AuthHub's PUBLIC keys and checks signatures.
//   AUTHHUB_URL     where AuthHub runs, as the BROWSER reaches it (default http://localhost:4500)
//   AUTHHUB_INTERNAL_URL  how this server reaches AuthHub to fetch public keys, if different (e.g. inside Docker)
//   AUTHHUB_APP     this app's slug as registered in AuthHub
//   AUTH_REQUIRED   "true" to enforce sign-in (off by default so existing behaviour is unchanged)
const HUB = (process.env.AUTHHUB_URL || "http://localhost:4500").replace(/\/$/, "");
const HUB_INTERNAL = (process.env.AUTHHUB_INTERNAL_URL || HUB).replace(/\/$/, "");
const APP = process.env.AUTHHUB_APP || "node";
const COOKIE = "ah_token";

let jose, jwks;
async function init() {
  jose ??= await import("jose"); // jose is ESM-only, so it is loaded dynamically from CommonJS
  jwks ??= jose.createRemoteJWKSet(new URL(`${HUB_INTERNAL}/.well-known/jwks.json`), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Result: { ok: true, user } or { ok: false, reason: "missing" | "expired" | "invalid" | "no_access" | "hub_unavailable" }
async function authenticate(authorizationHeader, cookieHeaderOrValue) {
  const bearer = authorizationHeader && authorizationHeader.startsWith("Bearer ") ? authorizationHeader.slice(7) : null;
  const cookie = cookieHeaderOrValue && cookieHeaderOrValue.includes("=") ? parseCookies(cookieHeaderOrValue)[COOKIE] : cookieHeaderOrValue;
  const token = bearer || cookie;
  if (!token) return { ok: false, reason: "missing" };
  try {
    await init();
    const { payload } = await jose.jwtVerify(token, jwks, { issuer: "authhub", audience: APP, algorithms: ["RS256"] });
    const appRole = (payload.apps || {})[APP] || "member";
    return { ok: true, user: { sub: payload.sub, id: payload.sub, email: payload.email, name: payload.name, hubRole: payload.role, appRole, role: appRole === "admin" ? "admin" : "user" } };
  } catch (e) {
    if (e.code === "ERR_JWT_EXPIRED") return { ok: false, reason: "expired" };
    if (e.code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && e.claim === "aud") return { ok: false, reason: "no_access" }; // valid token, but not for this app
    if (/^ERR_(JWT|JWS|JWK_|JWKS_NO_MATCHING|JWKS_MULTIPLE|JOSE_ALG_NOT_ALLOWED|JOSE_NOT_SUPPORTED)/.test(e.code || "")) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "hub_unavailable" }; // could not fetch the public keys
  }
}

const loginUrl = (returnTo) => `${HUB}/sso/authorize?app=${encodeURIComponent(APP)}&return=${encodeURIComponent(returnTo || "")}`;
const logoutUrl = (returnTo) => `${HUB}/sso/logout${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ""}`;

const MESSAGES = {
  missing: "Sign in required", expired: "Your session expired", invalid: "Invalid sign-in token",
  no_access: "Your account does not have access to this app", hub_unavailable: "The sign-in service is unavailable",
};
const STATUS = { missing: 401, expired: 401, invalid: 401, no_access: 403, hub_unavailable: 503 };

module.exports = {
  enabled: process.env.AUTH_REQUIRED !== "false", // ON by default; AUTH_REQUIRED=false only for local tests / load tests hub: HUB, app: APP, cookieName: COOKIE,
  authenticate, loginUrl, logoutUrl, parseCookies, MESSAGES, STATUS,
};
