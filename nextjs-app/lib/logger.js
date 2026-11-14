// Tiny JSON logger: prints to the console AND batches lines to Loki (Grafana logs).
// If Loki is down, logs still print; nothing crashes.
const APP = "nextjs";
const LOKI_URL = process.env.LOKI_URL || "http://localhost:3100";
const MAX_BUFFER = 200000; // lines held in memory while Loki catches up
const BATCH = 2000;

// State lives on globalThis: Next can load this module more than once (dev hot-reload, per-route bundles).
const g = globalThis;
g.__log ??= { buffer: [], dropped: 0, flushing: false, timer: null };
const st = g.__log;

async function sendBatch() {
  const batch = st.buffer.splice(0, BATCH);
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
    st.dropped += batch.length; // Loki unreachable or rejected: drop, keep serving traffic
    return false;
  }
}

async function flush() {
  if (st.flushing) return;
  st.flushing = true;
  try {
    while (st.buffer.length > 0) if (!(await sendBatch())) break;
  } finally {
    st.flushing = false;
    if (st.dropped > 0) {
      console.error(`[logger] ${st.dropped} log lines were not delivered to Loki`);
      st.dropped = 0;
    }
  }
}

if (!st.timer) {
  st.timer = setInterval(flush, 1000);
  st.timer.unref?.();
}

function log(level, msg, fields = {}) {
  const now = Date.now();
  const line = JSON.stringify({ time: new Date(now).toISOString(), level, app: APP, msg, ...fields });
  console.log(line);
  st.buffer.push({ level, ts: String(now * 1e6 + Math.floor(Math.random() * 1e6)), line });
  if (st.buffer.length > MAX_BUFFER) {
    st.dropped += st.buffer.length - MAX_BUFFER;
    st.buffer.splice(0, st.buffer.length - MAX_BUFFER);
  }
  if (st.buffer.length >= BATCH) flush();
}

export const logger = {
  info: (m, f) => log("info", m, f),
  warn: (m, f) => log("warn", m, f),
  error: (m, f) => log("error", m, f),
};
