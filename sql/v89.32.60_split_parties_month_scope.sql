-- v89.32.60: month-scope split parties (like distribution salaries/shares).
-- Adds period_month so each month keeps its own party split, and All time /
-- range views can group by name and sum across months.
BEGIN;

ALTER TABLE public.app_split_parties
  ADD COLUMN IF NOT EXISTS period_month text;

-- Backfill existing rows to the current month so legacy parties still appear
-- in the current month after the upgrade (adjust if you prefer a specific month).
UPDATE public.app_split_parties
  SET period_month = to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM')
  WHERE period_month IS NULL;

CREATE INDEX IF NOT EXISTS idx_split_parties_biz_month
  ON public.app_split_parties (business_id, period_month);

COMMIT;
