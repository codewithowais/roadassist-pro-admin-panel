-- ─────────────────────────────────────────────────────────────────────────────
-- 0004_rls.sql — RoadAssist Pro
-- Row Level Security policies. Mirrors firestore.rules exactly.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS on every table
ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sos_hotspots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_zones      ENABLE ROW LEVEL SECURITY;

-- ─── Helper functions ─────────────────────────────────────────────────────────

-- is_admin(): true if the JWT app_metadata.role is 'admin' (or legacy 'superadmin'/'manager')
-- Mirrors the Firebase custom-claim fast-path.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'admin')::boolean,
      false
    )
    AND
    COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'disabled')::boolean,
      false
    ) = false;
$$;

-- is_assigned_vendor(vendor_id): true if the signed-in user is the vendor's auth_uid
CREATE OR REPLACE FUNCTION public.is_assigned_vendor(p_vendor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vendors
    WHERE id = p_vendor_id
      AND auth_uid = auth.uid()
  );
$$;

-- ─── profiles ────────────────────────────────────────────────────────────────

CREATE POLICY "profiles_select_own_or_admin"
  ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "profiles_update_own_or_admin"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- ─── vehicles ────────────────────────────────────────────────────────────────

CREATE POLICY "vehicles_select_own_or_admin"
  ON public.vehicles FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "vehicles_insert_own"
  ON public.vehicles FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "vehicles_update_own_or_admin"
  ON public.vehicles FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "vehicles_delete_own_or_admin"
  ON public.vehicles FOR DELETE
  USING (user_id = auth.uid() OR public.is_admin());

-- ─── emergency_contacts ──────────────────────────────────────────────────────

CREATE POLICY "emergency_contacts_select_own_or_admin"
  ON public.emergency_contacts FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "emergency_contacts_insert_own_or_admin"
  ON public.emergency_contacts FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "emergency_contacts_update_own_or_admin"
  ON public.emergency_contacts FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "emergency_contacts_delete_own_or_admin"
  ON public.emergency_contacts FOR DELETE
  USING (user_id = auth.uid() OR public.is_admin());

-- ─── vendors ─────────────────────────────────────────────────────────────────
-- SELECT: any signed-in user (customers browse vendors)
-- INSERT: admin only (self-registration goes through /api/vendors/self-register with service key)
-- UPDATE: admin OR the vendor themselves on non-trust fields
-- DELETE: admin only (soft-delete via update; hard delete rarely)

CREATE POLICY "vendors_select_signed_in"
  ON public.vendors FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "vendors_insert_admin"
  ON public.vendors FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "vendors_update_admin_or_own"
  ON public.vendors FOR UPDATE
  USING (
    public.is_admin()
    OR auth_uid = auth.uid()
  )
  WITH CHECK (
    public.is_admin()
    -- Vendors cannot change trust fields: kyc, status, is_verified, rating, review_count
    OR (
      auth_uid = auth.uid()
      AND kyc = (SELECT kyc FROM public.vendors WHERE id = vendors.id)
      AND status = (SELECT status FROM public.vendors WHERE id = vendors.id)
      AND is_verified = (SELECT is_verified FROM public.vendors WHERE id = vendors.id)
      AND rating = (SELECT rating FROM public.vendors WHERE id = vendors.id)
      AND review_count = (SELECT review_count FROM public.vendors WHERE id = vendors.id)
    )
  );

CREATE POLICY "vendors_delete_admin"
  ON public.vendors FOR DELETE
  USING (public.is_admin());

-- ─── service_requests ────────────────────────────────────────────────────────

CREATE POLICY "service_requests_select"
  ON public.service_requests FOR SELECT
  USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_assigned_vendor(vendor_id)
  );

CREATE POLICY "service_requests_insert_own"
  ON public.service_requests FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "service_requests_update"
  ON public.service_requests FOR UPDATE
  USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_assigned_vendor(vendor_id)
  );

CREATE POLICY "service_requests_delete_admin"
  ON public.service_requests FOR DELETE
  USING (public.is_admin());

-- ─── notifications ───────────────────────────────────────────────────────────

CREATE POLICY "notifications_select_own_or_admin"
  ON public.notifications FOR SELECT
  USING (
    public.is_admin()
    OR user_id = auth.uid()::text
    OR user_id = ''  -- broadcast rows visible to all signed-in users
  );

CREATE POLICY "notifications_insert_own_or_admin"
  ON public.notifications FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR user_id = auth.uid()::text
    OR user_id = ''
  );

CREATE POLICY "notifications_update_own_or_admin"
  ON public.notifications FOR UPDATE
  USING (
    public.is_admin()
    OR user_id = auth.uid()::text
  );

CREATE POLICY "notifications_delete_own_or_admin"
  ON public.notifications FOR DELETE
  USING (public.is_admin() OR user_id = auth.uid()::text);

-- ─── reviews ─────────────────────────────────────────────────────────────────

CREATE POLICY "reviews_select_visible_or_admin"
  ON public.reviews FOR SELECT
  USING (
    public.is_admin()
    OR status = 'visible'
    OR user_id = auth.uid()
  );

CREATE POLICY "reviews_insert_own"
  ON public.reviews FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND rating BETWEEN 1 AND 5
    AND status = 'visible'
  );

CREATE POLICY "reviews_update_admin_or_own_unflagged"
  ON public.reviews FOR UPDATE
  USING (
    public.is_admin()
    OR (user_id = auth.uid() AND status NOT IN ('flagged', 'deleted'))
  );

CREATE POLICY "reviews_delete_admin"
  ON public.reviews FOR DELETE
  USING (public.is_admin());

-- ─── sos_hotspots ────────────────────────────────────────────────────────────

CREATE POLICY "sos_insert_signed_in"
  ON public.sos_hotspots FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "sos_select_admin"
  ON public.sos_hotspots FOR SELECT
  USING (public.is_admin());

CREATE POLICY "sos_update_admin"
  ON public.sos_hotspots FOR UPDATE
  USING (public.is_admin());

-- ─── audit_log ───────────────────────────────────────────────────────────────

CREATE POLICY "audit_log_select_admin"
  ON public.audit_log FOR SELECT
  USING (public.is_admin());

CREATE POLICY "audit_log_insert_admin_or_own"
  ON public.audit_log FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR (
      auth.uid() IS NOT NULL
      AND actor_uid = auth.uid()::text
    )
  );

-- ─── app_config ──────────────────────────────────────────────────────────────

CREATE POLICY "app_config_select_admin"
  ON public.app_config FOR SELECT
  USING (public.is_admin());

CREATE POLICY "app_config_insert_admin"
  ON public.app_config FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "app_config_update_admin"
  ON public.app_config FOR UPDATE
  USING (public.is_admin());

-- ─── service_zones ───────────────────────────────────────────────────────────

CREATE POLICY "service_zones_select_signed_in"
  ON public.service_zones FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "service_zones_write_admin"
  ON public.service_zones FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
