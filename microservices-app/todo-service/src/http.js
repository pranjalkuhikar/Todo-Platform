const crypto = require("node:crypto");
const config = require("./config");

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const safeEqual = (a, b) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

// Only the gateway knows INTERNAL_TOKEN, so only it can vouch for who the user is via x-user-id.
function internalOnly(req, res, next) {
  const token = req.get("x-internal-token");
  if (!token || !safeEqual(token, config.internalToken)) {
    return res.status(401).json({ error: "Internal service: use the gateway", code: "internal_only" });
  }
  req.id = req.get("x-request-id") || crypto.randomUUID();
  const id = req.get("x-user-id");
  if (id) req.user = { id, email: req.get("x-user-email"), role: req.get("x-user-role") || "user" };
  next();
}

const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: "Authentication required", code: "missing_token" });

module.exports = { wrap, internalOnly, requireUser };
