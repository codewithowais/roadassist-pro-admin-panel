-- ─────────────────────────────────────────────────────────────────────────────
-- 0013_fix_vendor_update_policy.sql
--
-- Fixes: vendors saving their profile from the app fails with
--   "more than one row returned by a subquery used as an expression" (SQLSTATE 21000).
--
-- Cause: the vendors UPDATE policy's WITH CHECK used subqueries
--   (SELECT kyc FROM public.vendors WHERE id = vendors.id)
-- where the inner `public.vendors` SHADOWS the outer row, so `vendors.id`
-- referenced the inner table → `WHERE id = id` matched EVERY row. With one
-- vendor it returned 1 row (worked); with many vendors it returns all of them
-- → error. Aliasing the inner table (v2) makes `vendors.id` correctly refer to
-- the row being updated.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "vendors_update_admin_or_own" ON public.vendors;

CREATE POLICY "vendors_update_admin_or_own" ON public.vendors FOR UPDATE
  USING (public.is_admin() OR auth_uid = auth.uid())
  WITH CHECK (
    public.is_admin()
    OR (
      -- Vendors can update their own profile but NOT trust fields.
      auth_uid = auth.uid()
      AND kyc          = (SELECT v2.kyc          FROM public.vendors v2 WHERE v2.id = vendors.id)
      AND status       = (SELECT v2.status       FROM public.vendors v2 WHERE v2.id = vendors.id)
      AND is_verified  = (SELECT v2.is_verified  FROM public.vendors v2 WHERE v2.id = vendors.id)
      AND rating       = (SELECT v2.rating       FROM public.vendors v2 WHERE v2.id = vendors.id)
      AND review_count = (SELECT v2.review_count FROM public.vendors v2 WHERE v2.id = vendors.id)
    )
  );
