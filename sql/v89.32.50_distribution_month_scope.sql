-- =============================================================================
-- v89.32.50 — Month-scope the distribution tables
-- =============================================================================
-- Distribution (Team Salaries + Profit Shares) becomes per-month so old
-- months can be viewed as read-only snapshots. We add a period_month column
-- (text, 'YYYY-MM') to both tables. Existing rows are backfilled to the
-- current month so nothing is lost.
--
-- Parties (app_split_parties) and currency/rate (on app_businesses) stay
-- business-level (shared across all months) — NOT month-scoped.
--
-- Safe to run once. Idempotent (IF NOT EXISTS).
-- =============================================================================

BEGIN;

ALTER TABLE public.app_distribution_salaries
  ADD COLUMN IF NOT EXISTS period_month text;

ALTER TABLE public.app_distribution_shares
  ADD COLUMN IF NOT EXISTS period_month text;

-- Backfill existing rows to the current Kathmandu month (UTC+5:45).
-- Any row missing period_month is treated as "this month" so it still shows.
UPDATE public.app_distribution_salaries
  SET period_month = to_char((now() AT TIME ZONE 'UTC') + interval '5 hours 45 minutes', 'YYYY-MM')
  WHERE period_month IS NULL;

UPDATE public.app_distribution_shares
  SET period_month = to_char((now() AT TIME ZONE 'UTC') + interval '5 hours 45 minutes', 'YYYY-MM')
  WHERE period_month IS NULL;

-- Helpful index for month-scoped reads.
CREATE INDEX IF NOT EXISTS idx_dist_salaries_biz_month
  ON public.app_distribution_salaries (business_id, period_month);
CREATE INDEX IF NOT EXISTS idx_dist_shares_biz_month
  ON public.app_distribution_shares (business_id, period_month);

COMMIT;
