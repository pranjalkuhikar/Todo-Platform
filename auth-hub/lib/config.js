// Single place for configuration. Everything comes from environment variables.
const num = (v, d) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  issuer: "authhub",
  publicUrl: (process.env.AUTHHUB_URL || "http://localhost:4500").replace(/\/$/, ""),
  databaseUrl: process.env.DATABASE_URL || "postgres://app:app@localhost:5432/authhub",
  accessTtlSeconds: num(process.env.ACCESS_TTL_SECONDS, 600), // how long a signed token is valid
  sessionIdleDays: 7, // a session survives this long without being used
  sessionMaxDays: 30, // ...but never longer than this in total
  cookieSecure: process.env.COOKIE_SECURE === "true",
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  lockout: { maxFailures: 5, windowMinutes: 15 },
  cookies: { access: "ah_token", session: "ah_session" },
};

export const seedApps = [
  { slug: "nextjs", name: "Next.js App", description: "Todo app built with Next.js and Postgres", url: process.env.APP_NEXTJS_URL || "http://localhost:3000", icon: "▲" },
  { slug: "node", name: "Node.js API", description: "Express todo API with Postgres", url: process.env.APP_NODE_URL || "http://localhost:4000", icon: "⬢" },
  { slug: "microservices", name: "TaskGate", description: "Microservices todo platform behind an API gateway", url: process.env.APP_MICROSERVICES_URL || "http://localhost:8080", icon: "◈" },
];
