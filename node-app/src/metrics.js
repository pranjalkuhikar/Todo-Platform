const client = require("prom-client");

const register = new client.Registry();
register.setDefaultLabels({ app: "express" });
client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [register],
});
const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["method", "route", "status"],
  buckets: [0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});
// "User metrics": what users actually do (business events)
const todoOps = new client.Counter({
  name: "todo_operations_total",
  help: "Todo CRUD operations performed by users",
  labelNames: ["op"],
  registers: [register],
});

module.exports = { register, httpRequests, httpDuration, todoOps };
