-- ─────────────────────────────────────────────────────────────────────────────
-- 0010_identity_uniqueness.sql
--
-- Enforces: an email OR phone number may belong to a customer OR a vendor, never
-- both. Today nothing enforces this — self-registration even makes a vendor a
-- customer by default.
--
-- This migration adds (all SAFE to apply now):
--   1. identity_taken(email, phone) — a read-only check the registration screens
--      call BEFORE creating an account, to reject a duplicate up front.
--   2. A one-time data fix so already-approved vendors get role='vendor'
--      (they were left as 'customer', which mis-routed them in the app).
--
-- It also includes (COMMENTED OUT — Phase 2) the hard DB-level guarantee. Read
-- the warning before enabling it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. identity_taken(): is this email or phone already in use anywhere? ──────
-- Compares email case-insensitively and phone by its last 10 digits (so
-- +92300xxxxxxx, 0300xxxxxxx and 300xxxxxxx all match). SECURITY DEFINER so the
-- unauthenticated registration screen can call it without reading the tables.
CREATE OR REPLACE FUNCTION public.identity_taken(
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH e AS (SELECT lower(nullif(trim(coalesce(p_email, '')), '')) AS v),
       p AS (
         SELECT nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), '') AS v
         WHERE length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 7
       )
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
      WHERE deleted_at IS NULL
        AND ((SELECT v FROM e) IS NOT NULL AND lower(email) = (SELECT v FROM e))
    UNION ALL
    SELECT 1 FROM public.vendors
      WHERE deleted_at IS NULL
        AND ((SELECT v FROM e) IS NOT NULL AND lower(coalesce(email, '')) = (SELECT v FROM e))
    UNION ALL
    SELECT 1 FROM public.profiles
      WHERE deleted_at IS NULL
        AND ((SELECT v FROM p) IS NOT NULL
             AND right(regexp_replace(phone, '\D', '', 'g'), 10) = (SELECT v FROM p))
    UNION ALL
    SELECT 1 FROM public.vendors
      WHERE deleted_at IS NULL
        AND ((SELECT v FROM p) IS NOT NULL
             AND right(regexp_replace(phone, '\D', '', 'g'), 10) = (SELECT v FROM p))
  );
$$;

GRANT EXECUTE ON FUNCTION public.identity_taken(text, text) TO anon, authenticated;

-- ── 2. Data fix: approved vendors should be role='vendor', not 'customer' ─────
-- Self-registration left verified vendors with role='customer', so the mobile
-- app routed them to the customer experience. Correct them in one pass.
UPDATE public.profiles AS pr
SET role = 'vendor'
WHERE pr.role = 'customer'
  AND EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.auth_uid = pr.id
      AND v.deleted_at IS NULL
      AND v.is_verified = true
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 2 (OPTIONAL HARD GUARANTEE) — DO NOT UNCOMMENT YET.
--
-- The triggers below make the database itself reject any vendor whose
-- email/phone already belongs to a customer (and vice-versa). They are the only
-- airtight guarantee, but BEFORE enabling them you MUST:
--   (a) Rework vendor self-registration so the vendor's profile is set to
--       role='vendor' (server-side) BEFORE the vendors row is inserted —
--       otherwise the mirror-trigger 'customer' profile makes the trigger
--       reject every legitimate vendor signup.
--   (b) De-duplicate / normalize existing phone + email data, or these triggers
--       will start rejecting edits to already-conflicting rows.
-- Test on a staging copy first.
--
-- CREATE OR REPLACE FUNCTION public.enforce_vendor_identity_exclusive()
-- RETURNS trigger LANGUAGE plpgsql AS $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM public.profiles p
--     WHERE p.deleted_at IS NULL AND p.role = 'customer' AND p.id <> NEW.auth_uid
--       AND (
--         (NEW.email IS NOT NULL AND lower(p.email) = lower(NEW.email))
--         OR (length(regexp_replace(coalesce(NEW.phone,''),'\D','','g')) >= 7
--             AND right(regexp_replace(p.phone,'\D','','g'),10)
--               = right(regexp_replace(NEW.phone,'\D','','g'),10))
--       )
--   ) THEN
--     RAISE EXCEPTION 'identity_conflict: this email or phone is already a customer'
--       USING ERRCODE = '23505';
--   END IF;
--   RETURN NEW;
-- END $$;
-- CREATE TRIGGER trg_vendor_identity_exclusive
--   BEFORE INSERT OR UPDATE ON public.vendors
--   FOR EACH ROW EXECUTE FUNCTION public.enforce_vendor_identity_exclusive();
-- (plus the symmetric enforce_customer_identity_exclusive() on public.profiles)
-- ─────────────────────────────────────────────────────────────────────────────
