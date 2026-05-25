-- =====================================================================
-- v89.56: app_audit_log DELETE policy (fixes "activity log clears then
--          reappears")
-- =====================================================================
-- SYMPTOM: clearing the Activity log (owner "Clear all", or a single row,
-- or a user clearing their own login events) appears to work — the UI
-- empties — but on reload the rows come back.
--
-- ROOT CAUSE: app_audit_log has RLS enabled but NO suitable DELETE policy.
-- With RLS on and no DELETE policy that matches, the delete affects ZERO
-- rows and returns NO error (PostgREST reports success; the rows simply
-- weren't permitted to be deleted). The client clears the UI optimistically,
-- so it looks cleared — then loadBizActivityLog re-fetches from the cloud and
-- the rows reappear.
--
-- The app issues three kinds of delete against app_audit_log:
--   • owner "Clear all":       DELETE ... WHERE business_id = :biz   (+ event_type IN …)
--   • single row (owner view): DELETE ... WHERE id = :rowId
--   • user clears own logins:  DELETE ... WHERE user_id = :me        (+ event_type IN …)
--
-- This policy permits a row to be deleted when EITHER the caller owns the
-- business the row belongs to, OR the row is the caller's own. That covers
-- all three patterns with least privilege (a member can remove their own
-- entries; only the owner can clear business-wide).
--
-- SAFE / REVERSIBLE: this only governs DELETE on a log table. It does not
-- touch ledger data. Activity-log rows are forensic history; deleting them
-- is an explicit user action behind a name/email confirmation in the app.
-- Drop statement at the bottom if you ever need to revert.
--
-- NOTE: run the diagnostic (sql/v89.13_activity_log_diagnostic.sql) first if
-- you want to see the current policies; this migration is idempotent.

BEGIN;

-- Ensure RLS is on (no-op if already enabled).
ALTER TABLE public.app_audit_log ENABLE ROW LEVEL SECURITY;

-- Replace any prior variant of this policy so re-running is safe.
DROP POLICY IF EXISTS app_audit_log_delete            ON public.app_audit_log;
DROP POLICY IF EXISTS app_audit_log_owner_delete      ON public.app_audit_log;
DROP POLICY IF EXISTS app_audit_log_delete_own        ON public.app_audit_log;

CREATE POLICY app_audit_log_delete ON public.app_audit_log
  FOR DELETE
  USING (
    -- the caller's own row (covers "clear my login events" + own entries)
    (user_id = auth.uid())
    -- OR the caller owns the business this row belongs to (covers owner
    -- "Clear all" and single-row deletes from the owner activity view).
    OR (business_id IS NOT NULL AND public.app_is_business_owner(business_id))
  );

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (optional) — should now list a DELETE policy for app_audit_log:
--   SELECT policyname, cmd, qual
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'app_audit_log'
--    ORDER BY cmd, policyname;
--
-- FUNCTIONAL CHECK — as the business owner, this should now delete > 0 rows:
--   DELETE FROM public.app_audit_log
--    WHERE business_id = '<your_business_id>'
--      AND event_type IN ('entry_edited','entry_deleted');
--   (run inside a transaction and ROLLBACK if you don't actually want to clear)
--
-- REVERT (if ever needed):
--   DROP POLICY IF EXISTS app_audit_log_delete ON public.app_audit_log;
-- ---------------------------------------------------------------------------
