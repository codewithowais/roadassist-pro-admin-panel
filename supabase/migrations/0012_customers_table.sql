-- ─────────────────────────────────────────────────────────────────────────────
-- 0012_customers_table.sql
--
-- Mirrors the vendor model for customers: `profiles` stays the shared identity
-- table for EVERY account (customer + vendor), and each type also has its own
-- detail table — `vendors` (exists) and now `customers` (new).
--
-- After this migration:
--   • every customer  → 1 profiles row (role='customer') + 1 customers row
--   • every vendor    → 1 profiles row (role='vendor')   + 1 vendors row
--
-- Safe to apply: creates the table, backfills existing customers, and keeps it
-- in sync automatically for future sign-ups.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The customers detail table (id = the auth user / profiles id) ─────────
CREATE TABLE IF NOT EXISTS public.customers (
  id           uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  name         text        NOT NULL DEFAULT '',
  phone        text        NOT NULL DEFAULT '',
  email        text,
  vehicle_type text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customers_select_own_or_admin" ON public.customers;
DROP POLICY IF EXISTS "customers_insert_own_or_admin" ON public.customers;
DROP POLICY IF EXISTS "customers_update_own_or_admin" ON public.customers;

CREATE POLICY "customers_select_own_or_admin" ON public.customers FOR SELECT
  USING (id = auth.uid() OR public.is_admin());
CREATE POLICY "customers_insert_own_or_admin" ON public.customers FOR INSERT
  WITH CHECK (id = auth.uid() OR public.is_admin());
CREATE POLICY "customers_update_own_or_admin" ON public.customers FOR UPDATE
  USING (id = auth.uid() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;

-- ── 2. Backfill: one customers row for every existing customer profile ───────
INSERT INTO public.customers (id, name, phone, email)
SELECT p.id, p.name, p.phone, p.email
FROM public.profiles p
WHERE p.role = 'customer'
  AND p.deleted_at IS NULL
ON CONFLICT (id) DO NOTHING;

-- ── 3. Keep it in sync: auto-create a customers row whenever a profile is (or
--      becomes) a customer. Vendors are handled by the vendors table instead. ─
CREATE OR REPLACE FUNCTION public.mirror_profile_to_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'customer' THEN
    INSERT INTO public.customers (id, name, phone, email)
    VALUES (NEW.id, COALESCE(NEW.name, ''), COALESCE(NEW.phone, ''), NEW.email)
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_profile_to_customer ON public.profiles;
CREATE TRIGGER trg_mirror_profile_to_customer
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.mirror_profile_to_customer();
