const { Pool } = require("pg");
const config = require("./config");
const { logger } = require("./logger");

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
});
// an idle client erroring (e.g. DB restart) must not crash the process
pool.on("error", (err) => logger.error("pg pool error", { error: err.message }));

async function waitForDb(attempts = 30) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (i === attempts) throw err;
      logger.warn("waiting for database", { attempt: i, error: err.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

module.exports = { pool, waitForDb };
