-- =====================================================================
-- v89.31.0: Extend app_parties with rich contact + bio metadata
-- =====================================================================
-- Adds a single JSONB `meta` column to app_parties so each party can
-- store optional contact details and biographical info:
--
--   meta.dob          : string  "YYYY-MM-DD" or "MM-DD" (year optional)
--   meta.phones       : array of strings, each "+CC NXXXXXXXXX"
--   meta.emails       : array of strings, each valid email
--   meta.description  : string, free-form notes (max 500 chars)
--
-- Why one JSONB column instead of 4 separate columns:
--   * Adding columns to a hot table can require an exclusive lock; a
--     JSONB column adds zero rows-to-rewrite cost.
--   * Phones/emails are arrays — modelling them as JSON arrays inside
--     meta is cleaner than maintaining child tables.
--   * Backward compatible: existing parties get meta = NULL which the
--     app treats as "no extra info" and the UI hides empty sections.
--
-- RLS: not changed. The existing policies on app_parties already
-- restrict reads/writes to business members, which is what we want
-- for these new fields too.
--
-- Run this in your Supabase SQL editor.

BEGIN;

-- 1. Add the column (idempotent — safe to re-run).
ALTER TABLE public.app_parties
  ADD COLUMN IF NOT EXISTS meta jsonb;

-- 2. Optional: a CHECK constraint to reject obvious garbage payloads.
--    We allow null (existing rows) and require object shape if present.
--    The app does its own validation but a server-side guard is cheap.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_parties_meta_is_object'
  ) THEN
    ALTER TABLE public.app_parties
      ADD CONSTRAINT app_parties_meta_is_object
      CHECK (meta IS NULL OR jsonb_typeof(meta) = 'object');
  END IF;
END $$;

COMMIT;

-- =====================================================================
-- Verification (run separately after the above)
-- =====================================================================
-- 1. Column exists:
--      SELECT column_name, data_type FROM information_schema.columns
--        WHERE table_schema = 'public'
--          AND table_name = 'app_parties'
--          AND column_name = 'meta';
--      Expected: 1 row, data_type = 'jsonb'
--
-- 2. Check constraint exists:
--      SELECT conname FROM pg_constraint
--        WHERE conname = 'app_parties_meta_is_object';
--      Expected: 1 row
--
-- 3. Existing parties have meta = NULL (safe default):
--      SELECT COUNT(*) FROM public.app_parties WHERE meta IS NULL;
--      Expected: equal to total party count
