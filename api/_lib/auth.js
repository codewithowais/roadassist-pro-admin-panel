// Verifies Supabase JWT from Bearer token.
// Replaces Firebase Admin SDK verifyIdToken() with Supabase's getUser().
//
// Fast path: app_metadata.admin === true in the JWT (set by set-admin-roles.mjs).
// No database round-trip needed — the claim rides in the JWT.

import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const err = new Error("server_misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    err.status = 500;
    throw err;
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function verifyAdmin(req) {
  let adminClient;
  try {
    adminClient = getAdminClient();
  } catch (e) {
    throw e;
  }

  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    const err = new Error("missing bearer token");
    err.status = 401;
    throw err;
  }

  const { data: { user }, error } = await adminClient.auth.getUser(m[1].trim());
  if (error || !user) {
    const err = new Error(`invalid_token: ${error?.message || "unknown"}`);
    err.status = 401;
    throw err;
  }

  const meta = user.app_metadata || {};

  // Fast path: trust the app_metadata claim stamped by set-admin-roles.mjs
  if (meta.admin === true && meta.disabled !== true) {
    return { uid: user.id, email: user.email, role: meta.role, claims: meta };
  }

  // Slow path: check profiles table (for admins whose JWT hasn't refreshed yet)
  try {
    const { data: profile, error: dbError } = await adminClient
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .single();

    if (dbError || !profile) {
      const err = new Error("not an admin");
      err.status = 403;
      throw err;
    }
    const adminRoles = ["admin", "superadmin", "manager", "support", "viewer"];
    if (!adminRoles.includes(profile.role)) {
      const err = new Error("not an admin");
      err.status = 403;
      throw err;
    }
    if (profile.status === "blocked") {
      const err = new Error("admin disabled");
      err.status = 403;
      throw err;
    }
    return { uid: user.id, email: user.email, role: profile.role, claims: meta };
  } catch (e) {
    if (e.status) throw e;
    const err = new Error(`admin_check_failed: ${e.message || "unknown"}`);
    err.status = 503;
    throw err;
  }
}
