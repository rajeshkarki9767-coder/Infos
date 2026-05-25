-- =============================================================================
-- v89.32.72 — Verify / fix RLS on app_expense_rates (rate book not saving)
-- =============================================================================
-- SYMPTOM: expense rates saved in Add/Edit Rate disappear on refresh, and View
-- Rate / Add-Edit Rate show nothing. The table exists, but if the INSERT/UPDATE
-- (or SELECT) row-level-security policies don't permit the owner, the upsert is
-- silently blocked: the rates live only in localStorage and the next cloud pull
-- (empty) overwrites them.
--
-- This (re)creates all four policies on app_expense_rates using the existing
-- helpers app_can_read_business(text) (read) and app_is_business_owner(text)
-- (write). Idempotent / safe to re-run. Run once in Supabase -> SQL Editor.
--
-- To DIAGNOSE first, the client now logs the upsert result in the console:
--   [rateSave] cloud upsert result { sent: N, savedRows: M }
--   [rateSave] 0 rows saved — likely RLS blocking INSERT/UPDATE on app_expense_rates
-- If you see savedRows: 0 (or an error), this migration fixes it.
-- =============================================================================

BEGIN;

ALTER TABLE public.app_expense_rates ENABLE ROW LEVEL SECURITY;

-- Members (owner + accepted members) may READ.
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

COMMIT;

-- Verify afterwards (should list 4 policies: SELECT/INSERT/UPDATE/DELETE):
--   select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr,
--          pg_get_expr(polwithcheck, polrelid) as check_expr
--   from pg_policy
--   where polrelid = 'public.app_expense_rates'::regclass
--   order by polcmd;
