// Admin-only: create a Supabase Auth user (email + password) without
// signing the admin out. Used by AddUserModal. Returns the new uid.
//
// Body: { email, password, name?, phone?, role? }

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

function normalisePhone(p) {
  if (!p) return null;
  const digits = String(p).replace(/[^\d+]/g, "");
  if (!digits) return null;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return send(res, 405, { error: "method_not_allowed" });

  const limited = rateLimit(req, { key: "users-create", max: 30, windowMs: 60_000 });
  if (limited) {
    res.setHeader("Retry-After", String(limited.retryAfter));
    return send(res, 429, { error: "rate_limited", retryAfter: limited.retryAfter });
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

  const role = bodyRole === "vendor" ? "vendor" : "customer";

  try {
    const adminClient = getAdminClient();
    const phoneNumber = normalisePhone(phone);

    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name || "", phone: phoneNumber || "" },
    });

    if (error) {
      if (error.message?.includes("already")) return send(res, 409, { error: "email_already_exists" });
      return send(res, 400, { error: error.message });
    }

    // Mirror profile — trigger handles it on sign-in, but we guard the race window here.
    await adminClient.from("profiles").upsert({
      id: data.user.id,
      email,
      phone: phoneNumber || "",
      name: name || "",
      role,
      status: "active",
    });

    return send(res, 200, { uid: data.user.id, email, role });
  } catch (e) {
    return send(res, 500, { error: "create_failed", detail: e.message });
  }
}
