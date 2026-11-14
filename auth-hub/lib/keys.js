// RS256 signing keys. The private key stays in this service; apps only ever see the public keys (JWKS).
import { generateKeyPair, exportPKCS8, exportJWK, importPKCS8, calculateJwkThumbprint } from "jose";
import { query } from "./db.js";

const g = globalThis;
g.__authhub ??= {};

async function load() {
  const { rows } = await query("SELECT kid, private_pem, public_jwk, active FROM signing_keys ORDER BY created_at DESC");
  if (rows.length === 0) {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
    const jwk = await exportJWK(publicKey);
    const kid = await calculateJwkThumbprint(jwk);
    const pub = { ...jwk, kid, alg: "RS256", use: "sig" };
    await query("INSERT INTO signing_keys (kid, private_pem, public_jwk) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [kid, await exportPKCS8(privateKey), pub]);
    console.log("[authhub] generated a new signing key", kid);
    return load();
  }
  const active = rows.find((r) => r.active) || rows[0];
  return { kid: active.kid, privateKey: await importPKCS8(active.private_pem, "RS256"), publicKeys: rows.map((r) => r.public_jwk) };
}

export function getKeys() {
  g.__authhub.keys ??= load().catch((e) => { g.__authhub.keys = undefined; throw e; });
  return g.__authhub.keys;
}
