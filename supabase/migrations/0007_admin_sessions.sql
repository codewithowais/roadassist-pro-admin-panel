-- ─────────────────────────────────────────────────────────────────────────────
-- 0007_admin_sessions.sql — RoadAssist Pro
-- Tracks active admin login sessions for "logged in devices" feature.
-- Supports remote sign-out from any device and 24-hour session expiry.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name     text        NOT NULL DEFAULT '',
  device_os       text        NOT NULL DEFAULT '',
  browser         text        NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_active_at  timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  revoked_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id
  ON public.admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires
  ON public.admin_sessions(expires_at);

ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_sessions_select_own"
  ON public.admin_sessions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "admin_sessions_insert_own"
  ON public.admin_sessions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "admin_sessions_update_own"
  ON public.admin_sessions FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "admin_sessions_delete_own"
  ON public.admin_sessions FOR DELETE
  USING (user_id = auth.uid());

COMMENT ON TABLE public.admin_sessions IS
  'Active admin login sessions. Supports 24h expiry and remote sign-out.';
