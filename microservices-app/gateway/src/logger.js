// One JSON log line per event on stdout (collected by Docker / any log shipper).
// If LOKI_URL is set the lines are also pushed to Loki in batches; Loki being down never affects traffic.
const APP = process.env.SERVICE_NAME || "gateway";
const LOKI_URL = process.env.LOKI_URL || "";
const MAX_BUFFER = 50000;
const BATCH = 1000;
let buffer = [];
let flushing = false;

async function flush() {
  if (flushing || !LOKI_URL) return;
  flushing = true;
  try {
    while (buffer.length > 0) {
      const batch = buffer.splice(0, BATCH);
      const byLevel = {};
      for (const e of batch) (byLevel[e.level] ??= []).push([e.ts, e.line]);
      const streams = Object.entries(byLevel).map(([level, values]) => ({ stream: { app: APP, level }, values }));
      try {
        const res = await fetch(`${LOKI_URL}/loki/api/v1/push`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ streams }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        break; // drop this batch; keep serving traffic
      }
    }
  } finally {
    flushing = false;
  }
}
if (LOKI_URL) setInterval(flush, 1000).unref();

function log(level, msg, fields = {}) {
  const now = Date.now();
  const line = JSON.stringify({ time: new Date(now).toISOString(), level, app: APP, msg, ...fields });
  (level === "error" ? console.error : console.log)(line);
  if (!LOKI_URL) return;
  buffer.push({ level, ts: String(now * 1e6 + Math.floor(Math.random() * 1e6)), line });
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
}

module.exports = {
  logger: {
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
  },
  flushLogs: flush,
};
