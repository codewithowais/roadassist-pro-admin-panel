import admin from "firebase-admin";

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT env var missing. Paste the contents of the " +
        "service account JSON (from Firebase Console -> Project Settings -> " +
        "Service Accounts -> Generate new private key) into this var.",
    );
  }
  let sa;
  try {
    sa = JSON.parse(raw);
  } catch (e) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON: " + e.message);
  }
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

export async function verifyAdmin(req) {
  // Distinguish server config failures (500) from caller auth failures
  // (401/403). Without this split, a missing FIREBASE_SERVICE_ACCOUNT env
  // var on Vercel surfaces as a confusing 401 "missing bearer token" or
  // similar, when the real cause is the server isn't booted.
  try {
    init();
  } catch (e) {
    const err = new Error(`server_misconfigured: ${e.message}`);
    err.status = 500;
    throw err;
  }
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    const err = new Error("missing bearer token");
    err.status = 401;
    throw err;
  }
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(m[1].trim());
  } catch (e) {
    // Surface the underlying reason (expired, revoked, wrong audience…)
    // so the admin panel can show a useful prompt — typically "your
    // session expired, please sign in again".
    const err = new Error(`invalid_token: ${e.code || e.message || "unknown"}`);
    err.status = 401;
    throw err;
  }
  const doc = await admin
    .firestore()
    .doc(`admin_users/${decoded.uid}`)
    .get();
  if (!doc.exists) {
    const err = new Error("not an admin");
    err.status = 403;
    throw err;
  }
  return decoded;
}
