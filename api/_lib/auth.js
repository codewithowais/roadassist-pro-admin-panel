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
  init();
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const m = header.match(/^Bearer (.+)$/);
  if (!m) {
    const err = new Error("missing bearer token");
    err.status = 401;
    throw err;
  }
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(m[1]);
  } catch {
    const err = new Error("invalid token");
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
