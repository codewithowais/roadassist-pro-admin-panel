-- ─────────────────────────────────────────────────────────────────────────────
-- 0001_init_schema.sql — RoadAssist Pro
-- Replaces Firestore. All 11 tables. Source of truth: SCHEMA.md.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── profiles (was Firestore users/{uid}) ─────────────────────────────────────
-- Created automatically via mirror_auth_to_profile trigger (0003_triggers.sql).
-- Mirrors auth.users.id as the PK so every profile is 1:1 with an auth user.
CREATE TABLE public.profiles (
  id              uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone           text        NOT NULL DEFAULT '',
  name            text        NOT NULL DEFAULT '',
  photo_url       text        NOT NULL DEFAULT '',
  email           text        NOT NULL DEFAULT '',
  role            text        NOT NULL DEFAULT 'customer'
                              CHECK (role IN ('customer', 'vendor', 'admin')),
  vendor_id       uuid,                          -- set when role = 'vendor'
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'blocked')),
  blocked_reason  text,
  blocked_at      timestamptz,
  blocked_by      text,
  blocked_by_email text,
  total_jobs      integer     NOT NULL DEFAULT 0,
  vehicle_type    text        NOT NULL DEFAULT 'car',
  ai_enabled      boolean     NOT NULL DEFAULT false,
  fcm_token       text,
  token_updated_at timestamptz,
  deleted_at      timestamptz,
  deleted_by      text,
  deleted_by_email text,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS 'User profiles — mirrors auth.users. Replaces Firestore users/{uid}.';

-- ─── vehicles (was users/{uid}/vehicles/{id}) ─────────────────────────────────
CREATE TABLE public.vehicles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vehicle_type        text        NOT NULL CHECK (vehicle_type IN ('car', 'bike')),
  make                text        NOT NULL DEFAULT '',
  model               text        NOT NULL DEFAULT '',
  year                integer     NOT NULL DEFAULT 2020,
  color               text        NOT NULL DEFAULT '',
  registration_number text        NOT NULL DEFAULT '',
  fuel_type           text        NOT NULL DEFAULT 'petrol'
                                  CHECK (fuel_type IN ('petrol', 'diesel', 'electric', 'cng')),
  is_primary          boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vehicles IS 'Per-user vehicle list. Exactly one is_primary per user enforced by trigger.';

-- ─── emergency_contacts (was users/{uid}/emergencyContacts/{id}) ───────────────
CREATE TABLE public.emergency_contacts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        text        NOT NULL DEFAULT '',
  phone       text        NOT NULL DEFAULT '',  -- E.164 format
  linked_uid  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  linked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.emergency_contacts IS 'Per-user emergency contacts (max 5). Enforced by trigger.';

-- ─── vendors ──────────────────────────────────────────────────────────────────
CREATE TABLE public.vendors (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,  -- vendor's login
  name                 text        NOT NULL DEFAULT '',
  business_name        text,
  owner_name           text,
  category             text        NOT NULL
                                   CHECK (category IN ('Mechanic', 'Fuel', 'Tyre', 'Battery', 'Accident', 'Towing')),
  city                 text        NOT NULL DEFAULT '',
  area                 text,
  lat                  double precision NOT NULL DEFAULT 0,
  lng                  double precision NOT NULL DEFAULT 0,
  phone                text        NOT NULL DEFAULT '',  -- E.164
  whatsapp             text,
  email                text,
  cost_range           text,
  rating               double precision NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  review_count         integer     NOT NULL DEFAULT 0,
  is_open              boolean     NOT NULL DEFAULT false,
  is_verified          boolean     NOT NULL DEFAULT false,  -- CRITICAL: mobile filters on this
  kyc                  text        NOT NULL DEFAULT 'pending'
                                   CHECK (kyc IN ('pending', 'approved', 'rejected')),
  kyc_rejected_reason  text,
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'verified', 'rejected')),
  source               text        NOT NULL DEFAULT 'seed'
                                   CHECK (source IN ('seed', 'self_registration')),
  documents            jsonb,                      -- { cnic_path, license_path, photo_path }
  cnic_number          text,
  vehicle_reg          text,
  description          text,
  operating_hours      text,
  application_id       text,                       -- UUID for self-registered vendors (R2 folder)
  seed_id              text,                       -- original seed id
  agreed_to_terms      boolean,
  address              text,
  current_lat          double precision,
  current_lng          double precision,
  last_seen_at         timestamptz,
  verified_at          timestamptz,
  deleted_at           timestamptz,
  deleted_by           text,
  deleted_by_email     text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vendors IS 'Service providers. is_verified MUST be true for vendors to appear in mobile app.';

-- ─── service_requests ─────────────────────────────────────────────────────────
CREATE TABLE public.service_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES public.profiles(id),
  vendor_id        uuid        NOT NULL REFERENCES public.vendors(id),
  vendor_name      text        NOT NULL DEFAULT '',     -- denormalized
  category         text        NOT NULL
                               CHECK (category IN ('Mechanic', 'Fuel', 'Tyre', 'Battery', 'Accident', 'Towing')),
  status           text        NOT NULL DEFAULT 'requested'
                               CHECK (status IN ('requested', 'accepted', 'onTheWay', 'arrived', 'completed', 'cancelled')),
  user_lat         double precision NOT NULL DEFAULT 0,
  user_lng         double precision NOT NULL DEFAULT 0,
  eta_minutes      integer     NOT NULL DEFAULT 0,
  mechanic_name    text        NOT NULL DEFAULT '',
  mechanic_phone   text        NOT NULL DEFAULT '',
  mechanic_rating  double precision NOT NULL DEFAULT 0,
  mechanic_vehicle text        NOT NULL DEFAULT '',
  mechanic_lat     double precision,
  mechanic_lng     double precision,
  mechanic_location_at timestamptz,
  estimated_cost   double precision,
  cancelled_by     text        NOT NULL DEFAULT '',
  cancel_reason    text        NOT NULL DEFAULT '',
  requested_at     timestamptz,
  accepted_at      timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.service_requests IS 'Service bookings. Top-level so admin and vendor can query across users.';

-- ─── notifications ────────────────────────────────────────────────────────────
-- user_id is text (not uuid) — broadcasts use empty string '' for everyone.
CREATE TABLE public.notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text        NOT NULL DEFAULT '',      -- '' = broadcast
  type            text        NOT NULL
                              CHECK (type IN ('serviceUpdate', 'sosAlert', 'ratingNudge', 'systemInfo',
                                              'nearbyVendor', 'broadcast', 'targeted')),
  title           text        NOT NULL DEFAULT '',
  body            text        NOT NULL DEFAULT '',
  is_read         boolean     NOT NULL DEFAULT false,
  action_route    text,
  action_payload  text,
  sender_uid      text,                                 -- SOS: sender's uid
  sender_name     text,
  lat             double precision,
  lng             double precision,
  -- Broadcast history fields (admin-sent)
  topic           text,
  target_token    text,
  sent_by         text,
  sent_at         timestamptz,
  status_label    text,                                 -- 'sent', 'delivered', etc.
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS 'In-app notifications. user_id=empty string means broadcast to all.';

-- ─── reviews ──────────────────────────────────────────────────────────────────
CREATE TABLE public.reviews (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES public.profiles(id),
  user_name    text        NOT NULL DEFAULT '',          -- denormalized
  request_id   uuid        REFERENCES public.service_requests(id),
  vendor_id    uuid        NOT NULL REFERENCES public.vendors(id),
  vendor_name  text        NOT NULL DEFAULT '',          -- denormalized
  rating       integer     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text         text,
  tags         text[],
  status       text        NOT NULL DEFAULT 'visible'
                           CHECK (status IN ('visible', 'flagged', 'deleted')),
  deleted_at   timestamptz,
  deleted_by   text,
  deleted_by_email text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reviews IS 'Customer reviews. Vendor rating is recomputed by trigger on insert/update/delete.';

-- ─── sos_hotspots ─────────────────────────────────────────────────────────────
CREATE TABLE public.sos_hotspots (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text        NOT NULL DEFAULT 'anonymous',
  user_name          text,
  user_email         text,
  lat                double precision NOT NULL DEFAULT 0,
  lng                double precision NOT NULL DEFAULT 0,
  accuracy           double precision,
  contacts_notified  integer     NOT NULL DEFAULT 0,
  app_users_pushed   integer     NOT NULL DEFAULT 0,
  recipients         jsonb,      -- [{ name, phone, is_app_user, linked_uid, push_succeeded }]
  resolved           boolean     NOT NULL DEFAULT false,
  resolved_at        timestamptz,
  resolved_by        text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sos_hotspots IS 'SOS safety events. Anonymous analytics + admin heatmap.';

-- ─── audit_log ────────────────────────────────────────────────────────────────
CREATE TABLE public.audit_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action          text        NOT NULL,
  actor_type      text        NOT NULL DEFAULT 'admin'
                              CHECK (actor_type IN ('admin', 'customer', 'vendor', 'system')),
  actor_uid       text        NOT NULL DEFAULT 'unknown',
  actor_name      text        NOT NULL DEFAULT '',
  actor_email     text,
  -- Legacy fields for backwards compat with existing AuditLog_Page code
  admin_uid       text,
  admin_name      text,
  entity_type     text        NOT NULL DEFAULT '',
  entity_id       text        NOT NULL DEFAULT '',
  entity_name     text,
  details         jsonb,
  device          jsonb,      -- { platform, user_agent }
  timestamp       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_log IS 'Immutable audit trail. Written by server triggers + explicit client calls.';

-- ─── app_config (singleton-row pattern) ───────────────────────────────────────
-- Two rows: id='main' (general config) and id='flags' (feature flags).
CREATE TABLE public.app_config (
  id         text        PRIMARY KEY,              -- 'main' or 'flags'
  data       jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_config IS 'Singleton config docs. id=main for general config, id=flags for feature flags.';

-- ─── service_zones ────────────────────────────────────────────────────────────
CREATE TABLE public.service_zones (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL DEFAULT '',
  coverage          text        NOT NULL DEFAULT 'high'
                                CHECK (coverage IN ('high', 'medium', 'low')),
  avg_response_mins integer     NOT NULL DEFAULT 0,
  vendor_count      integer     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.service_zones IS 'Geographic service zones for admin coverage tracking.';
