// AuthHub client for the Next.js app: verifies the signed token issued by the central AuthHub service.
// No password handling and no shared secret here, only AuthHub's PUBLIC keys are used to check signatures.
//   AUTHHUB_URL     where AuthHub runs, as the BROWSER reaches it (default http://localhost:4500)
//   AUTHHUB_INTERNAL_URL  how this server reaches AuthHub to fetch public keys, if different (e.g. inside Docker)
//   AUTHHUB_APP     this app's slug as registered in AuthHub
//   AUTH_REQUIRED   "true" to enforce sign-in (off by default so existing behaviour is unchanged)
import { createRemoteJWKSet, jwtVerify } from "jose";

const HUB = (process.env.AUTHHUB_URL || "http://localhost:4500").replace(/\/$/, "");
const HUB_INTERNAL = (process.env.AUTHHUB_INTERNAL_URL || HUB).replace(/\/$/, "");
const APP = process.env.AUTHHUB_APP || "nextjs";
export const COOKIE = "ah_token";
// Sign-in is ON by default. Set AUTH_REQUIRED=false only for local tests or load tests that call the API without a login.
export const authRequired = () => process.env.AUTH_REQUIRED !== "false";

let jwks;
const keys = () => (jwks ??= createRemoteJWKSet(new URL(`${HUB_INTERNAL}/.well-known/jwks.json`), { cooldownDuration: 30_000, cacheMaxAge: 600_000 }));

// Result: { ok: true, user } or { ok: false, reason: "missing" | "expired" | "invalid" | "no_access" | "hub_unavailable" }
export async function authenticate(authorizationHeader, cookieValue) {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : cookieValue;
  if (!token) return { ok: false, reason: "missing" };
  try {
    const { payload } = await jwtVerify(token, keys(), { issuer: "authhub", audience: APP, algorithms: ["RS256"] });
    const appRole = (payload.apps || {})[APP] || "member";
    return { ok: true, user: { id: payload.sub, email: payload.email, name: payload.name, hubRole: payload.role, appRole } };
  } catch (e) {
    if (e.code === "ERR_JWT_EXPIRED") return { ok: false, reason: "expired" };
    if (e.code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && e.claim === "aud") return { ok: false, reason: "no_access" };
    if (/^ERR_(JWT|JWS|JWK_|JWKS_NO_MATCHING|JWKS_MULTIPLE|JOSE_ALG_NOT_ALLOWED|JOSE_NOT_SUPPORTED)/.test(e.code || "")) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "hub_unavailable" };
  }
}

export const loginUrl = (returnTo) => `${HUB}/sso/authorize?app=${encodeURIComponent(APP)}&return=${encodeURIComponent(returnTo)}`;
export const logoutUrl = (returnTo) => `${HUB}/sso/logout?return=${encodeURIComponent(returnTo)}`;
export const hubUrl = HUB;

export const MESSAGES = {
  missing: "Sign in required", expired: "Your session expired", invalid: "Invalid sign-in token",
  no_access: "Your account does not have access to this app", hub_unavailable: "The sign-in service is unavailable",
};
export const STATUS = { missing: 401, expired: 401, invalid: 401, no_access: 403, hub_unavailable: 503 };
