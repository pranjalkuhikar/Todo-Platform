// The access token: a short-lived signed JWT that says who the user is and which apps they may use.
import crypto from "node:crypto";
import { SignJWT, jwtVerify, createLocalJWKSet } from "jose";
import { config } from "./config.js";
import { getKeys } from "./keys.js";

// `apps` is { slug: "member" | "admin" }. The token's audience lists every app the user can open,
// so each app can simply require that its own slug is in the audience.
export async function mintAccessToken(user, apps, sessionId) {
  const { kid, privateKey } = await getKeys();
  return new SignJWT({ email: user.email, name: user.name, role: user.role, apps, sid: sessionId })
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .setIssuer(config.issuer)
    .setSubject(user.id)
    .setAudience(["authhub", ...Object.keys(apps)])
    .setIssuedAt()
    .setExpirationTime(`${config.accessTtlSeconds}s`)
    .setJti(crypto.randomUUID())
    .sign(privateKey);
}

export async function verifyAccessToken(token, audience = "authhub") {
  const { publicKeys } = await getKeys();
  const { payload } = await jwtVerify(token, createLocalJWKSet({ keys: publicKeys }), { issuer: config.issuer, audience, algorithms: ["RS256"] });
  return payload;
}
