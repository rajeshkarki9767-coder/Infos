-- =====================================================================
-- v89.31.5: Add avatar_url to app_accounts (profile pictures)
-- =====================================================================
-- Adds a text column `avatar_url` to app_accounts so each user can store
-- an optional profile picture. The app stores the picture as a small,
-- center-cropped, downscaled (<= 256px) JPEG **base64 data URL** — not a
-- link to external storage — so it travels with the profile row and
-- needs no separate bucket/CDN. Typical size is a few KB to ~30KB; the
-- client refuses to save anything over ~500KB.
--
--   avatar_url : text, nullable. A "data:image/jpeg;base64,..." string,
--                or NULL when the user has no picture.
--
-- Backward compatible: existing rows get avatar_url = NULL, which the
-- app treats as "no picture" (falls back to the name initial). The
-- client only sends the column once this migration has run.
--
-- Run this in your Supabase SQL editor BEFORE deploying the v89.31.5
-- app build. The profile push (and the Force-push path) now include
-- avatar_url; without the column those upserts would fail.
--
-- RLS: not changed. Existing app_accounts policies already restrict a
-- profile row to its owner (id = auth.uid()), which is correct for the
-- avatar too.
--
-- Storage note: base64 in a text column is fine at this size and avoids
-- the operational overhead of Supabase Storage + signed URLs. If avatar
-- sizes ever grow, migrate to Storage and keep avatar_url as the public
-- URL instead — the app already treats avatar_url as an opaque string.

BEGIN;

-- Add the column (idempotent — safe to re-run).
ALTER TABLE public.app_accounts
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.app_accounts.avatar_url IS
  'Optional profile picture as a base64 data URL (<=256px JPEG), or NULL. '
  'Added v89.31.5.';

COMMIT;

-- Verify (optional):
--   SELECT id, display_name, (avatar_url IS NOT NULL) AS has_avatar
--     FROM public.app_accounts LIMIT 10;
