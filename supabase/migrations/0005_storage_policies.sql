-- ─────────────────────────────────────────────────────────────────────────────
-- 0005_storage_policies.sql — RoadAssist Pro
-- Storage policies are intentionally empty.
-- Vendor KYC documents are stored in Cloudflare R2, not Supabase Storage.
-- See admin-panel/api/_lib/r2.js for the R2 integration.
-- ─────────────────────────────────────────────────────────────────────────────

-- No Supabase Storage buckets required for this project.
-- If a future feature uses Supabase Storage, add bucket creation and
-- storage policies here.
SELECT 'storage_policies: no-op — files live in Cloudflare R2' AS note;
