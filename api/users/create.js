// Admin-only: create a Firebase Auth user (email + password) without
// signing the admin out. Used by AddUserModal so admins can create
// end-user accounts that those users can then log in to via the mobile
// app. Returns the new uid.
//
// Body: { email, password, name?, phone? }

import admin from "firebase-admin";
import { verifyAdmin } from "../_lib/auth.js";
import { readJsonBody, send } from "../_lib/http.js";
import { rateLimit } from "../_lib/rate_limit.js";

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env var missing");
  const sa = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

function normalisePhone(p) {
  if (!p) return null;
  const digits = String(p).replace(/[^\d+]/g, "");
  if (!digits) return null;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return send(res, 405, { error: "method_not_allowed" });

  const limited = rateLimit(req, {
    key: "users-create",
    max: 30,
    windowMs: 60_000,
  });
  if (limited) {
    res.setHeader("Retry-After", String(limited.retryAfter));
    return send(res, 429, {
      error: "rate_limited",
      retryAfter: limited.retryAfter,
    });
  }

  try {
    await verifyAdmin(req);
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }

  const { email, password, name, phone, role: bodyRole } = body || {};
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return send(res, 400, { error: "invalid_email" });
  if (typeof password !== "string" || password.length < 6)
    return send(res, 400, { error: "password_min_6" });
  // Role defaults to "customer" so existing call sites keep working.
  // Admin can pass "vendor" when creating a vendor account from the
  // AddVendorModal so the mobile app's role gate routes them correctly.
  const role = bodyRole === "vendor" ? "vendor" : "customer";

  try {
    initAdmin();
    const phoneNumber = normalisePhone(phone);
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: name || undefined,
        phoneNumber: phoneNumber || undefined,
      });
    } catch (e) {
      if (e.code === "auth/email-already-exists")
        return send(res, 409, { error: "email_already_exists" });
      if (e.code === "auth/invalid-phone-number")
        return send(res, 400, { error: "invalid_phone" });
      if (e.code === "auth/phone-number-already-exists")
        return send(res, 409, { error: "phone_already_exists" });
      throw e;
    }
    // Mirror the user identity into the `users/{uid}` Firestore doc so
    // the mobile app's role gate (users.role) finds a populated record on
    // first login. Failure is non-fatal — the UI also calls addUser() to
    // ensure this doc exists, but having the API write it removes any
    // race window where the auth account exists without a profile.
    try {
      await admin
        .firestore()
        .doc(`users/${userRecord.uid}`)
        .set(
          {
            uid: userRecord.uid,
            email,
            phone: phoneNumber || "",
            name: name || "",
            role,
            status: "active",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[users.create] users doc write failed:", e.message);
    }

    return send(res, 200, { uid: userRecord.uid, email, role });
  } catch (e) {
    return send(res, 500, { error: "create_failed", detail: e.message });
  }
}
