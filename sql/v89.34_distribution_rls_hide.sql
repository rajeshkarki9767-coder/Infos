-- =====================================================================
-- v89.34: Enforce "Hide Distribution" at the DATABASE level (RLS)
-- =====================================================================
-- v89.33 added the per-member member_hide_distribution flag and hid the
-- Distribution TAB in the UI. This migration makes it a real ACCESS
-- control: a manager/viewer with the flag set can no longer READ the
-- distribution rows at all. With the rows withheld by RLS:
--   • the realtime subscription delivers nothing for them,
--   • a direct route shows an empty Distribution view,
--   • there is no data to export.
-- The owner is always allowed. Writes remain owner-only (unchanged).
--
-- WHAT IT DOES
--   1. New SECURITY DEFINER helper app_can_read_distribution(business_id):
--        owner of the business              -> true
--        member with hide flag NOT true     -> true
--        member with member_hide_distribution = true -> FALSE
--        non-member                         -> false
--   2. Replaces ONLY the SELECT policy on the three distribution tables to
--      use this helper. INSERT/UPDATE/DELETE policies are NOT touched
--      (still owner-only via app_is_business_owner).
--
-- SAFETY / REVERSIBILITY
--   • Owner read is checked FIRST and depends only on app_businesses.owner_id
--     = auth.uid(), so the owner can NEVER be locked out by this change.
--   • A member with no flag, NULL flag, or flag=false still reads normally
--     (COALESCE-style check), so existing managers/viewers are unaffected
--     until the owner explicitly hides it for them.
--   • To revert: re-run v89.32.35's SELECT policy (USING
--     app_can_read_business) — or just set every member_hide_distribution
--     back to false.
--
-- PREREQUISITE: run v89.33_app_members_hide_distribution.sql FIRST (this
-- migration reads the member_hide_distribution column).
--
-- RUN THIS in Supabase SQL Editor. Then TEST on a non-owner before trusting:
--   • owner still reads distribution,
--   • a manager/viewer WITHOUT the flag still reads distribution,
--   • a manager/viewer WITH the flag reads ZERO distribution rows.

BEGIN;

-- 1) Read-permission helper for distribution specifically.
CREATE OR REPLACE FUNCTION public.app_can_read_distribution(p_business_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Owner always reads (checked first; cannot be locked out).
  SELECT EXISTS (
    SELECT 1 FROM public.app_businesses b
    WHERE b.id = p_business_id
      AND b.owner_id = auth.uid()
  )
  OR EXISTS (
    -- A member of this business whose Distribution is NOT hidden.
    -- COALESCE so a missing/NULL flag means "not hidden" (visible).
    SELECT 1 FROM public.app_members m
    WHERE m.business_id = p_business_id
      AND m.user_id = auth.uid()
      AND COALESCE(m.member_hide_distribution, false) = false
  );
$$;

-- 2) Swap ONLY the SELECT policy on the three distribution tables.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_distribution_salaries',
    'app_distribution_shares',
    'app_split_parties'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "members read %1$s" ON public.%1$I;', t);
    EXECUTE format(
      'CREATE POLICY "members read %1$s" ON public.%1$I FOR SELECT
         USING (public.app_can_read_distribution(business_id));', t);
  END LOOP;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (optional) — confirm the SELECT policy now uses the new helper:
--   SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
--     FROM pg_policy
--    WHERE polrelid IN (
--      'public.app_distribution_salaries'::regclass,
--      'public.app_distribution_shares'::regclass,
--      'public.app_split_parties'::regclass)
--      AND polcmd = 'r';   -- SELECT policies
-- Expect using_expr = app_can_read_distribution(business_id) on all three.
--
-- REVERT (if ever needed):
--   Re-run the SELECT-policy block from v89.32.35_create_distribution_tables.sql
--   (USING public.app_can_read_business(business_id)).
-- ---------------------------------------------------------------------------
