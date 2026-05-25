-- =============================================================================
-- KNOWN-GOOD EXCEPTION: app_entry_no_hwm
-- This table will show "RLS on but NO POLICIES". That is CORRECT and INTENTIONAL,
-- not a bug. app_entry_no_hwm stores entry-number high-water-marks for atomic
-- invoice/entry numbering. The client NEVER accesses it directly (it has zero
-- .from('app_entry_no_hwm') calls — the client's __entryNoHwm is a separate
-- localStorage cache). The table is written ONLY by the SECURITY DEFINER function
-- assign_entry_no() (see v89.13_fix_invoice_numbering.sql), which runs with the
-- function owner's privileges and bypasses RLS by design. RLS-on + 0-policies
-- means "no direct client access," which is exactly what's wanted: only the
-- controlled atomic function may mutate it, so invoice numbering can't be
-- corrupted by a client write. Do NOT add client policies to this table.
-- =============================================================================

-- AUDIT — Realtime publication + RLS status (run each block separately)
-- =============================================================================
-- You pasted a result with columns (kind | table_name) showing only 3 tables
-- as REALTIME. That was a realtime-publication query, NOT the RLS audit.
-- Run the TWO blocks below separately and read each result grid.
-- These change NOTHING.
-- =============================================================================


-- ============================================================
-- BLOCK 1 — Which app_* tables are in the realtime publication?
-- The client subscribes to 17 tables for live updates. Each one that should
-- sync instantly (entries, businesses, expense_rates, members, transfers, etc.)
-- must appear here. Any expected table MISSING here = it only syncs on refresh.
-- ============================================================
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename LIKE 'app_%'
ORDER BY tablename;

-- Expected (17): app_account_groups, app_announcement_views, app_announcements,
-- app_audit_expenses, app_books, app_businesses, app_cash_accounts,
-- app_categories, app_distribution_salaries, app_distribution_shares,
-- app_entries, app_expense_rates, app_members, app_parties, app_quick_look,
-- app_split_parties, app_transfers


-- ============================================================
-- BLOCK 2 — RLS status for every app_* table (the real RLS audit)
-- rls_enabled should be true; policy_count should be > 0.
-- ============================================================
SELECT
  c.relname                          AS table_name,
  c.relrowsecurity                   AS rls_enabled,
  COALESCE(p.cnt, 0)                 AS policy_count,
  CASE
    WHEN c.relrowsecurity AND COALESCE(p.cnt,0) > 0 THEN 'OK — protected'
    WHEN c.relrowsecurity AND COALESCE(p.cnt,0) = 0 THEN 'RLS on but NO POLICIES'
    ELSE 'NOT PROTECTED'
  END                                AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN (SELECT polrelid, COUNT(*) cnt FROM pg_policy GROUP BY polrelid) p
  ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'app_%'
ORDER BY c.relname;
