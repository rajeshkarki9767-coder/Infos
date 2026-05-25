-- =============================================================================
-- v89.32.33 — Distribution currency + rate persistence (cross-device)
-- =============================================================================
-- The Distribution page's picked currency (e.g. "Rs") and exchange rate
-- (e.g. 156) were previously stored in localStorage ONLY. As a result they
-- did not sync to the cloud and were lost when the owner switched devices.
--
-- This adds two nullable columns to app_businesses so the client can store
-- the per-business Distribution currency + rate alongside the rest of the
-- business record, which already syncs to Supabase. The Distribution split
-- parties, salaries, and profit shares already sync (app_split_parties,
-- app_dist_salaries, app_dist_shares); only currency + rate were missing.
--
-- Existing rows get NULL / 0; the client falls back to the local copy when
-- the synced fields are absent, so this is fully backward compatible.
--
-- Run once: Supabase Dashboard -> SQL Editor -> paste -> Run. Safe to re-run.
-- =============================================================================

ALTER TABLE public.app_businesses
  ADD COLUMN IF NOT EXISTS split_currency text;

ALTER TABLE public.app_businesses
  ADD COLUMN IF NOT EXISTS split_rate numeric;

-- No backfill needed:
--   * split_currency NULL/empty  -> client uses the business's own currency
--   * split_rate     NULL/0      -> client treats as "no conversion" (rate 1)
-- Both are written by the owner only (RLS already restricts business updates
-- to the owner), and read by everyone in the business via the normal sync.
