const express = require("express");
const config = require("./config");
const { pool, waitForDb } = require("./db");
const { migrate } = require("./migrate");
const { logger, flushLogs } = require("./logger");
const { register, httpRequests, httpDuration } = require("./metrics");
const { internalOnly } = require("./http");

const app = express();
app.disable("x-powered-by");

// access log + metrics
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    if (req.path === "/metrics" || req.path === "/healthz") return;
    const sec = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route ? req.baseUrl + req.route.path : "unmatched";
    const labels = { method: req.method, route, status: res.statusCode };
    httpRequests.inc(labels);
    httpDuration.observe(labels, sec);
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]("request", {
      request_id: req.id,
      method: req.method,
      route,
      status: res.statusCode,
      duration_ms: Math.round(sec * 1000 * 100) / 100,
      user_id: req.user?.id ?? "anonymous",
    });
  });
  next();
});

app.get("/healthz", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "todo-service", db: "up" });
  } catch {
    res.status(503).json({ status: "unavailable", service: "todo-service", db: "down" });
  }
});
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType).send(await register.metrics());
});

// everything below only accepts calls that come from the gateway
app.use(internalOnly);
app.use(express.json({ limit: "20kb" }));
app.use("/api/todos", require("./todos"));

app.use((req, res) => res.status(404).json({ error: "Route not found", code: "not_found" }));
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON", code: "invalid_json" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Body too large", code: "too_large" });
  logger.error("unhandled error", { request_id: req.id, error: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error", code: "internal_error", request_id: req.id });
});

let server;
async function main() {
  await waitForDb();
  if (config.runMigrations) await migrate();
  server = app.listen(config.port, () => logger.info("todo-service started", { port: config.port }));
  server.keepAliveTimeout = 65_000;
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });
  const force = setTimeout(() => process.exit(1), 10_000).unref();
  server?.close(async () => {
    await flushLogs();
    await pool.end().catch(() => {});
    clearTimeout(force);
    process.exit(0);
  });
  server?.closeIdleConnections?.();
  if (!server) process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => logger.error("unhandledRejection", { error: String(err?.stack ?? err) }));

main().catch((err) => {
  logger.error("failed to start", { error: err.message });
  process.exit(1);
});
