import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, BUCKET, buildVendorDocPath } from "../_lib/r2.js";
import { readJsonBody, send } from "../_lib/http.js";
import { rateLimit, gcRateLimit } from "../_lib/rate_limit.js";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });

  // This endpoint is intentionally public (used by the unauthenticated
  // vendor self-registration form). Cap requests to 20/min/IP so a
  // runaway script can't exhaust R2 quota or rack up presign costs.
  const limited = rateLimit(req, {
    key: "vendor-docs-upload",
    max: 20,
    windowMs: 60_000,
  });
  if (limited) {
    res.setHeader("Retry-After", String(limited.retryAfter));
    return send(res, 429, {
      error: "rate_limited",
      retryAfter: limited.retryAfter,
    });
  }
  gcRateLimit();

  let body;
  try { body = await readJsonBody(req); }
  catch { return send(res, 400, { error: "invalid_json" }); }

  const { applicationId, key, contentType, size } = body || {};
  if (typeof size !== "number" || size <= 0 || size > MAX_BYTES) {
    return send(res, 400, { error: "invalid_size", maxBytes: MAX_BYTES });
  }

  let path;
  try { path = buildVendorDocPath({ applicationId, key, contentType }); }
  catch (e) { return send(res, 400, { error: e.message }); }

  try {
    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: path,
      ContentType: contentType,
      ContentLength: size,
    });
    const uploadUrl = await getSignedUrl(r2, cmd, { expiresIn: 300 });
    return send(res, 200, { uploadUrl, path });
  } catch (e) {
    return send(res, 500, { error: "presign_failed", detail: e.message });
  }
}
