// Invite a new admin: creates Supabase Auth user and updates profiles row.
// Role-gated: caller must be superadmin or manager.
//
// Body: { email, password, name?, role? = "manager" }

import { createClient } from "@supabase/supabase-js";
import { verifyAdmin } from "../_lib/auth.js";
import { readJsonBody, send } from "../_lib/http.js";
import { rateLimit } from "../_lib/rate_limit.js";

function getAdminClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

const ALLOWED_ROLES = new Set(["manager", "support", "viewer"]);

export default async function handler(req, res) {
  if (req.method !== "POST")
    return send(res, 405, { error: "method_not_allowed" });

  const limited = rateLimit(req, { key: "admin-invite", max: 5, windowMs: 60_000 });
  if (limited) {
    res.setHeader("Retry-After", String(limited.retryAfter));
    return send(res, 429, { error: "rate_limited", retryAfter: limited.retryAfter });
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

  const callerRole = caller.role || null;
  if (callerRole !== "superadmin" && callerRole !== "manager")
    return send(res, 403, { error: "insufficient_permissions" });

  try {
    const adminClient = getAdminClient();

    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { admin: true, role, disabled: false },
      user_metadata: { name: name || "" },
    });

    if (error) {
      if (error.message?.includes("already")) return send(res, 409, { error: "email_already_exists" });
      return send(res, 400, { error: error.message });
    }

    await adminClient.from("profiles").upsert({
      id: data.user.id,
      email,
      name: name || null,
      role: "admin",
      status: "active",
    });

    return send(res, 200, { uid: data.user.id, email, role });
  } catch (e) {
    return send(res, 500, { error: "invite_failed", detail: e.message });
  }
}
