// Admin-only: create a Firebase Auth user (email + password) without
// signing the admin out. Used by AddUserModal so admins can create
// end-user accounts that those users can then log in to via the mobile
// app. Returns the new uid.
//
// Body: { email, password, name?, phone? }

import admin from "firebase-admin";
import { verifyAdmin } from "../_lib/auth.js";
import { readJsonBody, send } from "../_lib/http.js";

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

  try {
    await verifyAdmin(req);
  } catch (e) {
    return send(res, e.status || 401, { error: e.message });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }

  const { email, password, name, phone } = body || {};
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return send(res, 400, { error: "invalid_email" });
  if (typeof password !== "string" || password.length < 6)
    return send(res, 400, { error: "password_min_6" });

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
    return send(res, 200, { uid: userRecord.uid, email });
  } catch (e) {
    return send(res, 500, { error: "create_failed", detail: e.message });
  }
}
