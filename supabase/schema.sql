-- ============================================================
-- RoadAssist Pro — Complete Supabase Schema
-- Combines migrations 0001–0006 + grants + realtime + seed
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- Helper: auto-bump updated_at on every UPDATE
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 1. PROFILES  (mirrors auth.users 1-to-1)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id               uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone            text        NOT NULL DEFAULT '',
  name             text        NOT NULL DEFAULT '',
  photo_url        text        NOT NULL DEFAULT '',
  email            text        NOT NULL DEFAULT '',
  role             text        NOT NULL DEFAULT 'customer'
                               CHECK (role IN ('customer','vendor','admin','superadmin','manager','support','viewer')),
  vendor_id        uuid,
  status           text        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','blocked')),
  blocked_reason   text,
  blocked_at       timestamptz,
  blocked_by       text,
  blocked_by_email text,
  total_jobs       integer     NOT NULL DEFAULT 0,
  vehicle_type     text        NOT NULL DEFAULT 'car',
  ai_enabled       boolean     NOT NULL DEFAULT false,
  fcm_token        text,
  token_updated_at timestamptz,
  deleted_at       timestamptz,
  deleted_by       text,
  deleted_by_email text,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- is_admin() — defined AFTER profiles table exists
-- DB-lookup approach: checks profiles.role so it works immediately
-- after setting role = 'admin' with no JWT refresh required.
-- ─────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────
-- 2. VEHICLES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vehicle_type        text        NOT NULL CHECK (vehicle_type IN ('car','bike')),
  make                text        NOT NULL DEFAULT '',
  model               text        NOT NULL DEFAULT '',
  year                integer     NOT NULL DEFAULT 2020
                                  CHECK (year BETWEEN 1885 AND 2030),
  color               text        NOT NULL DEFAULT '',
  registration_number text        NOT NULL DEFAULT '',
  fuel_type           text        NOT NULL DEFAULT 'petrol'
                                  CHECK (fuel_type IN ('petrol','diesel','electric','cng')),
  is_primary          boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_vehicles_updated_at
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. EMERGENCY CONTACTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       text        NOT NULL DEFAULT '',
  phone      text        NOT NULL DEFAULT '',
  linked_uid uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  linked_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_emergency_contacts_updated_at
  BEFORE UPDATE ON public.emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 4. VENDORS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendors (
  id                  uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid            uuid             REFERENCES auth.users(id) ON DELETE SET NULL,
  name                text             NOT NULL DEFAULT '',
  business_name       text,
  owner_name          text,
  category            text             NOT NULL
                                       CHECK (category IN ('Mechanic','Fuel','Tyre','Battery','Accident','Towing')),
  city                text             NOT NULL DEFAULT '',
  area                text,
  lat                 double precision NOT NULL DEFAULT 0,
  lng                 double precision NOT NULL DEFAULT 0,
  phone               text             NOT NULL DEFAULT '',
  whatsapp            text,
  email               text,
  cost_range          text,
  rating              double precision NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  review_count        integer          NOT NULL DEFAULT 0,
  is_open             boolean          NOT NULL DEFAULT false,
  is_verified         boolean          NOT NULL DEFAULT false,
  kyc                 text             NOT NULL DEFAULT 'pending'
                                       CHECK (kyc IN ('pending','approved','rejected')),
  kyc_rejected_reason text,
  status              text             NOT NULL DEFAULT 'pending'
                                       CHECK (status IN ('pending','verified','rejected')),
  source              text             NOT NULL DEFAULT 'seed'
                                       CHECK (source IN ('seed','self_registration')),
  documents           jsonb,
  cnic_number         text,
  vehicle_reg         text,
  description         text,
  operating_hours     text,
  application_id      text,
  seed_id             text             UNIQUE,
  agreed_to_terms     boolean,
  address             text,
  current_lat         double precision,
  current_lng         double precision,
  last_seen_at        timestamptz,
  verified_at         timestamptz,
  deleted_at          timestamptz,
  deleted_by          text,
  deleted_by_email    text,
  created_at          timestamptz      NOT NULL DEFAULT now(),
  updated_at          timestamptz      NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- is_assigned_vendor — defined AFTER vendors table exists (SQL functions validate at creation time)
CREATE OR REPLACE FUNCTION public.is_assigned_vendor(p_vendor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vendors
    WHERE id = p_vendor_id
      AND auth_uid = auth.uid()
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. SERVICE REQUESTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_requests (
  id                   uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid             NOT NULL REFERENCES public.profiles(id),
  vendor_id            uuid             NOT NULL REFERENCES public.vendors(id),
  vendor_name          text             NOT NULL DEFAULT '',
  category             text             NOT NULL
                                        CHECK (category IN ('Mechanic','Fuel','Tyre','Battery','Accident','Towing')),
  status               text             NOT NULL DEFAULT 'requested'
                                        CHECK (status IN ('requested','accepted','onTheWay','arrived','completed','cancelled')),
  user_lat             double precision NOT NULL DEFAULT 0,
  user_lng             double precision NOT NULL DEFAULT 0,
  eta_minutes          integer          NOT NULL DEFAULT 0,
  mechanic_name        text             NOT NULL DEFAULT '',
  mechanic_phone       text             NOT NULL DEFAULT '',
  mechanic_rating      double precision NOT NULL DEFAULT 0,
  mechanic_vehicle     text             NOT NULL DEFAULT '',
  mechanic_lat         double precision,
  mechanic_lng         double precision,
  mechanic_location_at timestamptz,
  estimated_cost       double precision,
  cancelled_by         text             NOT NULL DEFAULT '',
  cancel_reason        text             NOT NULL DEFAULT '',
  requested_at         timestamptz,
  accepted_at          timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz      NOT NULL DEFAULT now(),
  updated_at           timestamptz      NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_service_requests_updated_at
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 6. NOTIFICATIONS
-- user_id is text — empty string '' = broadcast to everyone
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        text        NOT NULL DEFAULT '',
  type           text        NOT NULL
                             CHECK (type IN ('serviceUpdate','sosAlert','ratingNudge','systemInfo',
                                            'nearbyVendor','broadcast','targeted')),
  title          text        NOT NULL DEFAULT '',
  body           text        NOT NULL DEFAULT '',
  is_read        boolean     NOT NULL DEFAULT false,
  action_route   text,
  action_payload text,
  sender_uid     text,
  sender_name    text,
  lat            double precision,
  lng            double precision,
  topic          text,
  target_token   text,
  sent_by        text,
  sent_at        timestamptz,
  status_label   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 7. REVIEWS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reviews (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES public.profiles(id),
  user_name        text        NOT NULL DEFAULT '',
  request_id       uuid        REFERENCES public.service_requests(id),
  vendor_id        uuid        NOT NULL REFERENCES public.vendors(id),
  vendor_name      text        NOT NULL DEFAULT '',
  rating           integer     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text             text,
  tags             text[],
  status           text        NOT NULL DEFAULT 'visible'
                               CHECK (status IN ('visible','flagged','deleted')),
  deleted_at       timestamptz,
  deleted_by       text,
  deleted_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 8. SOS HOTSPOTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_hotspots (
  id                uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text             NOT NULL DEFAULT 'anonymous',
  user_name         text,
  user_email        text,
  lat               double precision NOT NULL DEFAULT 0,
  lng               double precision NOT NULL DEFAULT 0,
  accuracy          double precision,
  contacts_notified integer          NOT NULL DEFAULT 0,
  app_users_pushed  integer          NOT NULL DEFAULT 0,
  recipients        jsonb,
  resolved          boolean          NOT NULL DEFAULT false,
  resolved_at       timestamptz,
  resolved_by       text,
  created_at        timestamptz      NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 9. AUDIT LOG
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text        NOT NULL,
  actor_type  text        NOT NULL DEFAULT 'admin'
                          CHECK (actor_type IN ('admin','customer','vendor','system')),
  actor_uid   text        NOT NULL DEFAULT 'unknown',
  actor_name  text        NOT NULL DEFAULT '',
  actor_email text,
  admin_uid   text,
  admin_name  text,
  entity_type text        NOT NULL DEFAULT '',
  entity_id   text        NOT NULL DEFAULT '',
  entity_name text,
  details     jsonb,
  device      jsonb,
  timestamp   timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 10. APP CONFIG  (singleton: id='main' and id='flags')
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_config (
  id         text        PRIMARY KEY,
  data       jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 11. SERVICE ZONES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_zones (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL DEFAULT '' UNIQUE,
  coverage          text        NOT NULL DEFAULT 'high'
                                CHECK (coverage IN ('high','medium','low')),
  avg_response_mins integer     NOT NULL DEFAULT 0,
  vendor_count      integer     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_service_zones_updated_at
  BEFORE UPDATE ON public.service_zones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- INDEXES (from 0002_indexes.sql)
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_vendors_category_verified
  ON public.vendors(category, is_verified);
CREATE INDEX IF NOT EXISTS idx_vendors_category_verified_rating
  ON public.vendors(category, is_verified, rating DESC);
CREATE INDEX IF NOT EXISTS idx_vendors_auth_uid
  ON public.vendors(auth_uid);
CREATE INDEX IF NOT EXISTS idx_vendors_deleted_at
  ON public.vendors(deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_requests_user_requested
  ON public.service_requests(user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_requests_vendor_status_requested
  ON public.service_requests(vendor_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_requests_vendor_requested
  ON public.service_requests(vendor_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_requests_status
  ON public.service_requests(status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
  ON public.notifications(user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_vendor_status_created
  ON public.reviews(vendor_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_user_created
  ON public.reviews(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_status
  ON public.reviews(status);

CREATE INDEX IF NOT EXISTS idx_sos_hotspots_resolved_created
  ON public.sos_hotspots(resolved, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_type_ts
  ON public.audit_log(actor_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type_ts
  ON public.audit_log(entity_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_uid_ts
  ON public.audit_log(actor_uid, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_phone       ON public.profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_role        ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_status      ON public.profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at  ON public.profiles(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id     ON public.vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_ec_user_id           ON public.emergency_contacts(user_id);

-- ─────────────────────────────────────────────────────────────
-- TRIGGER FUNCTIONS (from 0003_triggers.sql)
-- ─────────────────────────────────────────────────────────────

-- Recompute vendor rating after any review change
CREATE OR REPLACE FUNCTION public.recompute_vendor_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_vendor_id uuid;
  v_avg       double precision;
  v_count     integer;
BEGIN
  v_vendor_id := COALESCE(NEW.vendor_id, OLD.vendor_id);
  SELECT COALESCE(AVG(rating), 0), COUNT(*)
    INTO v_avg, v_count
    FROM public.reviews
   WHERE vendor_id = v_vendor_id AND status = 'visible';
  UPDATE public.vendors
     SET rating       = ROUND(v_avg::numeric, 2),
         review_count = v_count,
         updated_at   = now()
   WHERE id = v_vendor_id;
  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$$;

CREATE OR REPLACE TRIGGER trg_reviews_recompute_vendor_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.recompute_vendor_rating();

-- Enforce exactly one primary vehicle per user
CREATE OR REPLACE FUNCTION public.enforce_single_primary_vehicle()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.is_primary = true THEN
    UPDATE public.vehicles
       SET is_primary = false, updated_at = now()
     WHERE user_id = NEW.user_id
       AND id <> NEW.id
       AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_vehicles_single_primary
  BEFORE INSERT OR UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_primary_vehicle();

-- Max 5 emergency contacts per user
CREATE OR REPLACE FUNCTION public.max_emergency_contacts_5()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.emergency_contacts WHERE user_id = NEW.user_id;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'max_emergency_contacts_exceeded'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_emergency_contacts_max_5
  BEFORE INSERT ON public.emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION public.max_emergency_contacts_5();

-- KYC state machine: approving a vendor auto-sets is_verified + verified_at
CREATE OR REPLACE FUNCTION public.enforce_kyc_state_machine()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kyc = 'approved' AND (OLD.kyc IS DISTINCT FROM 'approved') THEN
    NEW.status      := 'verified';
    NEW.is_verified := true;
    NEW.verified_at := now();
  END IF;
  IF NEW.kyc = 'rejected' AND (OLD.kyc IS DISTINCT FROM 'rejected') THEN
    NEW.status      := 'rejected';
    NEW.is_verified := false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_vendors_kyc_state_machine
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_kyc_state_machine();

-- Mirror auth.users → profiles on sign-up
-- Hardcodes role='customer' — prevents users from injecting role via signup metadata
CREATE OR REPLACE FUNCTION public.mirror_auth_to_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, name, phone, role, status,
    created_at, updated_at, last_login_at
  ) VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    'customer',    -- always customer on sign-up; admin sets role manually
    'active',
    now(), now(), now()
  )
  ON CONFLICT (id) DO UPDATE SET
    last_login_at = now(),
    updated_at    = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_auth_users_mirror_to_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.mirror_auth_to_profile();

-- Audit log writer for key table changes
CREATE OR REPLACE FUNCTION public.audit_log_writer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_action    text;
  v_entity_id text;
  v_actor_uid text;
BEGIN
  v_action    := TG_TABLE_NAME || '_' || lower(TG_OP);
  v_entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  v_actor_uid := COALESCE(auth.uid()::text, 'system');
  INSERT INTO public.audit_log (action, actor_type, actor_uid, entity_type, entity_id, timestamp)
  VALUES (
    v_action,
    CASE WHEN v_actor_uid = 'system' THEN 'system' ELSE 'admin' END,
    v_actor_uid, TG_TABLE_NAME, v_entity_id, now()
  );
  RETURN NULL;  -- AFTER trigger
END;
$$;

CREATE OR REPLACE TRIGGER trg_vendors_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_writer();

CREATE OR REPLACE TRIGGER trg_service_requests_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_writer();

CREATE OR REPLACE TRIGGER trg_reviews_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_writer();

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — enable on all tables
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- GRANTS — required for anon/authenticated to access tables
-- via PostgREST (supabase-js). RLS still controls row access.
-- ─────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- anon: only verified vendors (for unauthenticated browsing / self-reg page)
GRANT SELECT ON public.vendors TO anon;

-- authenticated: full table access — RLS handles row-level restrictions
GRANT SELECT, INSERT, UPDATE ON public.profiles          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emergency_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.vendors           TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.service_requests  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notifications     TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reviews           TO authenticated;
GRANT SELECT, INSERT ON public.sos_hotspots              TO authenticated;
GRANT SELECT, INSERT ON public.audit_log                 TO authenticated;
GRANT SELECT ON public.app_config                        TO authenticated;
GRANT SELECT ON public.service_zones                     TO authenticated;

-- Function execution grants
GRANT EXECUTE ON FUNCTION public.is_admin()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assigned_vendor(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- RLS POLICIES (from 0004_rls.sql + fixes)
-- DROP IF EXISTS makes this safe to re-run
-- ─────────────────────────────────────────────────────────────

-- ── PROFILES ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_select_own_or_admin"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own_or_admin"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own"           ON public.profiles;

CREATE POLICY "profiles_select_own_or_admin" ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.is_admin());

-- WITH CHECK prevents users from escalating their own role or unblocking themselves
CREATE POLICY "profiles_update_own_or_admin" ON public.profiles FOR UPDATE
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (
    public.is_admin()
    OR (
      id = auth.uid()
      -- Users cannot change their own role or status
      AND role     = (SELECT role     FROM public.profiles WHERE id = auth.uid())
      AND status   = (SELECT status   FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- ── VEHICLES ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "vehicles_select_own_or_admin"  ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_insert_own"           ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_update_own_or_admin"  ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_delete_own_or_admin"  ON public.vehicles;

CREATE POLICY "vehicles_select_own_or_admin" ON public.vehicles FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "vehicles_insert_own" ON public.vehicles FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "vehicles_update_own_or_admin" ON public.vehicles FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "vehicles_delete_own_or_admin" ON public.vehicles FOR DELETE
  USING (user_id = auth.uid() OR public.is_admin());

-- ── EMERGENCY CONTACTS ────────────────────────────────────────
DROP POLICY IF EXISTS "emergency_contacts_select_own_or_admin"  ON public.emergency_contacts;
DROP POLICY IF EXISTS "emergency_contacts_insert_own_or_admin"  ON public.emergency_contacts;
DROP POLICY IF EXISTS "emergency_contacts_update_own_or_admin"  ON public.emergency_contacts;
DROP POLICY IF EXISTS "emergency_contacts_delete_own_or_admin"  ON public.emergency_contacts;

CREATE POLICY "emergency_contacts_select_own_or_admin" ON public.emergency_contacts FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "emergency_contacts_insert_own_or_admin" ON public.emergency_contacts FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "emergency_contacts_update_own_or_admin" ON public.emergency_contacts FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "emergency_contacts_delete_own_or_admin" ON public.emergency_contacts FOR DELETE
  USING (user_id = auth.uid() OR public.is_admin());

-- ── VENDORS ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "vendors_select_signed_in"    ON public.vendors;
DROP POLICY IF EXISTS "vendors_select_anon"         ON public.vendors;
DROP POLICY IF EXISTS "vendors_insert_admin"        ON public.vendors;
DROP POLICY IF EXISTS "vendors_update_admin_or_own" ON public.vendors;
DROP POLICY IF EXISTS "vendors_delete_admin"        ON public.vendors;

-- Authenticated users see all vendors (admin sees soft-deleted too via is_admin)
CREATE POLICY "vendors_select_signed_in" ON public.vendors FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Unauthenticated: only verified, not deleted (self-registration browse)
CREATE POLICY "vendors_select_anon" ON public.vendors FOR SELECT
  USING (auth.uid() IS NULL AND is_verified = true AND deleted_at IS NULL);

CREATE POLICY "vendors_insert_admin" ON public.vendors FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "vendors_update_admin_or_own" ON public.vendors FOR UPDATE
  USING (public.is_admin() OR auth_uid = auth.uid())
  WITH CHECK (
    public.is_admin()
    OR (
      -- Vendors can update their own profile but NOT trust fields
      auth_uid = auth.uid()
      AND kyc          = (SELECT kyc          FROM public.vendors WHERE id = vendors.id)
      AND status       = (SELECT status       FROM public.vendors WHERE id = vendors.id)
      AND is_verified  = (SELECT is_verified  FROM public.vendors WHERE id = vendors.id)
      AND rating       = (SELECT rating       FROM public.vendors WHERE id = vendors.id)
      AND review_count = (SELECT review_count FROM public.vendors WHERE id = vendors.id)
    )
  );

CREATE POLICY "vendors_delete_admin" ON public.vendors FOR DELETE
  USING (public.is_admin());

-- ── SERVICE REQUESTS ──────────────────────────────────────────
DROP POLICY IF EXISTS "service_requests_select"        ON public.service_requests;
DROP POLICY IF EXISTS "service_requests_insert_own"    ON public.service_requests;
DROP POLICY IF EXISTS "service_requests_update"        ON public.service_requests;
DROP POLICY IF EXISTS "service_requests_delete_admin"  ON public.service_requests;

CREATE POLICY "service_requests_select" ON public.service_requests FOR SELECT
  USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_assigned_vendor(vendor_id)
  );

CREATE POLICY "service_requests_insert_own" ON public.service_requests FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "service_requests_update" ON public.service_requests FOR UPDATE
  USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_assigned_vendor(vendor_id)
  );

CREATE POLICY "service_requests_delete_admin" ON public.service_requests FOR DELETE
  USING (public.is_admin());

-- ── NOTIFICATIONS ─────────────────────────────────────────────
DROP POLICY IF EXISTS "notifications_select_own_or_admin"  ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_own_or_admin"  ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own_or_admin"  ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_own_or_admin"  ON public.notifications;

CREATE POLICY "notifications_select_own_or_admin" ON public.notifications FOR SELECT
  USING (
    public.is_admin()
    OR user_id = auth.uid()::text
    OR user_id = ''
  );

CREATE POLICY "notifications_insert_own_or_admin" ON public.notifications FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR user_id = auth.uid()::text
    OR user_id = ''
  );

CREATE POLICY "notifications_update_own_or_admin" ON public.notifications FOR UPDATE
  USING (public.is_admin() OR user_id = auth.uid()::text);

CREATE POLICY "notifications_delete_own_or_admin" ON public.notifications FOR DELETE
  USING (public.is_admin() OR user_id = auth.uid()::text);

-- ── REVIEWS ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "reviews_select_visible_or_admin"     ON public.reviews;
DROP POLICY IF EXISTS "reviews_insert_own"                  ON public.reviews;
DROP POLICY IF EXISTS "reviews_update_admin_or_own"         ON public.reviews;
DROP POLICY IF EXISTS "reviews_delete_admin"                ON public.reviews;

CREATE POLICY "reviews_select_visible_or_admin" ON public.reviews FOR SELECT
  USING (
    public.is_admin()
    OR status = 'visible'
    OR user_id = auth.uid()
  );

CREATE POLICY "reviews_insert_own" ON public.reviews FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND rating BETWEEN 1 AND 5
    AND status = 'visible'
  );

CREATE POLICY "reviews_update_admin_or_own" ON public.reviews FOR UPDATE
  USING (
    public.is_admin()
    OR (user_id = auth.uid() AND status NOT IN ('flagged','deleted'))
  );

CREATE POLICY "reviews_delete_admin" ON public.reviews FOR DELETE
  USING (public.is_admin());

-- ── SOS HOTSPOTS ──────────────────────────────────────────────
DROP POLICY IF EXISTS "sos_insert_signed_in"  ON public.sos_hotspots;
DROP POLICY IF EXISTS "sos_select_admin"      ON public.sos_hotspots;
DROP POLICY IF EXISTS "sos_update_admin"      ON public.sos_hotspots;

CREATE POLICY "sos_insert_signed_in" ON public.sos_hotspots FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "sos_select_admin"     ON public.sos_hotspots FOR SELECT
  USING (public.is_admin());
CREATE POLICY "sos_update_admin"     ON public.sos_hotspots FOR UPDATE
  USING (public.is_admin());

-- ── AUDIT LOG ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_log_select_admin"     ON public.audit_log;
DROP POLICY IF EXISTS "audit_log_insert_admin_own" ON public.audit_log;

CREATE POLICY "audit_log_select_admin" ON public.audit_log FOR SELECT
  USING (public.is_admin());

-- Users can only insert audit rows attributed to themselves (no forging)
CREATE POLICY "audit_log_insert_admin_own" ON public.audit_log FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR (auth.uid() IS NOT NULL AND actor_uid = auth.uid()::text)
  );

-- ── APP CONFIG ────────────────────────────────────────────────
-- All authenticated users can READ (Flutter app needs feature flags)
-- Only admins can WRITE
DROP POLICY IF EXISTS "app_config_select_auth"   ON public.app_config;
DROP POLICY IF EXISTS "app_config_insert_admin"  ON public.app_config;
DROP POLICY IF EXISTS "app_config_update_admin"  ON public.app_config;

CREATE POLICY "app_config_select_auth"  ON public.app_config FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "app_config_insert_admin" ON public.app_config FOR INSERT
  WITH CHECK (public.is_admin());
CREATE POLICY "app_config_update_admin" ON public.app_config FOR UPDATE
  USING (public.is_admin());

-- ── SERVICE ZONES ─────────────────────────────────────────────
DROP POLICY IF EXISTS "service_zones_select_signed_in"  ON public.service_zones;
DROP POLICY IF EXISTS "service_zones_write_admin"       ON public.service_zones;

CREATE POLICY "service_zones_select_signed_in" ON public.service_zones FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "service_zones_write_admin" ON public.service_zones FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- REALTIME — tables that need live updates in admin panel + app
-- ─────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.profiles,
  public.vendors,
  public.service_requests,
  public.notifications,
  public.reviews,
  public.sos_hotspots,
  public.emergency_contacts,
  public.audit_log,
  public.app_config,
  public.service_zones;

-- ─────────────────────────────────────────────────────────────
-- RPC FUNCTIONS (from 0006_rpc_functions.sql)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_service_request(
  p_request_id       uuid,
  p_mechanic_name    text,
  p_mechanic_vehicle text,
  p_mechanic_rating  double precision,
  p_mechanic_phone   text    DEFAULT '',
  p_eta_minutes      integer DEFAULT NULL,
  p_mechanic_lat     double precision DEFAULT NULL,
  p_mechanic_lng     double precision DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status
    FROM public.service_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: request does not exist' USING ERRCODE = 'P0001';
  END IF;

  IF v_status != 'requested' THEN
    RAISE EXCEPTION 'not_requested: request is already %', v_status USING ERRCODE = 'P0001';
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

GRANT EXECUTE ON FUNCTION public.accept_service_request(uuid, text, text, double precision, text, integer, double precision, double precision) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- SEED DATA
-- ─────────────────────────────────────────────────────────────

-- Feature flags
INSERT INTO public.app_config (id, data, updated_at) VALUES (
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
) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now();

-- App config
INSERT INTO public.app_config (id, data, updated_at) VALUES (
  'main',
  '{
    "appName": "RoadAssist Pro",
    "supportPhone": "",
    "supportEmail": "",
    "termsUrl": "",
    "privacyUrl": ""
  }'::jsonb,
  now()
) ON CONFLICT (id) DO UPDATE SET updated_at = now();

-- Karachi service zones
INSERT INTO public.service_zones (name, coverage, avg_response_mins, vendor_count) VALUES
  ('DHA & Clifton',                   'high',   12, 45),
  ('Gulshan & Gulistan-e-Johar',      'high',   15, 38),
  ('Saddar & Garden',                 'high',   10, 52),
  ('Nazimabad & North Nazimabad',     'high',   18, 30),
  ('SITE & Orangi Town',              'medium', 25, 18),
  ('Korangi & Landhi',                'medium', 22, 24),
  ('Malir & Shah Faisal Colony',      'medium', 28, 16),
  ('Keamari & Lyari',                 'low',    35, 10),
  ('Surjani & New Karachi',           'medium', 30, 14),
  ('Bin Qasim & Gulshan-e-Maymar',    'low',    40,  8)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- ADMIN USER SETUP
-- Run this AFTER creating the admin account via:
-- Supabase Dashboard → Authentication → Users → Add User
--   Email: admin@roadassist.com
--   Password: Admin@12345
-- Then run this query to promote them to admin:
-- ─────────────────────────────────────────────────────────────
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'admin@roadassist.com';
