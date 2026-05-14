-- ============================================================
-- RoadAssist Pro — Bug Fixes
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Expand profiles.role CHECK to include all admin sub-roles
--    (currently only allows 'customer','vendor','admin' — blocks manager/support/viewer)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer','vendor','admin','superadmin','manager','support','viewer'));

-- 2. Fix app_config RLS — allow all authenticated users to read 'flags' row
--    (Flutter app needs feature flags; previous policy was admin-only)
DROP POLICY IF EXISTS "app_config_select_admin" ON public.app_config;
DROP POLICY IF EXISTS "app_config_select_auth"  ON public.app_config;

CREATE POLICY "app_config_select_auth" ON public.app_config FOR SELECT
  USING (
    public.is_admin()
    OR (auth.uid() IS NOT NULL AND id = 'flags')
  );

-- 3. Also allow reading 'main' config (app name, support contacts) for logged-in users
DROP POLICY IF EXISTS "app_config_select_main_auth" ON public.app_config;
CREATE POLICY "app_config_select_main_auth" ON public.app_config FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Verify
SELECT id, updated_at FROM public.app_config;
SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated');
