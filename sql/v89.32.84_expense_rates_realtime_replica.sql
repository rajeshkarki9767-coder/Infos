-- v89.32.84 — Make app_expense_rates broadcast LIVE over realtime
-- =============================================================================
-- WHY THIS EXISTS
-- A rate added/edited on one device only appeared on another device AFTER a
-- manual refresh — never instantly over the websocket. The client DOES
-- subscribe to app_expense_rates (startRealtimeListener) and DOES apply +
-- re-render incoming rate events. The gap was on the database side:
--
--   • v89.32.68 (create_expense_rates) added the table to the
--     `supabase_realtime` PUBLICATION, but never set REPLICA IDENTITY FULL.
--   • Without REPLICA IDENTITY FULL, Postgres only includes the PRIMARY KEY in
--     UPDATE/DELETE realtime payloads (and the client reads name/rate/business_id
--     from the payload). The enable_realtime migration (v89.32.5) sets FULL on
--     every OTHER synced table for exactly this reason — app_expense_rates was
--     simply missed when it was added later.
--
-- Symptom this fixes: "expenses add/edit rate only shows after refresh which I
-- entered from another device; it should show without refresh."
--
-- WHAT IT DOES
-- 1. Sets REPLICA IDENTITY FULL on app_expense_rates so realtime payloads carry
--    the full row (name, rate, business_id), letting the client apply the change
--    live.
-- 2. Re-affirms publication membership (idempotent — safe if already present).
--
-- HOW TO RUN
-- Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to run multiple times. No data is modified.
-- =============================================================================

-- 1) Full row in realtime payloads.
ALTER TABLE public.app_expense_rates REPLICA IDENTITY FULL;

-- 2) Ensure it's a member of the realtime publication (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'app_expense_rates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_expense_rates;
  END IF;
END $$;

-- 3) Verify (optional): confirm membership + replica identity.
-- SELECT tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
--     AND tablename = 'app_expense_rates';
-- SELECT relreplident FROM pg_class
--   WHERE oid = 'public.app_expense_rates'::regclass;   -- expect 'f' (FULL)
