// Tiny JSON logger: prints to the console AND batches lines to Loki (Grafana logs).
// If Loki is down, logs still print; nothing crashes.
const APP = "express";
const LOKI_URL = process.env.LOKI_URL || "http://localhost:3100";
const MAX_BUFFER = 200000; // lines held in memory while Loki catches up
const BATCH = 2000;
let buffer = [];
let dropped = 0;
let flushing = false;

async function sendBatch() {
  const batch = buffer.splice(0, BATCH);
  const byLevel = {};
  for (const e of batch) (byLevel[e.level] ??= []).push([e.ts, e.line]);
  const streams = Object.entries(byLevel).map(([level, values]) => ({ stream: { app: APP, level }, values }));
  try {
    const res = await fetch(`${LOKI_URL}/loki/api/v1/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streams }),
    });
    if (!res.ok) throw new Error(String(res.status));
    return true;
  } catch {
    dropped += batch.length; // Loki unreachable or rejected: drop, keep serving traffic
    return false;
  }
}

async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (buffer.length > 0) if (!(await sendBatch())) break;
  } finally {
    flushing = false;
    if (dropped > 0) {
      console.error(`[logger] ${dropped} log lines were not delivered to Loki`);
      dropped = 0;
    }
  }
}
setInterval(flush, 1000).unref();

function log(level, msg, fields = {}) {
  const now = Date.now();
  const line = JSON.stringify({ time: new Date(now).toISOString(), level, app: APP, msg, ...fields });
  console.log(line);
  buffer.push({ level, ts: String(now * 1e6 + Math.floor(Math.random() * 1e6)), line });
  if (buffer.length > MAX_BUFFER) {
    dropped += buffer.length - MAX_BUFFER;
    buffer.splice(0, buffer.length - MAX_BUFFER);
  }
  if (buffer.length >= BATCH) flush();
}

module.exports = {
  logger: {
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
  },
  flushLogs: flush,
};
