-- =============================================================================
-- v89.32.69 — Distribution per-month rate/currency snapshots (cross-device)
-- =============================================================================
-- The Distribution page records, for each month, the currency + exchange rate
-- that were active that month, so History can show what was saved THAT month
-- (not the current value). Previously these snapshots lived in localStorage
-- ONLY, so they didn't survive a device switch.
--
-- This adds one JSON column to app_businesses holding a map keyed by 'YYYY-MM':
--   { "2026-04": { "currency": "Rs", "rate": 156 }, "2026-05": { ... } }
-- The client mirrors its snapshots here (owner writes, everyone reads via the
-- normal business-row sync). Existing rows default to an empty object.
--
-- Salaries, profit shares, and split parties are already month-scoped and
-- cloud-synced (period_month on their own tables), so the per-month rate was
-- the only missing piece for fully cloud-backed History.
--
-- Idempotent / safe to re-run. Run once in Supabase -> SQL Editor.
-- =============================================================================

ALTER TABLE public.app_businesses
  ADD COLUMN IF NOT EXISTS month_rate_snaps jsonb NOT NULL DEFAULT '{}'::jsonb;

-- No backfill needed: empty {} means "no snapshot for any month yet", and the
-- client falls back to its localStorage copy when the synced map is empty.
-- Writes are owner-only (RLS on app_businesses already restricts UPDATE to the
-- owner) and read by everyone in the business via the normal sync.
