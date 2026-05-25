-- v89.32.7 — Per-business time zone
-- =============================================================================
-- Adds a nullable time_zone column to app_businesses to store each business's
-- IANA time zone (e.g. 'Asia/Kathmandu'). The client sets this on business
-- creation and in Business Settings (owner only), and uses it for the dashboard
-- clock plus the calendar day used by birthday detection and the default entry
-- date. Existing rows get NULL and the client falls back to the device zone,
-- so this is backward compatible.
--
-- Run once: Supabase Dashboard → SQL Editor → paste → Run. Safe to re-run.
-- =============================================================================

ALTER TABLE public.app_businesses
  ADD COLUMN IF NOT EXISTS time_zone text;

-- No backfill needed: NULL/empty means "use the device zone" on the client.
