-- =====================================================================
-- v89.35: Remove the DUPLICATE distribution SELECT policies (security fix)
-- =====================================================================
-- WHY THIS EXISTS
-- The verify step (VERIFY_v89.34) revealed that each distribution table has
-- TWO permissive SELECT policies:
--   • "members read <table>"  → app_can_read_distribution(business_id)  (v89.34, restricts hidden members — CORRECT)
--   • "<table>_select"        → (app_)can_read_business(business_id)     (older, lets ANY member read — bypasses the restriction)
--
-- PostgreSQL OR's permissive policies together: a row is readable if EITHER
-- policy passes. So the old "<table>_select" policy was still letting a hidden
-- manager/viewer read distribution, defeating v89.34. This migration DROPS the
-- old duplicate so only the access-controlled policy remains.
--
-- WHAT IT DOES
--   Drops these SELECT policies if present (the redundant ones):
--     app_distribution_salaries_select
--     app_distribution_shares_select
--     app_split_parties_select
--   Leaves the v89.34 "members read <table>" SELECT policy in place, plus the
--   owner-only INSERT/UPDATE/DELETE policies. Nothing else changes.
--
-- SAFETY
--   • The remaining "members read <table>" policy already grants read to the
--     owner and to non-hidden members (verified true for both OWNER rows in
--     VERIFY_v89.34 CHECK 3), so dropping the duplicate does NOT lock anyone
--     out who should have access — it only stops the hidden members from
--     slipping through the old policy.
--   • Idempotent: DROP ... IF EXISTS. Safe to re-run.
--
-- PREREQUISITE: v89.33 + v89.34 already applied.
--
-- RUN THIS in Supabase SQL Editor, then re-run VERIFY_v89.34 CHECK 1: each
-- table should now show ONLY ONE SELECT policy ("members read <table>" using
-- app_can_read_distribution). Then re-test on a hidden member's device: they
-- should now hold ZERO distribution rows.

BEGIN;

DROP POLICY IF EXISTS app_distribution_salaries_select ON public.app_distribution_salaries;
DROP POLICY IF EXISTS app_distribution_shares_select   ON public.app_distribution_shares;
DROP POLICY IF EXISTS app_split_parties_select         ON public.app_split_parties;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY after running — expect exactly ONE SELECT (polcmd='r') row per table,
-- named "members read <table>", using app_can_read_distribution(business_id):
--
--   SELECT c.relname, pol.polname, pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
--     FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
--    WHERE c.relname IN ('app_distribution_salaries','app_distribution_shares','app_split_parties')
--      AND pol.polcmd = 'r'
--    ORDER BY c.relname;
--
-- REVERT (restores the old duplicate, re-opening read to all members):
--   CREATE POLICY app_distribution_salaries_select ON public.app_distribution_salaries
--     FOR SELECT USING (public.app_can_read_business(business_id));
--   CREATE POLICY app_distribution_shares_select ON public.app_distribution_shares
--     FOR SELECT USING (public.app_can_read_business(business_id));
--   CREATE POLICY app_split_parties_select ON public.app_split_parties
--     FOR SELECT USING (public.app_can_read_business(business_id));
-- ---------------------------------------------------------------------------
