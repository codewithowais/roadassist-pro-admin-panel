import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { r2, BUCKET, isValidVendorDocPath, isValidApplicationId } from "../_lib/r2.js";
import { verifyAdmin } from "../_lib/auth.js";
import { readJsonBody, send } from "../_lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });

  try { await verifyAdmin(req); }
  catch (e) { return send(res, e.status || 500, { error: e.message }); }

  let body;
  try { body = await readJsonBody(req); }
  catch { return send(res, 400, { error: "invalid_json" }); }

  const { path, applicationId } = body || {};

  let keys = [];
  if (path) {
    if (!isValidVendorDocPath(path)) return send(res, 400, { error: "invalid_path" });
    keys = [path];
  } else if (applicationId) {
    if (!isValidApplicationId(applicationId))
      return send(res, 400, { error: "invalid_applicationId" });
    try {
      const list = await r2.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `${applicationId}/`,
      }));
      keys = (list.Contents || []).map((o) => o.Key);
    } catch (e) {
      return send(res, 500, { error: "list_failed", detail: e.message });
    }
  } else {
    return send(res, 400, { error: "path_or_applicationId_required" });
  }

  if (keys.length === 0) return send(res, 200, { deleted: 0 });

  try {
    await r2.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }));
    return send(res, 200, { deleted: keys.length });
  } catch (e) {
    return send(res, 500, { error: "delete_failed", detail: e.message });
  }
}
