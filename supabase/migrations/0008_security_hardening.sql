-- ─────────────────────────────────────────────────────────────────────────────
-- 0008_security_hardening.sql
--
-- SAFE TO APPLY IMMEDIATELY. This migration is additive / behaviour-preserving
-- for the currently deployed apps:
--   1. Reconciles is_admin() to a single authoritative definition (removes the
--      JWT-vs-DB-lookup ambiguity between schema.sql and 0004_rls.sql).
--   2. Authorizes accept_service_request() so only the vendor the job was
--      directed to can accept it (was: any authenticated user with the UUID).
--   3. Creates the public-safe `vendors_public` view (no CNIC / documents /
--      email / auth_uid) and grants read access. The base `vendors` table is
--      NOT locked down here — that happens in 0009 AFTER the mobile app is
--      redeployed to read from this view.
--
-- Apply order: 0008 now  →  rebuild & deploy mobile app (reads vendors_public)
--              →  0009 (locks the base table).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Authoritative is_admin() (DB-lookup; matches schema.sql) ───────────────
-- Determinate definition so RLS authorization no longer depends on which
-- migration ran last. All admin-tier roles resolve via profiles.role.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin','superadmin','manager','support','viewer')
      AND status = 'active'
      AND deleted_at IS NULL
  );
$$;

-- ── 2. Authorize accept_service_request() ────────────────────────────────────
-- A service_request targets exactly one vendor_id. Only that vendor (the auth
-- user linked to the vendor row via auth_uid) may accept it. Prevents any
-- authenticated user from hijacking a job by guessing its UUID.
CREATE OR REPLACE FUNCTION public.accept_service_request(
  p_request_id    uuid,
  p_mechanic_name text,
  p_mechanic_vehicle text,
  p_mechanic_rating double precision,
  p_mechanic_phone text DEFAULT '',
  p_eta_minutes   integer DEFAULT NULL,
  p_mechanic_lat  double precision DEFAULT NULL,
  p_mechanic_lng  double precision DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status text;
  v_vendor_id      uuid;
BEGIN
  -- Lock the row for update to prevent concurrent accepts
  SELECT status, vendor_id INTO v_current_status, v_vendor_id
  FROM public.service_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: request % does not exist', p_request_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Caller must be the vendor this request was directed to.
  IF NOT public.is_assigned_vendor(v_vendor_id) THEN
    RAISE EXCEPTION 'not_authorized: caller is not the assigned vendor'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_current_status != 'requested' THEN
    RAISE EXCEPTION 'not_requested: request is already %, cannot accept', v_current_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.service_requests SET
    status           = 'accepted',
    accepted_at      = now(),
    mechanic_name    = p_mechanic_name,
    mechanic_vehicle = p_mechanic_vehicle,
    mechanic_rating  = p_mechanic_rating,
    mechanic_phone   = p_mechanic_phone,
    eta_minutes      = COALESCE(p_eta_minutes, eta_minutes),
    mechanic_lat     = COALESCE(p_mechanic_lat, mechanic_lat),
    mechanic_lng     = COALESCE(p_mechanic_lng, mechanic_lng),
    updated_at       = now()
  WHERE id = p_request_id;
END;
$$;

-- ── 3. Public-safe vendor view (no PII) ──────────────────────────────────────
-- Exposes only non-sensitive columns of verified, non-deleted vendors. EXCLUDES
-- auth_uid, email, cnic_number, vehicle_reg, documents, kyc / kyc_rejected_reason,
-- application_id, seed_id, agreed_to_terms and all deleted_* fields.
-- Runs with the view owner's privileges, so it returns the public listing
-- regardless of the caller's RLS on the base table.
CREATE OR REPLACE VIEW public.vendors_public
WITH (security_barrier = true) AS
  SELECT
    id, name, business_name, owner_name, category, city, area,
    lat, lng, phone, whatsapp, cost_range, rating, review_count,
    is_open, is_verified, status, source, description, operating_hours,
    address, current_lat, current_lng, last_seen_at, verified_at,
    created_at, updated_at
  FROM public.vendors
  WHERE is_verified = true
    AND deleted_at IS NULL;

GRANT SELECT ON public.vendors_public TO anon, authenticated;
