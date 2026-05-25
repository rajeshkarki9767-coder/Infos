-- =====================================================================
-- v89.33: Add member_hide_distribution to app_members
-- =====================================================================
-- Lets the owner HIDE the Distribution tab for an individual manager or
-- viewer, from the Team & Access page. Mirrors the per-member
-- member_sees_totals flag (v89.31.5).
--
--   member_hide_distribution : boolean, default false.
--                              true  = hide the Distribution tab for this member
--                              false = show it (the default / pre-feature behaviour)
--
-- SCOPE: this controls TAB VISIBILITY only. It declutters the member's
-- UI; it is NOT a data restriction. The existing app_distribution_* and
-- app_split_parties RLS still let any member of the business READ the
-- rows (writes remain owner-only). If you later need managers/viewers to
-- be unable to read distribution data at all, that requires changing the
-- SELECT policies on those tables — a separate, larger change.
--
-- Default is FALSE so existing managers/viewers keep seeing the tab
-- exactly as before. The owner opts each person OUT deliberately.
--
-- Backward compatible: the app's fromDb mapper coerces a missing/NULL
-- value to false (tab visible), and toDb always writes a boolean.
--
-- Run this in your Supabase SQL editor BEFORE deploying the v89.33 app
-- build — the members sync map now references this column, so it must
-- exist or pushes that include a member row would fail.
--
-- RLS: not changed. Existing app_members policies already govern who can
-- read/write member rows (owner manages, invitee can accept), which is
-- correct for this field too.

BEGIN;

-- Add the column (idempotent — safe to re-run).
ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS member_hide_distribution boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_members.member_hide_distribution IS
  'Per-member: hide the Distribution tab for this manager/viewer? '
  'Default false (visible). Owner toggles it on Team & Access. '
  'UI visibility only, not a data restriction. Added v89.33.';

COMMIT;

-- Verify (optional):
--   SELECT id, business_id, user_login, role, member_hide_distribution
--     FROM public.app_members LIMIT 10;
