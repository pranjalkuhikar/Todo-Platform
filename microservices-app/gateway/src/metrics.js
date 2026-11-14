const client = require("prom-client");

const register = new client.Registry();
register.setDefaultLabels({ app: "gateway" });
client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "HTTP requests handled by the gateway",
  labelNames: ["method", "route", "status"],
  registers: [register],
});
const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Gateway request duration (includes the upstream call)",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});
const upstreamErrors = new client.Counter({
  name: "gateway_upstream_errors_total",
  help: "Failed calls to upstream services",
  labelNames: ["upstream", "code"],
  registers: [register],
});
const authRejections = new client.Counter({
  name: "gateway_auth_rejections_total",
  help: "Requests rejected because of a missing or invalid token",
  labelNames: ["reason"],
  registers: [register],
});

module.exports = { register, httpRequests, httpDuration, upstreamErrors, authRejections };
