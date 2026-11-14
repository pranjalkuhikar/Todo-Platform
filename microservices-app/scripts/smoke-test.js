// End-to-end checks against a running stack.   node scripts/smoke-test.js
// Needs AuthHub running (sign-in is done there) and the demo users:  cd auth-hub && npm run seed:demo
//   BASE=http://localhost:8080  HUB=http://localhost:4500  USER_EMAIL=carol@demo.test  PASSWORD='Demo-Pass-1234!'
//   NO_ACCESS_USER=alice@demo.test   (has an AuthHub account but NO access to this app)
//   SECOND_USER=...                  (optional: another user WITH access, enables the "users can't see each other's todos" check)
const BASE = process.env.BASE || "http://localhost:8080";
const HUB = process.env.HUB || "http://localhost:4500";
const USER = process.env.USER_EMAIL || "carol@demo.test";
const NO_ACCESS = process.env.NO_ACCESS_USER || "alice@demo.test";
const SECOND = process.env.SECOND_USER || "";
const PASSWORD = process.env.PASSWORD || "Demo-Pass-1234!";
const DIRECT_TODO = process.env.TODO_DIRECT || "http://localhost:4002";
let passed = 0, failed = 0;

function check(name, cond, extra) {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra?.status ? { status: extra.status, body: extra.json } : extra)); }
}
async function call(method, path, { body, token, headers = {}, base = BASE } = {}) {
  const res = await fetch(base + path, {
    method, redirect: "manual",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, headers: res.headers };
}
// Sign in at AuthHub like a browser would, and pick the access token out of the cookie it sets.
async function hubToken(email, app) {
  const res = await fetch(`${HUB}/sso/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: HUB }, body: JSON.stringify({ email, password: PASSWORD, app }) });
  if (!res.ok) throw new Error(`AuthHub sign-in failed for ${email} (${res.status}). Is AuthHub running and seeded (npm run seed:demo)?`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  const c = cookies.find((x) => x.startsWith("ah_token="));
  if (!c) throw new Error("AuthHub did not return an ah_token cookie");
  return c.split(";")[0].slice("ah_token=".length);
}
const section = (s) => console.log(`\n# ${s}`);

(async () => {
  section("gateway basics");
  check("healthz", (await call("GET", "/healthz")).status === 200);
  const ready = await call("GET", "/readyz");
  check("readyz: AuthHub and todo-service are up", ready.json?.status === "ready", ready);
  let r = await call("GET", "/api/todos");
  check("no token => 401 with a sign-in link", r.status === 401 && r.json.code === "missing" && /sso\/authorize/.test(r.json.login_url), r);
  r = await call("GET", "/api/todos", { token: "garbage" });
  check("bad token => 401", r.status === 401 && r.json.code === "invalid", r);
  r = await call("GET", "/", { headers: { Accept: "text/html" } });
  check("browser page without a token => redirect to AuthHub", r.status === 302 && /sso\/authorize\?app=microservices/.test(r.headers.get("location") || ""), { status: r.status, loc: r.headers.get("location") });
  check("x-request-id header present", !!r.headers.get("x-request-id"));
  check("helmet header present", r.headers.get("x-content-type-options") === "nosniff");
  check("x-powered-by hidden", !r.headers.get("x-powered-by"));

  section("no local login any more");
  r = await call("POST", "/api/auth/login", { body: { email: "a@b.co", password: "x" } });
  check("local login is gone (needs a token like any other route)", r.status === 401 || r.status === 404, r);
  r = await call("POST", "/api/auth/register", { body: { email: "a@b.co", password: "x" } });
  check("local register is gone", r.status === 401 || r.status === 404, r);

  section("signed in through AuthHub");
  const token = await hubToken(USER, "microservices");
  r = await call("GET", "/api/auth/me", { token });
  check("/api/auth/me returns the AuthHub user", r.status === 200 && r.json.user.email === USER, r);
  const me = r.json?.user;
  r = await call("GET", "/api/todos", { token });
  check("list todos", r.status === 200 && Array.isArray(r.json.data), r);
  r = await call("POST", "/api/auth/logout", { token });
  check("logout hands back the AuthHub logout URL", r.status === 200 && /sso\/logout/.test(r.json.redirect), r);

  section("a user without access");
  const noAccessToken = await hubToken(NO_ACCESS, "nextjs");
  r = await call("GET", "/api/todos", { token: noAccessToken });
  check("token for another app => 403 no_access", r.status === 403 && r.json.code === "no_access", r);

  section("forged tokens");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const forged = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: "authhub", aud: "microservices", sub: "00000000-0000-0000-0000-000000000000", exp: 4102444800 })}.AAAA`;
  r = await call("GET", "/api/todos", { token: forged });
  check("forged signature rejected", r.status === 401, r);
  const none = `${b64({ alg: "none" })}.${b64({ iss: "authhub", aud: "microservices", sub: "x" })}.`;
  r = await call("GET", "/api/todos", { token: none });
  check("alg=none rejected", r.status === 401, r);

  section("todo CRUD");
  const title = "smoke " + Date.now().toString(36);
  r = await call("POST", "/api/todos", { token, body: { title, description: "from smoke test" } });
  check("create", r.status === 201 && r.json.title === title, r);
  const id = r.json?.id;
  check("todo is owned by the AuthHub user id", r.json?.user_id === me?.id, r.json);
  r = await call("POST", "/api/todos", { token, body: { title: "   " } });
  check("empty title => 400", r.status === 400, r);
  r = await call("POST", "/api/todos", { token, body: { title: "x".repeat(201) } });
  check("201-char title => 400", r.status === 400, r);
  r = await call("PATCH", `/api/todos/${id}`, { token, body: { done: true } });
  check("update", r.status === 200 && r.json.done === true, r);
  r = await call("GET", `/api/todos/${id}`, { token });
  check("read one", r.status === 200 && r.json.done === true, r);
  r = await call("GET", "/api/todos/not-a-uuid", { token });
  check("bad id => 400", r.status === 400, r);
  r = await call("GET", `/api/todos?q=${encodeURIComponent(title)}`, { token });
  check("search finds it", r.status === 200 && r.json.total >= 1, r);

  section("identity cannot be spoofed");
  r = await call("POST", "/api/todos", { token, headers: { "x-user-id": "11111111-1111-1111-1111-111111111111", "x-internal-token": "guess" }, body: { title: "spoof " + title } });
  check("x-user-id from the client is ignored", r.status === 201 && r.json.user_id === me?.id, r);
  const spoofId = r.json?.id;
  r = await call("GET", "/api/todos", { base: DIRECT_TODO, headers: { "x-user-id": me?.id || "x" } });
  check("todo-service refuses calls that skip the gateway", r.status === 401 && r.json?.code === "internal_only", r);

  section("CSRF origin check");
  r = await call("POST", "/api/todos", { token, headers: { Origin: "http://evil.example" }, body: { title: "csrf" } });
  check("foreign Origin on a write => 403", r.status === 403 && r.json.code === "bad_origin", r);

  if (SECOND) {
    section("users are isolated");
    const t2 = await hubToken(SECOND, "microservices");
    r = await call("GET", `/api/todos/${id}`, { token: t2 });
    check("another user cannot read my todo (404)", r.status === 404, r);
    r = await call("DELETE", `/api/todos/${id}`, { token: t2 });
    check("another user cannot delete my todo (404)", r.status === 404, r);
  }

  section("cleanup");
  for (const t of [id, spoofId]) if (t) { r = await call("DELETE", `/api/todos/${t}`, { token }); check(`delete ${String(t).slice(0, 8)}`, r.status === 204, r); }
  r = await call("GET", `/api/todos/${id}`, { token });
  check("deleted todo is gone (404)", r.status === 404, r);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
