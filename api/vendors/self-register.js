// Public endpoint: vendor self-registration.
// Inserts into vendors table using the service-role key because RLS
// does not allow unauthenticated direct inserts.
// Rate-limited to 10 req/min/IP to limit abuse.
//
// Body: same shape as vendor self-registration form
// No auth required — public endpoint.

import { createClient } from "@supabase/supabase-js";
import { readJsonBody, send } from "../_lib/http.js";
import { rateLimit } from "../_lib/rate_limit.js";

const VALID_CATEGORIES = new Set(["Mechanic", "Fuel", "Tyre", "Battery", "Accident", "Towing"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getAdminClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return send(res, 405, { error: "method_not_allowed" });

  const limited = rateLimit(req, { key: "vendor-self-register", max: 10, windowMs: 60_000 });
  if (limited) {
    res.setHeader("Retry-After", String(limited.retryAfter));
    return send(res, 429, { error: "rate_limited", retryAfter: limited.retryAfter });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }

  const {
    name, businessName, ownerName, category, city, area, lat, lng, phone,
    whatsapp, email, cnicNumber, vehicleReg, description, operatingHours,
    applicationId, agreedToTerms, documents,
  } = body || {};

  // Validation
  if (!name || typeof name !== "string" || name.length < 2)
    return send(res, 400, { error: "invalid_name" });
  if (!category || !VALID_CATEGORIES.has(category))
    return send(res, 400, { error: "invalid_category" });
  if (!city || typeof city !== "string")
    return send(res, 400, { error: "invalid_city" });
  if (!phone || typeof phone !== "string")
    return send(res, 400, { error: "invalid_phone" });
  if (applicationId && !UUID_RE.test(applicationId))
    return send(res, 400, { error: "invalid_application_id" });
  if (!agreedToTerms)
    return send(res, 400, { error: "must_agree_to_terms" });

  try {
    const adminClient = getAdminClient();
    const { data, error } = await adminClient.from("vendors").insert({
      name,
      business_name: businessName || name,
      owner_name: ownerName || null,
      category,
      city,
      area: area || null,
      lat: typeof lat === "number" ? lat : 0,
      lng: typeof lng === "number" ? lng : 0,
      phone,
      whatsapp: whatsapp || null,
      email: email || null,
      cnic_number: cnicNumber || null,
      vehicle_reg: vehicleReg || null,
      description: description || null,
      operating_hours: operatingHours || null,
      application_id: applicationId || null,
      agreed_to_terms: Boolean(agreedToTerms),
      documents: documents || null,
      status: "pending",
      kyc: "pending",
      is_verified: false,
      is_open: false,
      rating: 0,
      review_count: 0,
      source: "self_registration",
      deleted_at: null,
    }).select("id").single();

    if (error) {
      return send(res, 500, { error: "registration_failed", detail: error.message });
    }

    return send(res, 200, { id: data.id, status: "pending" });
  } catch (e) {
    return send(res, 500, { error: "registration_failed", detail: e.message });
  }
}
