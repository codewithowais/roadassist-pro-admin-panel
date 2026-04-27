import { S3Client } from "@aws-sdk/client-s3";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  throw new Error(
    "Missing R2 env vars. Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET",
  );
}

export const BUCKET = R2_BUCKET;

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  // R2 does not handle the default CRC32 checksum that AWS SDK v3 (>=3.729)
  // injects on presigned PUT URLs. Without these, R2 rejects the upload with
  // a signature/integrity error. WHEN_REQUIRED disables the auto-checksum.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = new Set(["cnic", "license", "photo"]);
const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function buildVendorDocPath({ applicationId, key, contentType }) {
  if (!UUID_RE.test(applicationId)) throw new Error("invalid applicationId");
  if (!KEYS.has(key)) throw new Error("invalid key");
  const ext = MIME_TO_EXT[contentType];
  if (!ext) throw new Error("unsupported contentType");
  return `${applicationId}/${key}.${ext}`;
}

export function isValidVendorDocPath(path) {
  if (typeof path !== "string") return false;
  const m = path.match(/^([0-9a-f-]{36})\/(cnic|license|photo)\.(jpg|jpeg|png|webp)$/i);
  return Boolean(m && UUID_RE.test(m[1]));
}

export function isValidApplicationId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}
