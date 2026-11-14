// All configuration comes from environment variables and is validated at startup,
// so a misconfigured deployment fails immediately instead of at the first request.
const isProd = process.env.NODE_ENV === "production";

function required(name, { minLength = 1 } = {}) {
  const v = process.env[name];
  if (!v || v.length < minLength) {
    throw new Error(`Missing or too short env var ${name} (min ${minLength} chars)`);
  }
  return v;
}

const int = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number`);
  return n;
};

const list = (name, def) =>
  (process.env[name] ?? def)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const config = {
  isProd,
  port: int("PORT", 8080),
  internalToken: required("INTERNAL_TOKEN", { minLength: 16 }),
  todoUrl: process.env.TODO_SERVICE_URL || "http://localhost:4002",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  // Browser origins allowed to make state-changing requests (CSRF defence in depth).
  allowedOrigins: list("ALLOWED_ORIGINS", "http://localhost:8080,http://localhost:3000"),
  // How many reverse proxies sit in front of the gateway (0 = none). Needed for correct client IPs.
  trustProxy: int("TRUST_PROXY", 0),
  upstreamTimeoutMs: int("UPSTREAM_TIMEOUT_MS", 10000),
  rateLimit: {
    windowMs: int("RATE_LIMIT_WINDOW_MS", 60_000),
    max: int("RATE_LIMIT_MAX", 300), // per IP per window, whole API
  },
  lokiUrl: process.env.LOKI_URL || "",
  publicUrl: (process.env.PUBLIC_URL || "http://localhost:8080").replace(/\/$/, ""),
};

module.exports = config;
