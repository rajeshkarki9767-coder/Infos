-- ===================================================================
-- Hisabs v89.13 — Activity log diagnostic
-- ===================================================================
-- "Clear activity log" on the Profile page calls Supabase delete on
-- app_audit_log with .eq('user_id', u.id). After delete it reloads
-- the list. If the list still shows entries after clearing, one of
-- these is the cause:
--
--   1. RLS denies the DELETE silently (no error returned)
--   2. The user_id column has a different name/case
--   3. The SELECT shows other users' sign-ins (no user_id filter)
--   4. The events aren't being inserted with the right user_id
--      in the first place
--
-- Run these queries and paste the results back. I'll write the
-- targeted fix from there.
-- ===================================================================


-- QUERY 1 — All RLS policies on app_audit_log
SELECT
    policyname,
    cmd,
    permissive,
    qual::text       AS using_clause,
    with_check::text AS with_check_clause
FROM pg_policies
WHERE tablename = 'app_audit_log'
ORDER BY cmd, policyname;
-- We need to see policy names + USING / WITH CHECK clauses to know if
-- DELETE is even allowed for the current user, and what filter applies.


-- QUERY 2 — Columns on app_audit_log
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'app_audit_log'
ORDER BY ordinal_position;
-- Confirms user_id column exists, what type it is, etc.


-- QUERY 3 — Sample rows for a recent sign-in
SELECT
    id, user_id, event_type, occurred_at,
    LEFT(COALESCE(description, ''), 60)  AS description_preview
FROM public.app_audit_log
WHERE event_type IN ('sign_in', 'sign_out')
ORDER BY occurred_at DESC
LIMIT 10;
-- Tells me if there ARE rows, and whether user_id matches Zeus's uid
-- (f8bc1188-c25e-4c38-9952-ccf855ee5c26).


-- QUERY 4 — Count rows that should be visible to Zeus
SELECT
    'all rows in audit log' AS scope,
    COUNT(*) AS rows
FROM public.app_audit_log
WHERE event_type IN ('sign_in', 'sign_out')
UNION ALL
SELECT
    'rows for Zeus only',
    COUNT(*)
FROM public.app_audit_log
WHERE event_type IN ('sign_in', 'sign_out')
  AND user_id = 'f8bc1188-c25e-4c38-9952-ccf855ee5c26'::uuid;
-- If "all rows" > "rows for Zeus", then the SELECT in the client
-- is showing OTHER users' rows too (because there's no user_id
-- filter in the JS), and "Clear" deletes ONLY Zeus's rows but the
-- list keeps showing everyone else's.
