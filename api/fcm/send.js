// Send an FCM push via Firebase Admin SDK. Replaces the Cloud Function
// dependency so push delivery works without enabling Blaze billing.
//
// Body:
//   { title, body, topic? = "all", token? }
//
// One of `topic` or `token` must be provided. `topic` sends to all
// devices subscribed to that FCM topic (e.g. "all"); `token` sends to a
// single device. Caller must be an admin (Firebase ID token + admin_users).

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

export default async function handler(req, res) {
  if (req.method !== "POST")
    return send(res, 405, { error: "method_not_allowed" });

  let admin_user;
  try {
    admin_user = await verifyAdmin(req);
  } catch (e) {
    return send(res, e.status || 401, { error: e.message });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }

  const { title, body: messageBody, topic, token } = body || {};
  if (typeof title !== "string" || title.length < 1 || title.length > 200)
    return send(res, 400, { error: "invalid_title" });
  if (
    typeof messageBody !== "string" ||
    messageBody.length < 1 ||
    messageBody.length > 1000
  )
    return send(res, 400, { error: "invalid_body" });
  if (!topic && !token)
    return send(res, 400, { error: "topic_or_token_required" });

  try {
    initAdmin();
    const messaging = admin.messaging();
    const message = {
      notification: { title, body: messageBody },
      ...(token ? { token } : { topic }),
    };
    const messageId = await messaging.send(message);
    return send(res, 200, { messageId, sentBy: admin_user.uid });
  } catch (e) {
    return send(res, 500, { error: "send_failed", detail: e.message });
  }
}
