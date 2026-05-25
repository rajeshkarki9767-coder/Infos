-- =====================================================================
-- v89.31.4: Add phone_country_code to app_businesses
-- =====================================================================
-- Adds a single text column `phone_country_code` to app_businesses.
-- This stores the owner's chosen DEFAULT country dialing code (e.g.
-- "+977") that the app suggests when adding a new party's phone number.
--
--   phone_country_code : text, e.g. "+977" / "+91" / "+1".
--                        Empty string ('') means "auto from currency"
--                        (the app derives a suggestion from the
--                        business currency in that case).
--
-- Backward compatible: existing rows get phone_country_code = NULL,
-- which the app's fromDb mapper coerces to '' (auto-from-currency).
-- The toDb mapper always writes a string, so new pushes populate it.
--
-- Run this in your Supabase SQL editor BEFORE deploying the v89.31.4
-- app build (the businesses sync map now references this column; the
-- column must exist or pushes that include businesses would fail).
--
-- RLS: not changed. Existing app_businesses policies already restrict
-- reads/writes to the owner, which is correct for this field too.

BEGIN;

-- Add the column (idempotent — safe to re-run).
ALTER TABLE public.app_businesses
  ADD COLUMN IF NOT EXISTS phone_country_code text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.app_businesses.phone_country_code IS
  'Default country dialing code suggested in New Party phone field. '
  '"" means auto-derive from currency. Added v89.31.4.';

COMMIT;

-- Verify (optional):
--   SELECT id, name, currency, phone_country_code FROM public.app_businesses LIMIT 5;
