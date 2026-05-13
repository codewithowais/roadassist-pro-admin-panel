-- ─────────────────────────────────────────────────────────────────────────────
-- seed.sql — RoadAssist Pro
-- Default data: feature flags and app config singleton rows.
-- Run after migrations: supabase db reset  OR  psql ... < seed.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Default feature flags (mirrors DEFAULT_FLAGS in firebase.js)
INSERT INTO public.app_config (id, data, updated_at)
VALUES (
  'flags',
  '{
    "vendorSelfRegistration": true,
    "vendorAppEnabled": true,
    "kycStrict": true,
    "liveLocationTracking": true,
    "simulatedTrackingFallback": false,
    "autoNotifyVendorOnRequest": true,
    "fcmPushEnabled": true,
    "smsNotifications": false,
    "whatsappNotifications": false,
    "sosEnabled": true,
    "reviewsEnabled": true,
    "paymentCollection": false,
    "aiAssistantEnabled": true,
    "autoCompleteOnArrived": true,
    "maxActiveJobsPerVendor": 1,
    "appUnderMaintenance": false,
    "maintenanceMessage": ""
  }'::jsonb,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  data       = EXCLUDED.data,
  updated_at = now();

-- Default app config
INSERT INTO public.app_config (id, data, updated_at)
VALUES (
  'main',
  '{
    "appName": "RoadAssist Pro",
    "supportPhone": "",
    "supportEmail": "",
    "termsUrl": "",
    "privacyUrl": ""
  }'::jsonb,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  updated_at = now();
