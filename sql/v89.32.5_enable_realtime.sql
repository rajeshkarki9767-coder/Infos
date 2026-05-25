-- v89.32.5 — Enable Supabase Realtime for all synced tables
-- =============================================================================
-- WHY THIS EXISTS
-- The Hisabs client subscribes to postgres_changes for every synced table
-- (see startRealtimeListener). But Supabase only BROADCASTS changes for tables
-- that are members of the `supabase_realtime` publication. If a table isn't in
-- that publication, the client's subscription is valid but silent — new rows
-- (e.g. a teammate's announcement or entry) never arrive over the websocket and
-- only appear after a manual refresh, which uses a full pull instead.
--
-- Symptom this fixes: "announcements / entries only show on another member's
-- device after a refresh; sync should be instant without refresh."
--
-- WHAT IT DOES
-- 1. Sets REPLICA IDENTITY FULL on each table so realtime payloads carry the
--    full row (the client reads fields like deleted_at, status, etc. from the
--    payload; without FULL, UPDATE/DELETE payloads omit non-key columns).
-- 2. Adds each table to the supabase_realtime publication (idempotent — skips
--    tables already present, so this is safe to re-run).
--
-- HOW TO RUN
-- Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to run multiple times. No data is modified.
-- =============================================================================

-- 1) REPLICA IDENTITY FULL — so UPDATE/DELETE realtime payloads include all columns.
ALTER TABLE public.app_businesses           REPLICA IDENTITY FULL;
ALTER TABLE public.app_books                REPLICA IDENTITY FULL;
ALTER TABLE public.app_account_groups       REPLICA IDENTITY FULL;
ALTER TABLE public.app_cash_accounts        REPLICA IDENTITY FULL;
ALTER TABLE public.app_parties              REPLICA IDENTITY FULL;
ALTER TABLE public.app_categories           REPLICA IDENTITY FULL;
ALTER TABLE public.app_members              REPLICA IDENTITY FULL;
ALTER TABLE public.app_entries              REPLICA IDENTITY FULL;
ALTER TABLE public.app_audit_expenses       REPLICA IDENTITY FULL;
ALTER TABLE public.app_quick_look           REPLICA IDENTITY FULL;
ALTER TABLE public.app_announcements        REPLICA IDENTITY FULL;
ALTER TABLE public.app_announcement_views   REPLICA IDENTITY FULL;
ALTER TABLE public.app_transfers            REPLICA IDENTITY FULL;
ALTER TABLE public.app_distribution_salaries REPLICA IDENTITY FULL;

-- 2) Add each table to the supabase_realtime publication if not already a member.
--    The DO block makes each add idempotent so re-running never errors.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'app_businesses',
    'app_books',
    'app_account_groups',
    'app_cash_accounts',
    'app_parties',
    'app_categories',
    'app_members',
    'app_entries',
    'app_audit_expenses',
    'app_quick_look',
    'app_announcements',
    'app_announcement_views',
    'app_transfers',
    'app_distribution_salaries'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- 3) Verify (optional): list the tables now in the realtime publication.
--    Run this SELECT on its own to confirm all 14 tables appear.
-- SELECT tablename FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
-- ORDER BY tablename;
