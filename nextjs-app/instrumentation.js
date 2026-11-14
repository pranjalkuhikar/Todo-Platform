// Runs once when the Next.js server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { seedIfEmpty } = await import("./lib/seed");
    await seedIfEmpty();
  } catch (err) {
    // never block the app from starting because the database is not ready yet
    console.error("[seed] skipped:", err.message);
  }
}
