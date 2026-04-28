// Tiny in-memory rate limiter for serverless API routes.
//
// Vercel functions are stateless across cold starts, so this only
// rate-limits within a single warm function instance. That's still
// useful — it caps a runaway script hitting one endpoint repeatedly
// without needing a Redis dependency. For multi-instance enforcement
// (DDoS protection, etc.) put Cloudflare or similar in front.
//
// Usage:
//   const limited = rateLimit(req, { key: "vendor-docs-upload", max: 10, windowMs: 60_000 });
//   if (limited) return send(res, 429, { error: "rate_limited", retryAfter: limited.retryAfter });

const buckets = new Map();

function clientKey(req, prefix) {
  // Vercel forwards client IP via x-forwarded-for. Fall back to a remote
  // socket when running in non-Vercel environments (e.g. local Vite dev).
  const fwd = req.headers["x-forwarded-for"];
  const ip = (typeof fwd === "string" ? fwd.split(",")[0] : "").trim() ||
             req.socket?.remoteAddress ||
             "unknown";
  return `${prefix}:${ip}`;
}

/**
 * Returns null when allowed, or { retryAfter } seconds when exceeded.
 *
 * @param {object} req
 * @param {{ key: string, max: number, windowMs: number }} opts
 */
export function rateLimit(req, opts) {
  const key = clientKey(req, opts.key);
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return null;
  }
  if (bucket.count >= opts.max) {
    return {
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  bucket.count += 1;
  return null;
}

// Best-effort GC to keep the map small. Called inside rateLimit so we
// don't need a separate timer (timers don't survive serverless invokes
// reliably anyway). O(n) sweep but `n` here is bounded by the number of
// distinct client IPs hitting the warm instance — typically tiny.
export function gcRateLimit() {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k);
  }
}
