-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_rpc_functions.sql — RoadAssist Pro
-- Postgres RPC functions for operations that need server-side atomicity.
-- Called from Flutter via supabase.rpc('function_name', params: {...}).
-- ─────────────────────────────────────────────────────────────────────────────

-- accept_service_request
-- Atomically accepts a service request with a row-level lock.
-- Replaces the Firestore runTransaction() in vendor_jobs_repository.dart.
-- Throws an exception if the request is not in 'requested' state, preventing
-- two vendors from accepting the same job simultaneously.
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
BEGIN
  -- Lock the row for update to prevent concurrent accepts
  SELECT status INTO v_current_status
  FROM public.service_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: request % does not exist', p_request_id
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

COMMENT ON FUNCTION public.accept_service_request IS
  'Atomically accepts a service request. Raises P0001 if not in requested state.';
