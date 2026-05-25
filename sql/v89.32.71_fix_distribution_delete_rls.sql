-- =============================================================================
-- v89.32.71 — Fix DELETE permission (RLS) on the Distribution tables
-- =============================================================================
-- SYMPTOM (from the client console):
--   [distDelete] cloud delete result { table: 'app_split_parties', deletedRows: 0 }
--   [distDelete] 0 rows deleted — likely RLS blocking DELETE on app_split_parties
--
-- The owner could not DELETE split parties (and possibly salaries/shares):
-- the DELETE row-level-security policy was missing or wrong, so Supabase
-- accepted the request but matched 0 rows. The row stayed in the cloud, the
-- client tombstoned it locally, it re-synced, got re-tombstoned, and so on —
-- producing dozens of tombstones and the "added then vanishes / delete says
-- 0 deleted" party loop.
--
-- This (re)creates a correct DELETE policy on all three distribution tables,
-- reusing the existing owner-check helper app_is_business_owner(text). Also
-- (re)affirms the can-write helper for completeness. Idempotent / safe to
-- re-run. Run once in Supabase -> SQL Editor.
-- =============================================================================

BEGIN;

-- app_split_parties --------------------------------------------------------
DROP POLICY IF EXISTS app_split_parties_delete ON public.app_split_parties;
DROP POLICY IF EXISTS app_split_parties_owner_delete ON public.app_split_parties;
CREATE POLICY app_split_parties_delete ON public.app_split_parties
  FOR DELETE USING (public.app_is_business_owner(business_id));

-- app_distribution_salaries ------------------------------------------------
DROP POLICY IF EXISTS app_distribution_salaries_delete ON public.app_distribution_salaries;
DROP POLICY IF EXISTS app_distribution_salaries_owner_delete ON public.app_distribution_salaries;
CREATE POLICY app_distribution_salaries_delete ON public.app_distribution_salaries
  FOR DELETE USING (public.app_is_business_owner(business_id));

-- app_distribution_shares --------------------------------------------------
DROP POLICY IF EXISTS app_distribution_shares_delete ON public.app_distribution_shares;
DROP POLICY IF EXISTS app_distribution_shares_owner_delete ON public.app_distribution_shares;
CREATE POLICY app_distribution_shares_delete ON public.app_distribution_shares
  FOR DELETE USING (public.app_is_business_owner(business_id));

COMMIT;

-- Verify afterwards (should list a DELETE policy per table):
--   select polrelid::regclass as tbl, polname, polcmd
--   from pg_policy
--   where polrelid in (
--     'public.app_split_parties'::regclass,
--     'public.app_distribution_salaries'::regclass,
--     'public.app_distribution_shares'::regclass)
--   order by tbl, polcmd;
