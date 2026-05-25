-- =============================================================================
-- v89.32.35 — Create the Distribution tables (salaries, profit shares, split parties)
-- =============================================================================
-- ROOT CAUSE of "distribution data doesn't save / doesn't sync to my other
-- device": the app pushes Distribution data to three Supabase tables —
--
--     app_distribution_salaries   (Team Salaries)
--     app_distribution_shares     (Profit Shares)
--     app_split_parties           (Split parties + their % and selection)
--
-- ...but no migration ever CREATED app_distribution_shares or
-- app_split_parties. Writing to a non-existent table fails, so the data only
-- ever lived in localStorage — present on the device that entered it, absent
-- everywhere else.
--
-- IMPORTANT (v2): the app's primary keys are NOT uuid. uid() generates a
-- 16-char text id (e.g. "a1b2c3d4e5f6a7b8"), so every existing table —
-- including app_businesses.id and app_members.business_id / user_id — uses
-- Postgres `text`. This migration therefore uses `text` ids throughout, and
-- the helper functions take text args. (The first version used uuid, which
-- produced: "operator does not exist: text = uuid".)
--
-- This migration creates all three tables with the exact shape the client's
-- toDb/fromDb mappers expect, enables RLS, adds membership-based policies
-- (members read, owner writes), and registers the tables for realtime.
--
-- Idempotent / safe to re-run. Run once in Supabase -> SQL Editor.
--
-- NOTE: this assumes app_businesses has a text `owner_id` column and
-- app_members has text `business_id` + `user_id` columns. If your column
-- names differ, adjust the two helper functions below to match the policies
-- already working on app_entries / app_transfers. auth.uid() returns uuid, so
-- it is cast to text where compared against the app's text id columns.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: may the current user READ this business's data? (owner or member)
-- MIXED schema: business ids are text, but owner_id/user_id are uuid.
-- So p_business_id is text; auth.uid() (uuid) is compared directly to the uuid owner_id/user_id columns (no cast).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_can_read_business(p_business_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_businesses b
    WHERE b.id = p_business_id
      AND b.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.app_members m
    WHERE m.business_id = p_business_id
      AND m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Helper: is the current user the OWNER of this business? (write gate)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_is_business_owner(p_business_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_businesses b
    WHERE b.id = p_business_id
      AND b.owner_id = auth.uid()
  );
$$;

-- ===========================================================================
-- TABLE 1: app_distribution_salaries  (Team Salaries)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.app_distribution_salaries (
  id                text PRIMARY KEY,
  business_id       text NOT NULL,
  name              text NOT NULL DEFAULT '',
  salary            numeric NOT NULL DEFAULT 0,
  adjustment_type   text NOT NULL DEFAULT 'deduction',
  adjustment_amount numeric NOT NULL DEFAULT 0,
  note              text NOT NULL DEFAULT '',
  created_at_local  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_distribution_salaries_business_idx
  ON public.app_distribution_salaries(business_id);

-- ===========================================================================
-- TABLE 2: app_distribution_shares  (Profit Shares)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.app_distribution_shares (
  id                text PRIMARY KEY,
  business_id       text NOT NULL,
  name              text NOT NULL DEFAULT '',
  pct               numeric NOT NULL DEFAULT 0,
  note              text NOT NULL DEFAULT '',
  created_at_local  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_distribution_shares_business_idx
  ON public.app_distribution_shares(business_id);

-- ===========================================================================
-- TABLE 3: app_split_parties  (Split parties + % + selection)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.app_split_parties (
  id                text PRIMARY KEY,
  business_id       text NOT NULL,
  name              text NOT NULL DEFAULT '',
  pct               numeric NOT NULL DEFAULT 0,
  is_selected       boolean NOT NULL DEFAULT false,
  created_at_local  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_split_parties_business_idx
  ON public.app_split_parties(business_id);

-- ===========================================================================
-- RLS — read for any business member, write for the owner only
-- ===========================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_distribution_salaries',
    'app_distribution_shares',
    'app_split_parties'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS "members read %1$s"  ON public.%1$I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "owner insert %1$s"  ON public.%1$I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "owner update %1$s"  ON public.%1$I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "owner delete %1$s"  ON public.%1$I;', t);

    EXECUTE format(
      'CREATE POLICY "members read %1$s" ON public.%1$I FOR SELECT
         USING (public.app_can_read_business(business_id));', t);

    EXECUTE format(
      'CREATE POLICY "owner insert %1$s" ON public.%1$I FOR INSERT
         WITH CHECK (public.app_is_business_owner(business_id));', t);

    EXECUTE format(
      'CREATE POLICY "owner update %1$s" ON public.%1$I FOR UPDATE
         USING (public.app_is_business_owner(business_id))
         WITH CHECK (public.app_is_business_owner(business_id));', t);

    EXECUTE format(
      'CREATE POLICY "owner delete %1$s" ON public.%1$I FOR DELETE
         USING (public.app_is_business_owner(business_id));', t);
  END LOOP;
END $$;

-- ===========================================================================
-- Realtime — so a second device updates live (REPLICA IDENTITY + publication)
-- ===========================================================================
ALTER TABLE public.app_distribution_salaries REPLICA IDENTITY FULL;
ALTER TABLE public.app_distribution_shares   REPLICA IDENTITY FULL;
ALTER TABLE public.app_split_parties         REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_distribution_salaries',
    'app_distribution_shares',
    'app_split_parties'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- Verification (run separately after the above):
--
--   select table_name from information_schema.tables
--   where table_schema='public'
--     and table_name in ('app_distribution_salaries',
--                        'app_distribution_shares',
--                        'app_split_parties');
--   -- expect 3 rows
--
-- If you still get a type error, check the actual id types with:
--   select table_name, column_name, data_type
--   from information_schema.columns
--   where table_schema='public'
--     and table_name in ('app_businesses','app_members')
--     and column_name in ('id','owner_id','business_id','user_id');
-- and tell me the result so the helpers can be matched exactly.
-- =============================================================================
