// Invite a new admin: creates a Firebase Auth user and an
// admin_users/<uid> Firestore doc. Role-gated:
//   - Caller must already be an admin.
//   - Only superadmin or manager can invite.
//   - Cannot create a new superadmin via this endpoint (the bootstrap
//     superadmin is the only one and must be created out-of-band).
//
// Body: { email, password, name?, role? = "manager" }

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

const ALLOWED_ROLES = new Set(["manager", "support", "viewer"]);

export default async function handler(req, res) {
  if (req.method !== "POST")
    return send(res, 405, { error: "method_not_allowed" });

  // Cap admin invitations at 5/min/IP — defense in depth on top of the
  // role check below. A compromised admin token can still invite, but
  // not in a tight loop.
  const limited = rateLimit(req, {
    key: "admin-invite",
    max: 5,
    windowMs: 60_000,
  });
  if (limited) {
    res.setHeader("Retry-After", String(limited.retryAfter));
    return send(res, 429, {
      error: "rate_limited",
      retryAfter: limited.retryAfter,
    });
  }

  let caller;
  try {
    caller = await verifyAdmin(req);
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }

  const { email, password, name, role = "manager" } = body || {};
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return send(res, 400, { error: "invalid_email" });
  if (typeof password !== "string" || password.length < 6)
    return send(res, 400, { error: "password_min_6" });
  if (!ALLOWED_ROLES.has(role))
    return send(res, 400, { error: "invalid_role" });

  try {
    initAdmin();
    // Caller's role check. Prefer the custom claim (free) and fall back
    // to a Firestore read only if the claim isn't present yet — same
    // graceful-migration pattern as verifyAdmin.
    let callerRole = caller.role || null;
    if (!callerRole) {
      const callerSnap = await admin
        .firestore()
        .doc(`admin_users/${caller.uid}`)
        .get();
      callerRole = callerSnap.data()?.role || null;
    }
    if (callerRole !== "superadmin" && callerRole !== "manager")
      return send(res, 403, { error: "insufficient_permissions" });

    // Create Auth user.
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: name || undefined,
      });
    } catch (e) {
      if (e.code === "auth/email-already-exists")
        return send(res, 409, { error: "email_already_exists" });
      throw e;
    }

    // Stamp the custom claim BEFORE writing the admin_users doc so the
    // new admin's very first sign-in produces a token with the claim
    // already in place. No further Firestore read needed in verifyAdmin.
    try {
      await admin.auth().setCustomUserClaims(userRecord.uid, {
        admin: true,
        role,
        disabled: false,
      });
    } catch (e) {
      // Non-fatal: the admin_users doc still gets written, and verifyAdmin
      // falls back to the Firestore read. Log so it's visible.
      // eslint-disable-next-line no-console
      console.warn("[invite] setCustomUserClaims failed:", e.message);
    }

    // Create admin_users doc.
    await admin
      .firestore()
      .doc(`admin_users/${userRecord.uid}`)
      .set({
        email,
        name: name || null,
        role,
        disabled: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });

    return send(res, 200, { uid: userRecord.uid, email, role });
  } catch (e) {
    return send(res, 500, { error: "invite_failed", detail: e.message });
  }
}
