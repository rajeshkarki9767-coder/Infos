-- AUDIT — Row Level Security status for every app table
-- =============================================================================
-- PURPOSE
-- Confirm "full RLS" is in place: every public.app_* table should have
--   (a) RLS ENABLED, and
--   (b) at least one policy.
-- This script CHANGES NOTHING. It only reports. Run it in the Supabase SQL
-- Editor and read the result grid.
--
-- HOW TO READ THE RESULT
--   rls_enabled = true   → RLS is on for that table (good)
--   policy_count > 0     → that table has access policies (good)
-- Any row where rls_enabled = false OR policy_count = 0 is a table that is NOT
-- protected — fix it (see the enable template at the bottom).
-- =============================================================================

SELECT
  c.relname                                   AS table_name,
  c.relrowsecurity                            AS rls_enabled,
  COALESCE(p.cnt, 0)                          AS policy_count,
  CASE
    WHEN c.relrowsecurity AND COALESCE(p.cnt,0) > 0 THEN 'OK — protected'
    WHEN c.relrowsecurity AND COALESCE(p.cnt,0) = 0 THEN 'RLS on but NO POLICIES (blocks all access)'
    ELSE 'NOT PROTECTED — enable RLS + add policies'
  END                                         AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN (
  SELECT polrelid, COUNT(*) AS cnt
  FROM pg_policy
  GROUP BY polrelid
) p ON p.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'                 -- ordinary tables
  AND c.relname LIKE 'app_%'
ORDER BY c.relname;

-- =============================================================================
-- IF ANY TABLE SHOWS "NOT PROTECTED", enable RLS on it. Template (replace
-- app_TABLE and adjust the helper to match how that table is owned/read):
--
--   ALTER TABLE public.app_TABLE ENABLE ROW LEVEL SECURITY;
--
--   -- read: anyone who can read the owning business
--   CREATE POLICY app_TABLE_select ON public.app_TABLE
--     FOR SELECT USING (public.app_can_read_business(business_id));
--   -- write: only the business owner
--   CREATE POLICY app_TABLE_insert ON public.app_TABLE
--     FOR INSERT WITH CHECK (public.app_is_business_owner(business_id));
--   CREATE POLICY app_TABLE_update ON public.app_TABLE
--     FOR UPDATE USING (public.app_is_business_owner(business_id))
--                WITH CHECK (public.app_is_business_owner(business_id));
--   CREATE POLICY app_TABLE_delete ON public.app_TABLE
--     FOR DELETE USING (public.app_is_business_owner(business_id));
--
-- (For tables keyed by user instead of business, use auth.uid() = user_id.)
-- =============================================================================
