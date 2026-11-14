// API gateway: the ONLY public entry point.
//
//   browser ──► gateway :8080 ──┬─ /api/auth/me, /api/auth/logout → answered here (identity comes from AuthHub)
//                               ├─ /api/todos/*      → todo-service  (CRUD)
//                               └─ everything else   → frontend      (Next.js)
//
// There is no login service in this app: sign-in is done by the central AuthHub. The gateway only VERIFIES the
// signed token AuthHub issues (public keys, no shared secret), then tells the backends who is calling through
// trusted headers (x-user-id ...) protected by a shared INTERNAL_TOKEN. Backends are never
// exposed to the internet and reject any request that lacks that token.
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { rateLimit } = require("express-rate-limit");
const { createProxyMiddleware } = require("http-proxy-middleware");

const config = require("./config");
const authhub = require("./authhub");
const { logger, flushLogs } = require("./logger");
const { register, httpRequests, httpDuration, upstreamErrors, authRejections } = require("./metrics");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);

// ---------- request id + never trust identity headers coming from outside ----------
const SPOOFABLE = ["x-user-id", "x-user-email", "x-user-role", "x-internal-token", "x-client-ip"];
app.use((req, res, next) => {
  for (const h of SPOOFABLE) delete req.headers[h];
  const incoming = req.get("x-request-id");
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.headers["x-request-id"] = req.id;
  res.setHeader("x-request-id", req.id);
  next();
});

// ---------- security headers ----------
// CSP is left to the frontend (Next.js needs per-page nonces); everything else is on.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// ---------- which upstream group a request belongs to (bounded label for metrics) ----------
function groupOf(path) {
  if (path.startsWith("/api/auth")) return "auth";
  if (path.startsWith("/api/todos")) return "todos";
  if (path.startsWith("/api")) return "api-unknown";
  if (path === "/healthz" || path === "/readyz") return "health";
  return "frontend";
}

// ---------- access log + metrics ----------
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const sec = Number(process.hrtime.bigint() - start) / 1e9;
    // originalUrl, not req.path: inside a mounted middleware Express strips the mount prefix from req.path
    const fullPath = req.originalUrl.split("?")[0];
    const group = groupOf(fullPath);
    const labels = { method: req.method, route: group, status: res.statusCode };
    httpRequests.inc(labels);
    httpDuration.observe(labels, sec);
    if (fullPath.startsWith("/_next/") || group === "health") return; // too noisy
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]("request", {
      request_id: req.id,
      method: req.method,
      route: group,
      path: fullPath,
      status: res.statusCode,
      duration_ms: Math.round(sec * 1000 * 100) / 100,
      user_id: req.user?.sub ?? "anonymous",
      ip: req.ip,
    });
  });
  next();
});

// ---------- health ----------
app.get("/healthz", (req, res) => res.json({ status: "ok" })); // liveness: process is up

app.get("/readyz", async (req, res) => {
  // readiness: can we reach the services we route to?
  const check = async (name, url) => {
    try {
      const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
      return [name, r.ok ? "up" : `http ${r.status}`];
    } catch {
      return [name, "down"];
    }
  };
  const hub = async () => {
    try {
      const r = await fetch(`${authhub.hubInternal}/.well-known/jwks.json`, { signal: AbortSignal.timeout(2000) });
      return ["authhub", r.ok ? "up" : `http ${r.status}`];
    } catch {
      return ["authhub", "down"];
    }
  };
  const results = Object.fromEntries(await Promise.all([hub(), check("todos", config.todoUrl)]));
  const ok = Object.values(results).every((v) => v === "up");
  res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "degraded", upstreams: results });
});

// ---------- rate limiting ----------
// In-memory store: fine for one gateway instance. Behind several replicas, plug in a shared store (Redis).
const tooMany = (message) => (req, res) =>
  res.status(429).json({ error: message, code: "rate_limited", request_id: req.id });

const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: tooMany("Too many requests, slow down"),
});

app.use("/api", apiLimiter);

// ---------- CSRF defence in depth: browsers must send an allowed Origin on unsafe methods ----------
// (The cookie is also SameSite=Lax; curl/servers send no Origin and are not a CSRF vector.)
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin && !config.allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: "Origin not allowed", code: "bad_origin", request_id: req.id });
  }
  next();
});

// ---------- authentication (central sign-in: AuthHub) ----------
app.use(cookieParser());

// Sign-out must also end the AuthHub session, which only the browser can do, so hand back AuthHub's logout URL.
// (No login/register here: AuthHub owns accounts and passwords.)
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(authhub.cookieName, { path: "/" });
  res.json({ ok: true, redirect: authhub.logoutUrl() });
});
app.use("/api", authenticateHub);
app.get("/api/auth/me", (req, res) =>
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role }, hub_url: req.user.hubRole === "admin" ? authhub.hub : "" }));
app.use(authenticatePage);

// ---------- central sign-in (AuthHub) ----------
// The gateway accepts ONLY AuthHub tokens. Browser page loads without a valid token are sent to AuthHub,
// API calls get a 401/403 JSON with the sign-in URL, and /api/auth/me is answered from the token.
async function authenticateHub(req, res, next) {
  const r = await authhub.authenticate(req.get("authorization"), req.cookies?.[authhub.cookieName]);
  if (r.ok) { req.user = r.user; return next(); }
  authRejections.inc({ reason: r.reason });
  res.status(authhub.STATUS[r.reason]).json({
    error: authhub.MESSAGES[r.reason], code: r.reason, login_url: authhub.loginUrl(config.publicUrl + "/"), request_id: req.id,
  });
}
const PAGE_SKIP = /^\/(_next\/|favicon|healthz|readyz|api\/)/;
function authenticatePage(req, res, next) {
  if (!["GET", "HEAD"].includes(req.method) || PAGE_SKIP.test(req.path) || !(req.get("accept") || "").includes("text/html")) return next();
  authhub.authenticate(req.get("authorization"), req.cookies?.[authhub.cookieName]).then((r) => {
    if (r.ok) { req.user = r.user; return next(); }
    if (r.reason === "hub_unavailable") return res.status(503).type("text").send("The sign-in service is unavailable. Try again shortly.");
    res.redirect(authhub.loginUrl(config.publicUrl + req.originalUrl)); // expired → silent renewal; no access → AuthHub explains
  }, next);
}


// ---------- reverse proxies ----------
function backendProxy(name, target, pathFilter) {
  return createProxyMiddleware({
    target,
    pathFilter, // matched against the full path, which is forwarded unchanged (no prefix stripping)
    changeOrigin: true,
    proxyTimeout: config.upstreamTimeoutMs, // upstream took too long to answer
    timeout: config.upstreamTimeoutMs,
    on: {
      proxyReq(proxyReq, req) {
        // identity is passed on as trusted headers; the raw cookie/JWT never reaches the backends
        proxyReq.removeHeader("cookie");
        proxyReq.removeHeader("authorization");
        proxyReq.setHeader("x-internal-token", config.internalToken);
        proxyReq.setHeader("x-request-id", req.id);
        proxyReq.setHeader("x-client-ip", req.ip ?? "");
        if (req.user) {
          proxyReq.setHeader("x-user-id", req.user.sub);
          proxyReq.setHeader("x-user-email", req.user.email ?? "");
          proxyReq.setHeader("x-user-role", req.user.role ?? "user");
        }
      },
      error(err, req, res) {
        upstreamErrors.inc({ upstream: name, code: err.code ?? "unknown" });
        logger.error("upstream error", { request_id: req.id, upstream: name, code: err.code, error: err.message });
        if (!res.writeHead || res.headersSent) return res.destroy?.();
        const timedOut = ["ECONNRESET", "ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(err.code);
        res.writeHead(timedOut ? 504 : 502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: timedOut ? "Upstream timed out" : "Service unavailable",
            code: timedOut ? "upstream_timeout" : "upstream_unavailable",
            request_id: req.id,
          })
        );
      },
    },
  });
}

// backends mount the same /api/... paths, so nothing is rewritten
app.use(backendProxy("todos", config.todoUrl, "/api/todos"));
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Route not found", code: "not_found", request_id: req.id })
);

// everything that is not /api goes to the Next.js frontend (including its websocket for hot reload in dev)
const frontendProxy = createProxyMiddleware({
  target: config.frontendUrl,
  changeOrigin: false,
  ws: true,
  on: {
    error(err, req, res) {
      logger.error("frontend unavailable", { request_id: req.id, error: err.message });
      if (!res.writeHead || res.headersSent) return res.destroy?.();
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Frontend unavailable");
    },
  },
});
app.use(frontendProxy);

// ---------- start ----------
const server = http.createServer(app);
server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/api")) return socket.destroy();
  frontendProxy.upgrade(req, socket, head);
});
server.requestTimeout = 30_000;
server.headersTimeout = 20_000;
server.keepAliveTimeout = 65_000; // longer than typical load-balancer idle timeouts

server.listen(config.port, () =>
  logger.info("gateway started", {
    port: config.port,
    authhub: authhub.hub,
    todos: config.todoUrl,
    frontend: config.frontendUrl,
  })
);

// Prometheus metrics live on a separate, internal-only port so they are never publicly reachable.
const metricsPort = Number(process.env.METRICS_PORT || 9100);
const metricsServer = http
  .createServer(async (req, res) => {
    if (req.url !== "/metrics") return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": register.contentType }).end(await register.metrics());
  })
  .listen(metricsPort);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });
  const force = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    metricsServer.close();
    await flushLogs();
    clearTimeout(force);
    process.exit(0);
  });
  server.closeIdleConnections?.();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => logger.error("unhandledRejection", { error: String(err?.stack ?? err) }));
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { error: err.stack });
  process.exit(1);
});
