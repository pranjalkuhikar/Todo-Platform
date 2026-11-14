// Creates a few demo users so you can see the routing in action:  npm run seed:demo
// LOCAL DEMO ONLY: every demo user gets the same well-known password. Refuses to run in production.
import { query, db } from "../lib/db.js";
import { hashPassword } from "../lib/password.js";

if (process.env.NODE_ENV === "production") { console.error("Refusing to seed demo users in production."); process.exit(1); }

const PASSWORD = "Demo-Pass-1234!";
const users = [
  { email: "alice@demo.test", name: "Alice (Next.js only)", apps: [["nextjs", "member"]] },
  { email: "bob@demo.test", name: "Bob (Node only)", apps: [["node", "member"]] },
  { email: "carol@demo.test", name: "Carol (Microservices only)", apps: [["microservices", "admin"]] },
  { email: "dave@demo.test", name: "Dave (two apps)", apps: [["nextjs", "member"], ["node", "member"]], default_app: "node" },
  { email: "erin@demo.test", name: "Erin (no apps)", apps: [] },
];
const hash = await hashPassword(PASSWORD);
for (const u of users) {
  const { rows } = await query(
    `INSERT INTO users (email, name, password_hash, default_app) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [u.email, u.name, hash, u.default_app || null]);
  await query("DELETE FROM user_apps WHERE user_id = $1", [rows[0].id]);
  for (const [slug, role] of u.apps) await query("INSERT INTO user_apps (user_id, app_slug, app_role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [rows[0].id, slug, role]);
  console.log(`  ${u.email.padEnd(18)} → ${u.apps.map(([s, r]) => `${s}(${r})`).join(", ") || "no apps"}`);
}
console.log(`\nDemo password for all of them: ${PASSWORD}`);
await (await db()).end();
