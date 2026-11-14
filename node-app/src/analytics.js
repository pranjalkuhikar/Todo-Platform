// Product analytics (who did what). Optional: does nothing unless a key is set.
//   POSTHOG_KEY=phc_xxx      (PostHog, https://posthog.com, free tier)
//   MIXPANEL_TOKEN=xxxx      (Mixpanel, https://mixpanel.com, free tier)
// Use POSTHOG_HOST / MIXPANEL_HOST for EU data residency.
const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
const MIXPANEL_TOKEN = process.env.MIXPANEL_TOKEN;
const MIXPANEL_HOST = process.env.MIXPANEL_HOST || "https://api.mixpanel.com";

function post(url, body) {
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

function track(userId, event, props = {}) {
  if (POSTHOG_KEY) {
    post(`${POSTHOG_HOST}/capture/`, {
      api_key: POSTHOG_KEY,
      event,
      distinct_id: userId,
      properties: { app: "express", ...props },
    });
  }
  if (MIXPANEL_TOKEN) {
    post(`${MIXPANEL_HOST}/track`, [
      { event, properties: { token: MIXPANEL_TOKEN, distinct_id: userId, time: Date.now(), app: "express", ...props } },
    ]);
  }
}

module.exports = { track };
