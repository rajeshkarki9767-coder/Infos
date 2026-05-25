-- =============================================================================
-- v89.32.39 — One-time cleanup of accumulated junk in the Distribution tables
-- =============================================================================
-- Background: a bug in the sync drain (fixed in app build 2026.05.21.31)
-- caused DELETE ops to get stuck behind a failing upsert, so deleted rows were
-- never removed from the cloud and piled up — plus empty rows (no name, zero
-- value) accumulated. This migration removes the clearly-junk rows so the
-- Distribution screens are clean again.
--
-- IT REMOVES:
--   * salary rows with no name AND salary = 0          (never-filled rows)
--   * profit-share rows with no name AND pct = 0       (never-filled rows)
--   * split-party rows with no name                    (never-filled rows)
--
-- IT DOES NOT touch rows that have real data — including duplicates with the
-- same name. Duplicates are listed by the SELECTs at the bottom so YOU can
-- decide which to keep (deleting the wrong one could remove the row your app
-- is currently pointing at). After deploying the app fix + deleting the extra
-- duplicates from inside the app, they will now actually leave the cloud.
--
-- Safe to run once. Review the SELECT output first if you want to be cautious.
-- =============================================================================

BEGIN;

-- Remove never-filled salary rows
DELETE FROM public.app_distribution_salaries
WHERE COALESCE(NULLIF(TRIM(name), ''), '') = ''
  AND COALESCE(salary, 0) = 0
  AND COALESCE(adjustment_amount, 0) = 0;

-- Remove never-filled profit-share rows
DELETE FROM public.app_distribution_shares
WHERE COALESCE(NULLIF(TRIM(name), ''), '') = ''
  AND COALESCE(pct, 0) = 0;

-- Remove never-filled split-party rows
DELETE FROM public.app_split_parties
WHERE COALESCE(NULLIF(TRIM(name), ''), '') = ''
  AND COALESCE(pct, 0) = 0;

COMMIT;

-- =============================================================================
-- AFTER cleanup: list remaining DUPLICATES (same business + same name) so you
-- can see them. These are NOT auto-deleted — delete the extras from inside the
-- app (with build 2026.05.21.31+ the deletes will now actually stick), or
-- delete specific ids here once you've confirmed which to keep.
-- =============================================================================
SELECT 'salaries' AS t, business_id, name, COUNT(*) AS copies,
       STRING_AGG(id, ', ') AS ids
FROM public.app_distribution_salaries
GROUP BY business_id, name HAVING COUNT(*) > 1
UNION ALL
SELECT 'shares', business_id, name, COUNT(*), STRING_AGG(id, ', ')
FROM public.app_distribution_shares
GROUP BY business_id, name HAVING COUNT(*) > 1
UNION ALL
SELECT 'parties', business_id, name, COUNT(*), STRING_AGG(id, ', ')
FROM public.app_split_parties
GROUP BY business_id, name HAVING COUNT(*) > 1
ORDER BY t, name;
