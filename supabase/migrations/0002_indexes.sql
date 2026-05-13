-- ─────────────────────────────────────────────────────────────────────────────
-- 0002_indexes.sql — RoadAssist Pro
-- 14 composite indexes (from firestore.indexes.json) + supporting indexes.
-- ─────────────────────────────────────────────────────────────────────────────

-- vendors: mobile vendor list by category + verified status
CREATE INDEX idx_vendors_category_verified
  ON public.vendors(category, is_verified);

-- vendors: sorted vendor list (future use — rating sort)
CREATE INDEX idx_vendors_category_verified_rating
  ON public.vendors(category, is_verified, rating DESC);

-- service_requests: mobile history — user's requests newest first
CREATE INDEX idx_service_requests_user_requested
  ON public.service_requests(user_id, requested_at DESC);

-- service_requests: vendor job queue — by vendor + status + date
CREATE INDEX idx_service_requests_vendor_status_requested
  ON public.service_requests(vendor_id, status, requested_at DESC);

-- service_requests: vendor all requests newest first
CREATE INDEX idx_service_requests_vendor_requested
  ON public.service_requests(vendor_id, requested_at DESC);

-- notifications: user inbox newest first
CREATE INDEX idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

-- notifications: unread filter
CREATE INDEX idx_notifications_user_read_created
  ON public.notifications(user_id, is_read, created_at DESC);

-- reviews: vendor profile — by vendor + status + date
CREATE INDEX idx_reviews_vendor_status_created
  ON public.reviews(vendor_id, status, created_at DESC);

-- reviews: user review history
CREATE INDEX idx_reviews_user_created
  ON public.reviews(user_id, created_at DESC);

-- sos_hotspots: admin heatmap — unresolved first then by date
CREATE INDEX idx_sos_hotspots_resolved_created
  ON public.sos_hotspots(resolved, created_at DESC);

-- audit_log: by actor type (admin/customer/vendor) newest first
CREATE INDEX idx_audit_log_actor_type_ts
  ON public.audit_log(actor_type, timestamp DESC);

-- audit_log: by entity type (vendor/user/request/review/config)
CREATE INDEX idx_audit_log_entity_type_ts
  ON public.audit_log(entity_type, timestamp DESC);

-- audit_log: by specific actor uid
CREATE INDEX idx_audit_log_actor_uid_ts
  ON public.audit_log(actor_uid, timestamp DESC);

-- audit_log: combined actor + entity filter
CREATE INDEX idx_audit_log_actor_entity_ts
  ON public.audit_log(actor_type, entity_type, timestamp DESC);

-- ─── Supporting indexes ───────────────────────────────────────────────────────

-- profiles: phone lookup (emergency contact cross-match, admin lookupUserByPhone)
CREATE INDEX idx_profiles_phone
  ON public.profiles(phone);

-- profiles: list admins by role
CREATE INDEX idx_profiles_role
  ON public.profiles(role);

-- profiles: active/blocked filter
CREATE INDEX idx_profiles_status
  ON public.profiles(status);

-- vendors: auth_uid lookup (vendor profile fetch by signed-in user)
CREATE INDEX idx_vendors_auth_uid
  ON public.vendors(auth_uid);

-- vendors: soft-delete filter
CREATE INDEX idx_vendors_deleted_at
  ON public.vendors(deleted_at) WHERE deleted_at IS NULL;

-- profiles: soft-delete filter
CREATE INDEX idx_profiles_deleted_at
  ON public.profiles(deleted_at) WHERE deleted_at IS NULL;

-- vehicles: user's vehicles
CREATE INDEX idx_vehicles_user_id
  ON public.vehicles(user_id);

-- emergency_contacts: user's contacts
CREATE INDEX idx_emergency_contacts_user_id
  ON public.emergency_contacts(user_id);

-- service_requests: status for dashboard counts
CREATE INDEX idx_service_requests_status
  ON public.service_requests(status);

-- reviews: status for moderation queue
CREATE INDEX idx_reviews_status
  ON public.reviews(status);
