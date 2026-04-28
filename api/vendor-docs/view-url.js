import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, BUCKET, isValidVendorDocPath } from "../_lib/r2.js";
import { verifyAdmin } from "../_lib/auth.js";
import { readJsonBody, send } from "../_lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });

  try { await verifyAdmin(req); }
  catch (e) { return send(res, e.status || 500, { error: e.message }); }

  let body;
  try { body = await readJsonBody(req); }
  catch { return send(res, 400, { error: "invalid_json" }); }

  const { path } = body || {};
  if (!isValidVendorDocPath(path)) return send(res, 400, { error: "invalid_path" });

  try {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: path });
    const viewUrl = await getSignedUrl(r2, cmd, { expiresIn: 3600 });
    return send(res, 200, { viewUrl });
  } catch (e) {
    return send(res, 500, { error: "presign_failed", detail: e.message });
  }
}
