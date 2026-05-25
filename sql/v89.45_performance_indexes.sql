-- =====================================================================
-- v89.45: Performance indexes (scaling prep)
-- =====================================================================
-- SAFE / NON-DESTRUCTIVE. Indexes only speed up reads; they never change,
-- delete, or lock your data (CREATE INDEX without CONCURRENTLY briefly
-- locks writes on that table for the build, which is milliseconds at your
-- current size — run anytime). Each is IF NOT EXISTS, so re-running is a
-- no-op. To remove any, see the DROP list at the bottom.
--
-- WHY: the client currently pulls every table with SELECT * and filters in
-- memory. As tables grow, the columns the app filters and sorts on benefit
-- from indexes so the database returns rows fast instead of scanning the
-- whole table. The biggest win is on app_entries (the table that grows
-- most), indexed by the columns the app actually scopes by: business_id,
-- book_id, and entry_date.
--
-- These complement (do not replace) the later "incremental sync" work —
-- they make the current full pulls fast at scale, today, with zero risk.

BEGIN;

-- ---- app_entries (the high-growth table) -------------------------------
-- Most queries scope by book then date; this composite covers both.
CREATE INDEX IF NOT EXISTS idx_entries_book_date
  ON public.app_entries (book_id, entry_date);
-- Business-level scoping (RLS helpers + cross-book views).
CREATE INDEX IF NOT EXISTS idx_entries_business
  ON public.app_entries (business_id);
-- Lookups/joins by party and account (party ledgers, account balances).
CREATE INDEX IF NOT EXISTS idx_entries_party
  ON public.app_entries (party_id);
CREATE INDEX IF NOT EXISTS idx_entries_account
  ON public.app_entries (account_id);

-- ---- per-business tables (RLS + pulls all filter by business_id) -------
CREATE INDEX IF NOT EXISTS idx_books_business        ON public.app_books               (business_id);
CREATE INDEX IF NOT EXISTS idx_accgroups_business    ON public.app_account_groups       (business_id);
CREATE INDEX IF NOT EXISTS idx_cashacct_business     ON public.app_cash_accounts        (business_id);
CREATE INDEX IF NOT EXISTS idx_parties_business      ON public.app_parties              (business_id);
CREATE INDEX IF NOT EXISTS idx_categories_business   ON public.app_categories           (business_id);
CREATE INDEX IF NOT EXISTS idx_members_business      ON public.app_members              (business_id);
CREATE INDEX IF NOT EXISTS idx_auditexp_business     ON public.app_audit_expenses       (business_id);
CREATE INDEX IF NOT EXISTS idx_transfers_business    ON public.app_transfers            (business_id);
CREATE INDEX IF NOT EXISTS idx_quicklook_business    ON public.app_quick_look           (business_id);
CREATE INDEX IF NOT EXISTS idx_announce_business     ON public.app_announcements        (business_id);
CREATE INDEX IF NOT EXISTS idx_exprates_business     ON public.app_expense_rates        (business_id);

-- ---- members: the RLS helpers look up by (business_id, user_id) --------
CREATE INDEX IF NOT EXISTS idx_members_biz_user
  ON public.app_members (business_id, user_id);

-- ---- distribution tables (scoped by business + month) ------------------
CREATE INDEX IF NOT EXISTS idx_distsal_biz_month
  ON public.app_distribution_salaries (business_id, period_month);
CREATE INDEX IF NOT EXISTS idx_distshr_biz_month
  ON public.app_distribution_shares   (business_id, period_month);
CREATE INDEX IF NOT EXISTS idx_splitp_biz_month
  ON public.app_split_parties         (business_id, period_month);

COMMIT;

-- Optional: after creating, refresh planner stats so they're used immediately.
ANALYZE public.app_entries;

-- ---------------------------------------------------------------------------
-- VERIFY (optional) — list the indexes now on app_entries:
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename='app_entries' ORDER BY indexname;
--
-- REVERT (if ever needed) — drop any/all:
--   DROP INDEX IF EXISTS public.idx_entries_book_date;
--   DROP INDEX IF EXISTS public.idx_entries_business;
--   DROP INDEX IF EXISTS public.idx_entries_party;
--   DROP INDEX IF EXISTS public.idx_entries_account;
--   DROP INDEX IF EXISTS public.idx_books_business;
--   DROP INDEX IF EXISTS public.idx_accgroups_business;
--   DROP INDEX IF EXISTS public.idx_cashacct_business;
--   DROP INDEX IF EXISTS public.idx_parties_business;
--   DROP INDEX IF EXISTS public.idx_categories_business;
--   DROP INDEX IF EXISTS public.idx_members_business;
--   DROP INDEX IF EXISTS public.idx_auditexp_business;
--   DROP INDEX IF EXISTS public.idx_transfers_business;
--   DROP INDEX IF EXISTS public.idx_quicklook_business;
--   DROP INDEX IF EXISTS public.idx_announce_business;
--   DROP INDEX IF EXISTS public.idx_exprates_business;
--   DROP INDEX IF EXISTS public.idx_members_biz_user;
--   DROP INDEX IF EXISTS public.idx_distsal_biz_month;
--   DROP INDEX IF EXISTS public.idx_distshr_biz_month;
--   DROP INDEX IF EXISTS public.idx_splitp_biz_month;
-- ---------------------------------------------------------------------------
