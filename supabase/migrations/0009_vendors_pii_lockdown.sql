-- ─────────────────────────────────────────────────────────────────────────────
-- 0009_vendors_pii_lockdown.sql
--
-- ⚠️  DO NOT APPLY UNTIL BOTH ARE TRUE:
--     (a) 0008_security_hardening.sql has been applied (creates vendors_public), AND
--     (b) the updated mobile app build — which reads the customer vendor listing
--         from `vendors_public` instead of `vendors` — is LIVE in the stores /
--         on users' devices.
--
-- Why the gating: today any signed-in user (and, for verified vendors, even an
-- anonymous user) can `SELECT *` from `vendors` and read CNIC numbers, KYC
-- document paths, email and auth_uid. This migration removes that broad read and
-- restricts the base table to admins + the owning vendor. The customer listing
-- keeps working via the PII-free `vendors_public` view created in 0008.
--
-- If you apply this BEFORE the new app is live, the OLD app (still reading the
-- base `vendors` table) will show an empty vendor list to customers.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Lock base-table SELECT to admins and the owning vendor only ──────────────
DROP POLICY IF EXISTS "vendors_select_signed_in" ON public.vendors;
DROP POLICY IF EXISTS "vendors_select_anon"      ON public.vendors;

CREATE POLICY "vendors_select_admin_or_owner" ON public.vendors FOR SELECT
  USING (public.is_admin() OR auth_uid = auth.uid());

-- Anonymous users now read the public listing exclusively through vendors_public.
REVOKE SELECT ON public.vendors FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL — notification broadcast spam hardening.
-- Currently any authenticated user can INSERT a broadcast notification row
-- (user_id = '') that every user sees. Enabling the block below restricts
-- broadcasts to admins. LEFT COMMENTED because the SOS flow must be re-tested
-- first: confirm SOS still delivers peer alerts after this change before
-- enabling it in production.
-- ─────────────────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS "notifications_insert_own_or_admin" ON public.notifications;
-- CREATE POLICY "notifications_insert_own_or_admin" ON public.notifications FOR INSERT
--   WITH CHECK (
--     public.is_admin()
--     OR user_id = auth.uid()::text
--   );
