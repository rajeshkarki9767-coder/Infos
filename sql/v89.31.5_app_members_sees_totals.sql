-- =====================================================================
-- v89.31.5: Add member_sees_totals to app_members
-- =====================================================================
-- Moves the "team can see totals on the entries view" setting from a
-- single business-wide flag (app_businesses.staff_sees_totals) to a
-- PER-MEMBER flag on app_members. Each Team (staff) member can now be
-- independently allowed or denied totals visibility by the owner on the
-- Team & Access page.
--
--   member_sees_totals : boolean, default false.
--                        Only meaningful for the Team (staff) role —
--                        managers and viewers always see totals.
--
-- Default is FALSE: new members start WITHOUT totals visibility, and
-- existing members get false on backfill, matching the new "default
-- off" behaviour. The owner opts each person in deliberately.
--
-- Backward compatible: the app's fromDb mapper coerces a missing/NULL
-- value to false, and toDb always writes a boolean.
--
-- Run this in your Supabase SQL editor BEFORE deploying the v89.31.5
-- app build — the members sync map now references this column, so it
-- must exist or pushes that include a member row would fail.
--
-- RLS: not changed. Existing app_members policies already govern who
-- can read/write member rows (owner manages, invitee can accept), which
-- is correct for this field too.
--
-- NOTE on the old business-wide column: app_businesses.staff_sees_totals
-- is now unused by the app. We leave it in place (harmless) rather than
-- dropping it, so older app builds still loading against this database
-- don't error. It can be dropped in a later cleanup once all clients
-- are upgraded.

BEGIN;

-- Add the column (idempotent — safe to re-run).
ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS member_sees_totals boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_members.member_sees_totals IS
  'Per-member: may this Team member see totals on the entries view? '
  'Default false. Owner toggles it on Team & Access. Added v89.31.5.';

COMMIT;

-- Verify (optional):
--   SELECT id, business_id, user_login, role, member_sees_totals
--     FROM public.app_members LIMIT 10;
