-- =====================================================================
-- v89.30.5: Device management — app_device_names + helper functions
-- =====================================================================
-- Two things in this migration:
--   1. The app_device_names table (custom user-assigned device labels)
--   2. Two SECURITY DEFINER RPC functions that let the Edge Functions
--      list-my-sessions and revoke-my-session access auth.sessions
--      safely (since auth.sessions is not exposed to PostgREST by
--      default).
--
-- Run this in your Supabase SQL editor BEFORE deploying the
-- list-my-sessions and revoke-my-session Edge Functions.

BEGIN;

-- =====================================================================
-- TABLE: app_device_names
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.app_device_names (
  user_id      uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id    text    NOT NULL,
  name         text    NOT NULL,
  session_id   uuid    NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS app_device_names_user_session_idx
  ON public.app_device_names(user_id, session_id);

CREATE OR REPLACE FUNCTION public.app_device_names_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_device_names_touch_trigger ON public.app_device_names;
CREATE TRIGGER app_device_names_touch_trigger
  BEFORE UPDATE ON public.app_device_names
  FOR EACH ROW EXECUTE FUNCTION public.app_device_names_touch();

-- RLS
ALTER TABLE public.app_device_names ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own device names"   ON public.app_device_names;
DROP POLICY IF EXISTS "Users insert own device names" ON public.app_device_names;
DROP POLICY IF EXISTS "Users update own device names" ON public.app_device_names;
DROP POLICY IF EXISTS "Users delete own device names" ON public.app_device_names;

CREATE POLICY "Users read own device names"
  ON public.app_device_names FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own device names"
  ON public.app_device_names FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own device names"
  ON public.app_device_names FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own device names"
  ON public.app_device_names FOR DELETE
  USING (auth.uid() = user_id);


-- =====================================================================
-- RPC: list_user_auth_sessions(p_user_id)
-- =====================================================================
-- Returns the auth.sessions rows for one specific user. The Edge
-- Function list-my-sessions verifies the JWT, extracts the caller's
-- user_id, then calls this function with p_user_id = caller_id.

CREATE OR REPLACE FUNCTION public.list_user_auth_sessions(p_user_id uuid)
RETURNS TABLE (
  id          uuid,
  user_id     uuid,
  user_agent  text,
  ip          inet,
  created_at  timestamptz,
  updated_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public, pg_temp
AS $$
  SELECT
    s.id,
    s.user_id,
    s.user_agent,
    s.ip,
    s.created_at,
    s.updated_at
  FROM auth.sessions s
  WHERE s.user_id = p_user_id
  ORDER BY s.updated_at DESC NULLS LAST;
$$;

-- Lock down: only the service-role can call this.
REVOKE ALL ON FUNCTION public.list_user_auth_sessions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_user_auth_sessions(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_auth_sessions(uuid) TO service_role;


-- =====================================================================
-- RPC: revoke_user_auth_session(p_user_id, p_session_id)
-- =====================================================================
-- Deletes ONE auth.sessions row, but ONLY if it belongs to the given
-- user. Returns the number of rows deleted (0 or 1). The Edge Function
-- revoke-my-session passes the caller's verified user_id so this
-- function physically cannot delete a session belonging to anyone else.

CREATE OR REPLACE FUNCTION public.revoke_user_auth_session(
  p_user_id    uuid,
  p_session_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public, pg_temp
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM auth.sessions
    WHERE id = p_session_id
      AND user_id = p_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_auth_session(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_user_auth_session(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_auth_session(uuid, uuid) TO service_role;

COMMIT;


-- =====================================================================
-- Verification (run separately after the above)
-- =====================================================================
-- 1. Table + RLS in place:
--      SELECT tablename, policyname FROM pg_policies
--        WHERE schemaname = 'public' AND tablename = 'app_device_names';
--
-- 2. Functions exist with SECURITY DEFINER:
--      SELECT proname, prosecdef FROM pg_proc
--        WHERE proname IN ('list_user_auth_sessions', 'revoke_user_auth_session');
--      Expected: prosecdef = true for both.
--
-- 3. Permissions correctly scoped (only service_role):
--      SELECT routine_name, grantee, privilege_type
--        FROM information_schema.routine_privileges
--        WHERE routine_name IN ('list_user_auth_sessions', 'revoke_user_auth_session');
--      Expected: grantee = service_role, privilege_type = EXECUTE.
