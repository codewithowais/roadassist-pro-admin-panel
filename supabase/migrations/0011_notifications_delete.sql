-- ─────────────────────────────────────────────────────────────────────────────
-- 0011_notifications_delete.sql  — SAFE to apply now.
--
-- The app lets a user delete a notification from their inbox, but the schema
-- never granted DELETE on `notifications` (only SELECT/INSERT/UPDATE) and had no
-- DELETE RLS policy — so every delete silently failed. This adds both, scoped to
-- the owner (or an admin).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "notifications_delete_own_or_admin" ON public.notifications;

CREATE POLICY "notifications_delete_own_or_admin" ON public.notifications FOR DELETE
  USING (public.is_admin() OR user_id = auth.uid()::text);

GRANT DELETE ON public.notifications TO authenticated;
