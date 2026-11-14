// Product analytics (who did what). Optional: does nothing unless a key is set.
//   POSTHOG_KEY=phc_xxx   |   MIXPANEL_TOKEN=xxxx      (same as the other apps in this repo)
// Fire-and-forget: a slow or failing analytics provider never slows down or breaks a request.
const crypto = require("node:crypto");

const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
const MIXPANEL_TOKEN = process.env.MIXPANEL_TOKEN;
const MIXPANEL_HOST = process.env.MIXPANEL_HOST || "https://api.mixpanel.com";
const APP = process.env.SERVICE_NAME || "todo-service";

function post(url, body) {
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

// never send raw emails to third parties: unknown visitors get a stable anonymous id
const anonId = (email) => "anon_" + crypto.createHash("sha256").update(email).digest("hex").slice(0, 16);

function track(distinctId, event, props = {}) {
  if (POSTHOG_KEY) {
    post(`${POSTHOG_HOST}/capture/`, {
      api_key: POSTHOG_KEY,
      event,
      distinct_id: distinctId,
      properties: { app: APP, ...props },
    });
  }
  if (MIXPANEL_TOKEN) {
    post(`${MIXPANEL_HOST}/track`, [
      { event, properties: { token: MIXPANEL_TOKEN, distinct_id: distinctId, time: Date.now(), app: APP, ...props } },
    ]);
  }
}

module.exports = { track, anonId };
