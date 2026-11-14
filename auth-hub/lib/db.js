// Postgres access. The database itself is created automatically, tables are created on first use,
// and the registered apps + first admin are seeded when the tables are empty.
import crypto from "node:crypto";
import pg from "pg";
import { config, seedApps } from "./config.js";
import { hashPassword } from "./password.js";

const g = globalThis;
g.__authhub ??= {};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  default_app   TEXT,
  disabled      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS apps (
  slug        TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '◆',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_apps (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_slug TEXT NOT NULL REFERENCES apps(slug) ON DELETE CASCADE ON UPDATE CASCADE,
  app_role TEXT NOT NULL DEFAULT 'member' CHECK (app_role IN ('member','admin')),
  PRIMARY KEY (user_id, app_slug)
);
CREATE TABLE IF NOT EXISTS sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked      BOOLEAN NOT NULL DEFAULT false,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE TABLE IF NOT EXISTS signing_keys (
  kid        TEXT PRIMARY KEY,
  private_pem TEXT NOT NULL,
  public_jwk JSONB NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_events (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  event      TEXT NOT NULL,
  success    BOOLEAN NOT NULL DEFAULT true,
  user_id    UUID,
  email      TEXT,
  app        TEXT,
  ip         TEXT,
  user_agent TEXT,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_events (at DESC);
CREATE INDEX IF NOT EXISTS audit_email_idx ON audit_events (email, at DESC);
`;

async function ensureDatabase() {
  const url = new URL(config.databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error("DATABASE_URL has an unexpected database name");
  const probe = new pg.Client({ connectionString: config.databaseUrl });
  try {
    await probe.connect();
    await probe.end();
    return;
  } catch (err) {
    await probe.end().catch(() => {});
    if (err.code !== "3D000") throw err; // anything except "database does not exist"
  }
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${name}"`); } catch (e) { if (e.code !== "42P04") throw e; } finally { await admin.end(); }
  console.log(`[authhub] created database "${name}"`);
}

async function seed(pool) {
  const { rows: apps } = await pool.query("SELECT count(*)::int AS n FROM apps");
  if (apps[0].n === 0) {
    for (const a of seedApps) await pool.query("INSERT INTO apps (slug, name, description, url, icon) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [a.slug, a.name, a.description, a.url, a.icon]);
    console.log("[authhub] registered apps:", seedApps.map((a) => a.slug).join(", "));
  }
  const { rows: users } = await pool.query("SELECT count(*)::int AS n FROM users");
  if (users[0].n === 0) {
    const email = (process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
    let password = process.env.ADMIN_PASSWORD;
    const generated = !password;
    if (generated) password = crypto.randomBytes(12).toString("base64url");
    const { rows } = await pool.query("INSERT INTO users (email, name, password_hash, role) VALUES ($1,'Administrator',$2,'admin') RETURNING id", [email, await hashPassword(password)]);
    await pool.query("INSERT INTO user_apps (user_id, app_slug, app_role) SELECT $1, slug, 'admin' FROM apps", [rows[0].id]);
    console.log(`\n[authhub] first admin created: ${email}${generated ? `\n[authhub] generated password (shown once): ${password}` : ""}\n`);
  }
}

async function init() {
  await ensureDatabase();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  await pool.query(SCHEMA);
  await seed(pool);
  g.__authhub.pool = pool;
  return pool;
}

export function db() {
  g.__authhub.ready ??= init().catch((e) => { g.__authhub.ready = undefined; throw e; }); // retry on next call if Postgres was down
  return g.__authhub.ready;
}
export async function query(text, params) {
  return (await db()).query(text, params);
}
