// Admin-only: ensure a vendor has a real Supabase Auth login account.
// Idempotent — if the vendor already has auth_uid, it just (re)asserts
// role='vendor'. Otherwise it creates the auth user, links vendors.auth_uid,
// and upserts a profiles row with role='vendor'.
//
// Used by:
//   - approveKYC (auto-provision on approval)
//   - the "Create Login" / bulk buttons in the Vendors tab
//
// Body: { vendorId, password? }  (password optional; seed vendors use Vendor@123)

import { createClient } from "@supabase/supabase-js";
import { verifyAdmin } from "../_lib/auth.js";
import { readJsonBody, send } from "../_lib/http.js";
import { rateLimit } from "../_lib/rate_limit.js";

const SEED_PASSWORD = "Vendor@123";

function getAdminClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// Mirror of getSeedCredentials() / seed-vendors-with-auth.mjs email format.
function seedEmail(v) {
  if (v.source !== "seed" || !v.seed_id) return null;
  const cat = (v.category || "vendor").toLowerCase();
  return `${cat}-karachi-${v.seed_id}@roadassist.test`;
}

async function findUserByEmail(admin, email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return (
    data?.users?.find((u) => (u.email || "").toLowerCase() === email.toLowerCase()) ||
    null
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return send(res, 405, { error: "method_not_allowed" });

  const limited = rateLimit(req, { key: "vendor-provision", max: 300, windowMs: 60_000 });
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
  // Account creation is a write action — read-only roles may not do it.
  const role = caller?.role || null;
  if (role === "viewer" || role === "support")
    return send(res, 403, { error: "insufficient_permissions" });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }
  const vendorId = body?.vendorId;
  if (!vendorId) return send(res, 400, { error: "vendorId_required" });

  const admin = getAdminClient();

  const { data: v, error: vErr } = await admin
    .from("vendors")
    .select("id, email, phone, name, category, source, seed_id, auth_uid")
    .eq("id", vendorId)
    .single();
  if (vErr || !v) return send(res, 404, { error: "vendor_not_found" });

  // Already linked — just make sure the profile role is correct.
  if (v.auth_uid) {
    await admin.from("profiles").update({ role: "vendor" }).eq("id", v.auth_uid);
    return send(res, 200, {
      uid: v.auth_uid,
      created: false,
      email: v.email || seedEmail(v),
    });
  }

  const email = (v.email && v.email.trim()) || seedEmail(v);
  if (!email) return send(res, 400, { error: "no_email_for_vendor" });
  const password =
    v.source === "seed" ? SEED_PASSWORD : (body.password || SEED_PASSWORD);

  // Create the auth user (or adopt an existing one with this email).
  let uid;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: v.name || "", phone: v.phone || "" },
  });
  if (!createErr) {
    uid = created.user.id;
  } else if (/already|exists/i.test(createErr.message || "")) {
    const existing = await findUserByEmail(admin, email);
    if (!existing) return send(res, 409, { error: "email_exists_unresolved" });
    uid = existing.id;
  } else {
    return send(res, 400, { error: createErr.message });
  }

  // Link the vendor row and ensure a vendor profile.
  await admin.from("vendors").update({ auth_uid: uid }).eq("id", v.id);
  await admin.from("profiles").upsert(
    {
      id: uid,
      email,
      name: v.name || "",
      phone: v.phone || "",
      role: "vendor",
      status: "active",
    },
    { onConflict: "id" },
  );

  return send(res, 200, { uid, created: !createErr, email, password });
}
