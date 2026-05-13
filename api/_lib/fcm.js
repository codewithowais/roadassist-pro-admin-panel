// FCM HTTP v1 helper.
// Replaces firebase-admin.messaging() using FCM HTTP v1 API directly,
// signed with a Google service-account JWT via google-auth-library.
// This removes the firebase-admin dependency from the server entirely.
//
// Env vars required:
//   FIREBASE_SERVICE_ACCOUNT_JSON  — full service account JSON string

import { GoogleAuth } from "google-auth-library";

let _auth = null;

function getGoogleAuth() {
  if (_auth) return _auth;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON env var missing");
  }
  let sa;
  try {
    sa = JSON.parse(raw);
  } catch (e) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`);
  }
  _auth = new GoogleAuth({
    credentials: sa,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  return _auth;
}

async function getAccessToken() {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

const FCM_BASE = "https://fcm.googleapis.com/v1/projects";

// Extract project_id from the service account JSON
function getProjectId() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw).project_id;
  } catch {
    return null;
  }
}

// Send a single message (topic or token target)
export async function sendMessage({ title, body, topic, token }) {
  const accessToken = await getAccessToken();
  const projectId = getProjectId();
  const url = `${FCM_BASE}/${projectId}/messages:send`;

  const message = {
    notification: { title, body },
    ...(token ? { token } : { topic }),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(`fcm_send_failed: ${res.status} — ${JSON.stringify(j)}`);
  }
  const j = await res.json();
  return { messageId: j.name };
}

// Send to multiple tokens (up to 500, FCM multicast equivalent)
// Uses individual sends for FCM HTTP v1 (no sendEachForMulticast in HTTP v1)
export async function sendMulticast({ title, body, tokens }) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, failedTokens: [] };
  }

  const accessToken = await getAccessToken();
  const projectId = getProjectId();
  const url = `${FCM_BASE}/${projectId}/messages:send`;

  let successCount = 0;
  let failureCount = 0;
  const failedTokens = [];

  // Fire in batches of 100 (parallel per batch, sequential batches)
  const PARALLEL = 100;
  for (let i = 0; i < tokens.length; i += PARALLEL) {
    const chunk = tokens.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      chunk.map((token) =>
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: { notification: { title, body }, token },
          }),
        }).then(async (res) => {
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            return { success: false, token, code: j.error?.status || `HTTP_${res.status}`, message: j.error?.message || "" };
          }
          return { success: true };
        }),
      ),
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled" && r.value?.success) {
        successCount++;
      } else {
        failureCount++;
        failedTokens.push({
          token: chunk[j],
          code: r.value?.code || r.reason?.message || "unknown",
          message: r.value?.message || "",
        });
      }
    }
  }

  return { successCount, failureCount, failedTokens };
}
