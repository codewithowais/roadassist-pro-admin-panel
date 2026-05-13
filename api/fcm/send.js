// Send an FCM push via FCM HTTP v1 API (signed with service-account JWT).
// Replaces firebase-admin.messaging() — no firebase-admin dependency.
//
// Body (one of `topic`, `token`, or `tokens` is required):
//   { title, body, topic? = "all", token?, tokens? = [] }
//
// - topic   → broadcast to every device subscribed to the topic
// - token   → single device
// - tokens  → up to 500 device tokens (array)
//
// Caller must be a verified admin (Supabase JWT).

import { sendMessage, sendMulticast } from "../_lib/fcm.js";
import { verifyAdmin } from "../_lib/auth.js";
import { readJsonBody, send } from "../_lib/http.js";
import { createClient } from "@supabase/supabase-js";

const MAX_MULTICAST_TOKENS = 500;

const ALLOWED_TOPICS = new Set([
  "all",
  "customers",
  "vendors",
  "karachi",
  "lahore",
  "islamabad",
]);

async function readRuntimeFlags() {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data } = await supabase
      .from("app_config")
      .select("data")
      .eq("id", "flags")
      .single();
    return data?.data || {};
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return send(res, 405, { error: "method_not_allowed" });

  let admin_user;
  try {
    admin_user = await verifyAdmin(req);
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
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
  if (typeof messageBody !== "string" || messageBody.length < 1 || messageBody.length > 1000)
    return send(res, 400, { error: "invalid_body" });

  const hasTokensArray = Array.isArray(tokens) && tokens.length > 0;
  if (!topic && !token && !hasTokensArray)
    return send(res, 400, { error: "topic_or_token_or_tokens_required" });
  if (hasTokensArray && tokens.length > MAX_MULTICAST_TOKENS)
    return send(res, 400, { error: "too_many_tokens", max: MAX_MULTICAST_TOKENS });
  if (topic && !ALLOWED_TOPICS.has(topic))
    return send(res, 400, { error: "topic_not_allowed", allowed: Array.from(ALLOWED_TOPICS) });

  try {
    const flags = await readRuntimeFlags();
    if (flags.fcmPushEnabled === false) {
      return send(res, 200, { mode: "suppressed", reason: "fcmPushEnabled flag is off" });
    }

    if (hasTokensArray) {
      const cleanTokens = tokens.filter((t) => typeof t === "string" && t.length > 0);
      if (cleanTokens.length === 0)
        return send(res, 400, { error: "no_valid_tokens" });

      const result = await sendMulticast({ title, body: messageBody, tokens: cleanTokens });
      return send(res, 200, {
        mode: "multicast",
        successCount: result.successCount,
        failureCount: result.failureCount,
        failedTokens: result.failedTokens,
        sentBy: admin_user.uid,
      });
    }

    const { messageId } = await sendMessage({
      title,
      body: messageBody,
      ...(token ? { token } : { topic }),
    });
    return send(res, 200, { mode: token ? "token" : "topic", messageId, sentBy: admin_user.uid });
  } catch (e) {
    return send(res, 500, { error: "send_failed", detail: e.message });
  }
}
