// Send an FCM push via Firebase Admin SDK. Replaces the Cloud Function
// dependency so push delivery works without enabling Blaze billing.
//
// Body (one of `topic`, `token`, or `tokens` is required):
//   { title, body, topic? = "all", token?, tokens? = [] }
//
// - topic   → broadcast to every device subscribed to the topic
//             (e.g. "all", "customers", "vendors").
// - token   → single device (string).
// - tokens  → up to 500 device tokens (array). Used by the admin panel as a
//             per-token fallback when a topic can't reach all devices —
//             e.g. installed APKs that haven't been rebuilt with topic
//             subscription. Sent via sendEachForMulticast which fans out
//             in parallel and reports per-token success/failure.
//
// Caller must be an admin (Firebase ID token + admin_users).

import admin from "firebase-admin";
import { verifyAdmin } from "../_lib/auth.js";
import { readJsonBody, send } from "../_lib/http.js";

const MAX_MULTICAST_TOKENS = 500; // FCM hard limit per multicast call.

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

  const { title, body: messageBody, topic, token, tokens } = body || {};
  if (typeof title !== "string" || title.length < 1 || title.length > 200)
    return send(res, 400, { error: "invalid_title" });
  if (
    typeof messageBody !== "string" ||
    messageBody.length < 1 ||
    messageBody.length > 1000
  )
    return send(res, 400, { error: "invalid_body" });

  const hasTokensArray = Array.isArray(tokens) && tokens.length > 0;
  if (!topic && !token && !hasTokensArray)
    return send(res, 400, {
      error: "topic_or_token_or_tokens_required",
    });

  if (hasTokensArray && tokens.length > MAX_MULTICAST_TOKENS)
    return send(res, 400, {
      error: "too_many_tokens",
      max: MAX_MULTICAST_TOKENS,
    });

  try {
    initAdmin();
    const messaging = admin.messaging();

    // Multi-token fan-out (per-token fallback path).
    if (hasTokensArray) {
      const cleanTokens = tokens.filter(
        (t) => typeof t === "string" && t.length > 0,
      );
      if (cleanTokens.length === 0)
        return send(res, 400, { error: "no_valid_tokens" });

      const result = await messaging.sendEachForMulticast({
        notification: { title, body: messageBody },
        tokens: cleanTokens,
      });

      // Surface per-token failures so the admin panel can prune stale tokens.
      const failedTokens = [];
      result.responses.forEach((r, i) => {
        if (!r.success) {
          failedTokens.push({
            token: cleanTokens[i],
            code: r.error?.code || "unknown",
            message: r.error?.message || "",
          });
        }
      });

      return send(res, 200, {
        mode: "multicast",
        successCount: result.successCount,
        failureCount: result.failureCount,
        failedTokens,
        sentBy: admin_user.uid,
      });
    }

    // Single-target (topic or token) — original behaviour.
    const message = {
      notification: { title, body: messageBody },
      ...(token ? { token } : { topic }),
    };
    const messageId = await messaging.send(message);
    return send(res, 200, {
      mode: token ? "token" : "topic",
      messageId,
      sentBy: admin_user.uid,
    });
  } catch (e) {
    return send(res, 500, { error: "send_failed", detail: e.message });
  }
}
