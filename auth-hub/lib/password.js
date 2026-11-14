// Password hashing with scrypt (built into Node, no extra dependency). Stored as: scrypt$N$r$p$salt$hash
import crypto from "node:crypto";

const N = 16384, R = 8, P = 1, KEYLEN = 64;
const scrypt = (password, salt, n, r, p, len) =>
  new Promise((resolve, reject) => crypto.scrypt(password, salt, len, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [alg, n, r, p, salt, hash] = String(stored).split("$");
    if (alg !== "scrypt") return false;
    const expected = Buffer.from(hash, "base64");
    const actual = await scrypt(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Used when the email does not exist, so response time doesn't reveal which emails are registered.
export const DUMMY_HASH = await hashPassword("not-a-real-password-just-for-timing");

export function passwordProblem(p) {
  if (typeof p !== "string") return "Password is required";
  if (p.length < 10) return "Password must be at least 10 characters";
  if (p.length > 128) return "Password must be at most 128 characters";
  return null;
}
