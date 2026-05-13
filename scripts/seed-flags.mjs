// Seeds app_config row (id='flags') with default feature flags.
// Idempotent — re-running merges new keys.
//   node --env-file=.env scripts/seed-flags.mjs

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEFAULT_FLAGS = {
  vendorSelfRegistration: true,
  vendorAppEnabled: true,
  kycStrict: true,
  liveLocationTracking: true,
  simulatedTrackingFallback: false,
  autoNotifyVendorOnRequest: true,
  fcmPushEnabled: true,
  smsNotifications: false,
  whatsappNotifications: false,
  sosEnabled: true,
  reviewsEnabled: true,
  paymentCollection: false,
  aiAssistantEnabled: true,
  autoCompleteOnArrived: true,
  maxActiveJobsPerVendor: 1,
  urgentThresholdMinutes: 5,
  appUnderMaintenance: false,
  maintenanceMessage: "",
};

// Read existing flags and merge (don't overwrite admin customisations)
const { data: existing } = await supabase
  .from("app_config")
  .select("data")
  .eq("id", "flags")
  .single();

const merged = { ...DEFAULT_FLAGS, ...(existing?.data || {}) };

const { error } = await supabase.from("app_config").upsert({
  id: "flags",
  data: merged,
  updated_at: new Date().toISOString(),
});

if (error) {
  console.error("❌ Seed failed:", error.message);
  process.exit(1);
}

console.log("✅ app_config/flags seeded:", Object.keys(merged).length, "flags");
process.exit(0);
