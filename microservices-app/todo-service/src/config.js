const isProd = process.env.NODE_ENV === "production";

function required(name, minLength = 1) {
  const v = process.env[name];
  if (!v || v.length < minLength) throw new Error(`Missing or too short env var ${name} (min ${minLength} chars)`);
  return v;
}
const int = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number`);
  return n;
};

module.exports = {
  isProd,
  port: int("PORT", 4002),
  databaseUrl: process.env.DATABASE_URL || "postgres://app:app@localhost:5433/tododb",
  dbPoolMax: int("DB_POOL_MAX", 10),
  internalToken: required("INTERNAL_TOKEN", 16),
  runMigrations: (process.env.RUN_MIGRATIONS ?? "true") === "true",
};
