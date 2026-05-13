-- ─────────────────────────────────────────────────────────────────────────────
-- 0003_triggers.sql — RoadAssist Pro
-- 7 triggers replacing client-side denormalization and validation.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. set_updated_at ────────────────────────────────────────────────────────
-- Generic BEFORE UPDATE trigger. Bumps updated_at = now() on every table
-- that has that column. Replaces FieldValue.serverTimestamp() on updates.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_vehicles_updated_at
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_emergency_contacts_updated_at
  BEFORE UPDATE ON public.emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_service_requests_updated_at
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_service_zones_updated_at
  BEFORE UPDATE ON public.service_zones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 2. recompute_vendor_rating ───────────────────────────────────────────────
-- AFTER INSERT/UPDATE/DELETE ON reviews.
-- Recomputes vendors.rating and vendors.review_count from scratch.
-- Replaces the client-side runTransaction() in review_repository.dart.
-- Only counts 'visible' reviews so flagged/deleted ones don't skew the score.
CREATE OR REPLACE FUNCTION public.recompute_vendor_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_vendor_id uuid;
  v_avg       double precision;
  v_count     integer;
BEGIN
  -- Determine which vendor to recompute.
  v_vendor_id := COALESCE(NEW.vendor_id, OLD.vendor_id);

  SELECT
    COALESCE(AVG(rating), 0),
    COUNT(*)
  INTO v_avg, v_count
  FROM public.reviews
  WHERE vendor_id = v_vendor_id
    AND status = 'visible';

  UPDATE public.vendors
  SET
    rating       = ROUND(v_avg::numeric, 2),
    review_count = v_count,
    updated_at   = now()
  WHERE id = v_vendor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_reviews_recompute_vendor_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.recompute_vendor_rating();

-- ─── 3. enforce_single_primary_vehicle ───────────────────────────────────────
-- BEFORE INSERT/UPDATE ON vehicles.
-- If is_primary = true for a row, demote all other rows for the same user.
-- Replaces the batch-demote loop in vehicle_profile_repository.dart.
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

CREATE TRIGGER trg_vehicles_single_primary
  BEFORE INSERT OR UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_primary_vehicle();

-- ─── 4. max_emergency_contacts_5 ─────────────────────────────────────────────
-- BEFORE INSERT ON emergency_contacts.
-- Reject if user already has 5 contacts.
-- Replaces the maxEmergencyContacts check in emergency_contacts_repository.dart.
CREATE OR REPLACE FUNCTION public.max_emergency_contacts_5()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.emergency_contacts
  WHERE user_id = NEW.user_id;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'max_emergency_contacts_exceeded: user % already has 5 contacts', NEW.user_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_emergency_contacts_max_5
  BEFORE INSERT ON public.emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION public.max_emergency_contacts_5();

-- ─── 5. enforce_kyc_state_machine ────────────────────────────────────────────
-- BEFORE UPDATE ON vendors.
-- If kyc changes to 'approved', force status='verified', is_verified=true,
-- and stamp verified_at. Mirrors the SCHEMA.md contract and the approveKYC()
-- function in firebase.js so the trigger catches any direct SQL update too.
CREATE OR REPLACE FUNCTION public.enforce_kyc_state_machine()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kyc = 'approved' AND (OLD.kyc IS DISTINCT FROM 'approved') THEN
    NEW.status       := 'verified';
    NEW.is_verified  := true;
    NEW.verified_at  := now();
  END IF;

  IF NEW.kyc = 'rejected' AND (OLD.kyc IS DISTINCT FROM 'rejected') THEN
    NEW.status      := 'rejected';
    NEW.is_verified := false;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendors_kyc_state_machine
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_kyc_state_machine();

-- ─── 6. mirror_auth_to_profile ────────────────────────────────────────────────
-- AFTER INSERT ON auth.users.
-- Creates a profiles row on sign-up so _ensureUserDoc() is no longer needed
-- in auth_repository.dart. Uses raw_user_meta_data from the auth event.
CREATE OR REPLACE FUNCTION public.mirror_auth_to_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    name,
    phone,
    role,
    status,
    created_at,
    updated_at,
    last_login_at
  ) VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    'customer',
    'active',
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    last_login_at = now(),
    updated_at    = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auth_users_mirror_to_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.mirror_auth_to_profile();

-- ─── 7. audit_log_writer ─────────────────────────────────────────────────────
-- AFTER INSERT/UPDATE/DELETE on key tables.
-- Writes an immutable audit row so server-side changes are always recorded.
-- Client-side fire-and-forget logs are still supported for fine-grained actions.
CREATE OR REPLACE FUNCTION public.audit_log_writer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_action      text;
  v_entity_type text;
  v_entity_id   text;
  v_actor_uid   text;
BEGIN
  -- Determine action verb
  IF TG_OP = 'INSERT' THEN
    v_action := TG_TABLE_NAME || '_created';
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := TG_TABLE_NAME || '_updated';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := TG_TABLE_NAME || '_deleted';
  END IF;

  v_entity_type := TG_TABLE_NAME;

  -- Get entity ID from the row
  IF TG_OP = 'DELETE' THEN
    v_entity_id := OLD.id::text;
  ELSE
    v_entity_id := NEW.id::text;
  END IF;

  -- Get actor from JWT (null for system operations)
  v_actor_uid := COALESCE(auth.uid()::text, 'system');

  INSERT INTO public.audit_log (
    action,
    actor_type,
    actor_uid,
    entity_type,
    entity_id,
    timestamp
  ) VALUES (
    v_action,
    CASE WHEN v_actor_uid = 'system' THEN 'system' ELSE 'customer' END,
    v_actor_uid,
    v_entity_type,
    v_entity_id,
    now()
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Apply audit trigger to key tables
CREATE TRIGGER trg_vendors_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_writer();

CREATE TRIGGER trg_service_requests_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_writer();

CREATE TRIGGER trg_reviews_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_writer();
