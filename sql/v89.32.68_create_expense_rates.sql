-- =============================================================================
-- v89.32.68 — Create the Expense Rate book table (app_expense_rates)
-- =============================================================================
-- Adds a per-business "rate book": named Name -> Rate pairs (e.g. Sugar = 120)
-- managed via the Expenses page "Add/Edit Rate" panel. When an expense whose
-- description matches a saved rate name is added, the client auto-computes
-- amount = qty x rate. The rate book syncs across devices like the rest of the
-- business data (owner writes, members read).
--
-- Uses the existing RLS helpers app_can_read_business(text) and
-- app_is_business_owner(text) created by v89.32.35. Text ids throughout
-- (matches the app's 16-char uid()). Idempotent / safe to re-run.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_expense_rates (
  id               text PRIMARY KEY,
  business_id      text NOT NULL,
  name             text NOT NULL DEFAULT '',
  rate             numeric NOT NULL DEFAULT 0,
  created_at_local text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_rates_biz
  ON public.app_expense_rates (business_id);

-- Optional: keep one rate per name per business (case-insensitive) — commented
-- out by default so existing duplicates don't break the migration. Enable if
-- you want the DB to enforce uniqueness.
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_rates_biz_name
--   ON public.app_expense_rates (business_id, lower(name));

ALTER TABLE public.app_expense_rates ENABLE ROW LEVEL SECURITY;

-- Members (owner + accepted members) may READ the rate book.
DROP POLICY IF EXISTS app_expense_rates_select ON public.app_expense_rates;
CREATE POLICY app_expense_rates_select ON public.app_expense_rates
  FOR SELECT USING (public.app_can_read_business(business_id));

-- Owner may INSERT.
DROP POLICY IF EXISTS app_expense_rates_insert ON public.app_expense_rates;
CREATE POLICY app_expense_rates_insert ON public.app_expense_rates
  FOR INSERT WITH CHECK (public.app_is_business_owner(business_id));

-- Owner may UPDATE.
DROP POLICY IF EXISTS app_expense_rates_update ON public.app_expense_rates;
CREATE POLICY app_expense_rates_update ON public.app_expense_rates
  FOR UPDATE USING (public.app_is_business_owner(business_id))
  WITH CHECK (public.app_is_business_owner(business_id));

-- Owner may DELETE.
DROP POLICY IF EXISTS app_expense_rates_delete ON public.app_expense_rates;
CREATE POLICY app_expense_rates_delete ON public.app_expense_rates
  FOR DELETE USING (public.app_is_business_owner(business_id));

-- Register for realtime (so other devices get live updates).
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

COMMIT;
