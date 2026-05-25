-- ===================================================================
-- Hisabs v89.13 — Invoice number reuse fix
-- ===================================================================
-- WHAT THIS FIXES:
--
-- Your current trigger assigns entry_no as:
--   max(entry_no) + 1 WHERE deleted_at is null
--
-- When entry #143 is deleted (soft-delete sets deleted_at), MAX drops
-- to #142, and the NEXT insert reuses #143. Bill numbers should never
-- be reused — once an invoice has a number, that number is taken
-- forever, even if the entry is deleted.
--
-- THE FIX:
--
-- Add a small high-water-mark table that tracks the highest entry_no
-- ever issued per (book_id, year-month). The HWM never decreases when
-- entries are deleted. The trigger reads the HWM, increments it
-- atomically, and assigns that to entry_no.
--
-- SAFE TO RUN:
--   - Wrapped in BEGIN/COMMIT (rollback on any error)
--   - Existing entries are NOT touched — their entry_no stays the same
--   - HWM is backfilled from existing entries' MAX (including deleted)
--   - The trigger is replaced atomically
-- ===================================================================

BEGIN;

-- -------------------------------------------------------------------
-- 1. Create the high-water-mark table
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_entry_no_hwm (
    book_id     TEXT NOT NULL,
    yyyymm      TEXT NOT NULL,
    hwm         INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (book_id, yyyymm)
);

-- -------------------------------------------------------------------
-- 2. Backfill HWM from existing entries
--    Include deleted ones in the MAX so we capture any number that
--    was ever issued. Safe to re-run (ON CONFLICT keeps the higher value).
-- -------------------------------------------------------------------
INSERT INTO public.app_entry_no_hwm (book_id, yyyymm, hwm)
SELECT
    book_id,
    substring(entry_date, 1, 7) AS yyyymm,
    MAX(entry_no) AS hwm
FROM public.app_entries
WHERE entry_no IS NOT NULL
  AND book_id IS NOT NULL
  AND entry_date IS NOT NULL
GROUP BY book_id, substring(entry_date, 1, 7)
ON CONFLICT (book_id, yyyymm) DO UPDATE
  SET hwm = GREATEST(public.app_entry_no_hwm.hwm, EXCLUDED.hwm),
      updated_at = NOW();

-- -------------------------------------------------------------------
-- 3. Replace the trigger function
--    Same signature as the existing assign_entry_no(); the trigger
--    binding stays as-is.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_entry_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  lock_key bigint;
  next_no  integer;
  ymo      text;
begin
  -- v89.13: server is the source of truth, and entry_no is now a
  -- monotonic high-water-mark per (book, yyyymm). Deleting an entry
  -- DOES NOT release its number — once issued, the number stays taken.
  -- Bill numbers must never be reused, even after deletion.

  -- Skip rows that don't have enough info to assign a number.
  if new.entry_date is null or new.book_id is null then
    return new;
  end if;

  ymo := substring(new.entry_date, 1, 7);

  -- Per-bucket advisory lock so two simultaneous inserts can't grab
  -- the same number. Transaction-scoped; auto-released on commit.
  lock_key := hashtextextended(new.book_id || '::' || ymo, 0);
  perform pg_advisory_xact_lock(lock_key);

  -- Atomic increment-and-read: upsert with hwm+1, return the new value.
  -- This handles three cases in one statement:
  --   (a) No HWM row for this (book, yyyymm) yet → starts at 1
  --   (b) HWM row exists → increment
  --   (c) Caller passed an explicit entry_no (rare; e.g. backfill) →
  --       bump HWM to at least that value, but still use the caller's
  --       value (handled separately below).
  if new.entry_no is not null then
    -- Explicit number passed in; honor it but bump HWM to keep monotonicity.
    insert into public.app_entry_no_hwm (book_id, yyyymm, hwm, updated_at)
    values (new.book_id, ymo, new.entry_no, now())
    on conflict (book_id, yyyymm) do update
      set hwm = greatest(public.app_entry_no_hwm.hwm, excluded.hwm),
          updated_at = now();
    return new;
  end if;

  -- Normal path: assign next number from HWM.
  insert into public.app_entry_no_hwm (book_id, yyyymm, hwm, updated_at)
  values (new.book_id, ymo, 1, now())
  on conflict (book_id, yyyymm) do update
    set hwm = public.app_entry_no_hwm.hwm + 1,
        updated_at = now()
  returning hwm into next_no;

  new.entry_no := next_no;
  return new;
end;
$function$;

COMMIT;

-- ===================================================================
-- VERIFICATION
-- ===================================================================
--
-- Run these AFTER the migration to confirm everything's healthy.
-- ===================================================================

-- 1. Confirm the HWM table exists and has rows
SELECT
    book_id,
    yyyymm,
    hwm,
    updated_at
FROM public.app_entry_no_hwm
ORDER BY book_id, yyyymm;

-- 2. Confirm the trigger function was replaced (look for v89.13 comment)
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'assign_entry_no'
  AND n.nspname = 'public';

-- 3. Spot-check: highest entry_no per book/month should match HWM
WITH per_month AS (
    SELECT
        book_id,
        substring(entry_date, 1, 7) AS yyyymm,
        MAX(entry_no) AS highest_entry_no
    FROM public.app_entries
    WHERE entry_no IS NOT NULL
      AND deleted_at IS NULL
    GROUP BY book_id, substring(entry_date, 1, 7)
)
SELECT
    h.book_id,
    h.yyyymm,
    h.hwm                       AS hwm,
    p.highest_entry_no          AS active_max,
    (h.hwm >= COALESCE(p.highest_entry_no, 0)) AS hwm_is_at_least_max
FROM public.app_entry_no_hwm h
LEFT JOIN per_month p
       ON p.book_id = h.book_id AND p.yyyymm = h.yyyymm
ORDER BY h.book_id, h.yyyymm;

-- The hwm_is_at_least_max column should ALL be true.
-- ===================================================================
