import { logger } from "./logger";
import { httpRequests, httpDuration } from "./metrics";

// Wrap a route handler: adds a log line + metrics for every request,
// and turns unexpected errors into a clean 500.
export function observe(route, handler) {
  return async function (request, ctx) {
    const start = performance.now();
    const userId = request.headers.get("x-user-id") || "anonymous";
    let status = 500;
    try {
      const res = await handler(request, ctx, { userId });
      status = res.status;
      return res;
    } catch (err) {
      logger.error("unhandled error", { route, error: err.message, stack: err.stack, user_id: userId });
      return Response.json({ error: "Internal server error" }, { status: 500 });
    } finally {
      const sec = (performance.now() - start) / 1000;
      const labels = { method: request.method, route, status };
      httpRequests.inc(labels);
      httpDuration.observe(labels, sec);
      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
      logger[level]("request", {
        method: request.method,
        route,
        path: new URL(request.url).pathname + new URL(request.url).search,
        status,
        duration_ms: Math.round(sec * 1000 * 100) / 100,
        user_id: userId,
      });
    }
  };
}
