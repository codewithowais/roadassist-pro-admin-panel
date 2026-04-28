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

  // Fast path: trust the custom claim stamped by set-admin-claims.mjs.
  // This is FREE — the claim rides inside the JWT we just verified, no
  // Firestore round-trip needed. `decoded.disabled === true` lets us lock
  // out offboarded admins without deleting their admin_users doc.
  if (decoded.admin === true && decoded.disabled !== true) {
    return decoded;
  }

  // Slow path / migration fallback: when an admin hasn't refreshed their
  // ID token since the migration ran, the claim is missing. Fall back to
  // the legacy admin_users lookup so they keep working until next sign-in.
  // Once every active admin has refreshed (or after their tokens expire,
  // ~1h), this branch effectively becomes dead code.
  try {
    const doc = await admin
      .firestore()
      .doc(`admin_users/${decoded.uid}`)
      .get();
    if (!doc.exists) {
      const err = new Error("not an admin");
      err.status = 403;
      throw err;
    }
    if (doc.data()?.disabled === true) {
      const err = new Error("admin disabled");
      err.status = 403;
      throw err;
    }
    // Backfill the role onto the decoded object so downstream callers
    // (invite.js role gate) don't need to re-read the same doc.
    decoded.role = doc.data()?.role || decoded.role || null;
    return decoded;
  } catch (e) {
    if (e.status) throw e; // already-shaped 403
    // Firestore failures (quota, network) shouldn't masquerade as auth
    // errors. Re-throw with a clear status so the handler can return 503.
    const err = new Error(
      `admin_check_failed: ${e.code || e.message || "unknown"}`,
    );
    err.status = 503;
    throw err;
  }
}
