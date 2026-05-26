# Infos — Shared Business Access: Rework Spec

> **STATUS: IMPLEMENTED.** This rework has been built. Business logins now get the
> FULL editable app on shared, live-synced data (not view-only). See the
> "How it was built" section at the bottom for the final design, file map, and
> the test suite (`node test/run-all.js`).

Hand this to a fresh chat with the latest zip attached to rebuild the member feature correctly.

## What the user ACTUALLY wants (confirmed)

A business login (email + password set by the owner when creating a business) should let
**anyone log in on any device and get the FULL app — same as the owner — able to make entries
(balance, items, everything), with all data shared and synced live across every device.**

In plain terms: **shared editing access to a business, like a shared workspace.** Owner and all
business-login users edit the SAME data together; changes sync live to everyone.

- ✅ Full app for everyone (NOT view-only) — business-login users can add/edit entries
- ✅ Shared data — everyone on the same business edits the same businesses/items together
- ✅ Live sync across all devices

## What was built WRONG (over-engineered — should be removed/replaced)

The current build (v45) implemented a **view-only member experience** with a separate simplified
screen and a published-copy data model. This is the WRONG design for what the user wants. The
following should be REMOVED or repurposed:

- `enterMemberView()` / `renderMemberView()` in app.js — the separate read-only member screen
- `subscribeMemberView`, `fetchMemberView`, `getMembership` (member read path) in adapter.js — partly reusable
- `publishBusiness`, `publishItems`, `unpublishBusiness`, `shared_items` table — the published-copy model
- `autoShareBusiness()` / `republishSharedBusinesses()` in app.js — the auto-publish-copy logic
- `sanitizeShared()` — was for the copy model
- The `business_members` / `shared_items` / `businesses` normalized tables + their RLS — likely not needed
- `state.bizCloudMap`, `state.__memberMode`, member-view CSS

KEEP:
- `api/create-member.js` — still useful: creates the hidden Supabase account for the business login
- The owner cloud auth + snapshot sync (`app_state` table) — this is the model to EXTEND

## The RIGHT design (recommended)

The owner account already works perfectly: logs in → full app → edits everything → syncs to the
cloud `app_state` row (one JSON snapshot per user, RLS-scoped to that user). **Make the business
login work the same way, but pointing at SHARED data.**

Cleanest approach — **shared cloud data keyed by business, not by user:**

1. **Business login = real Supabase account** (already created by `api/create-member.js` when the
   owner makes a business). Keep this.

2. **Shared data row:** instead of each user having their own `app_state`, the business's data lives
   in a row keyed by the business's cloud id. Both the owner (for that business) AND every
   business-login user read/write that SAME row.
   - Option A (simplest): a `shared_state` table: `{ business_cloud_id uuid PK, data jsonb, updated_at }`.
     RLS: readable/writable by the owner of the business AND any member linked to it (reuse
     `business_members` for the link, or store allowed uids on the row).
   - Everyone logged into that business syncs to/from this one row.

3. **On login:** detect if the account is a business login (has a `business_members` row or
   metadata role=member). If so, load the FULL normal app (NOT a special screen) but point Sync at
   the shared business row instead of the personal `app_state`. The owner, when working on a shared
   business, also reads/writes that shared row for that business's slice.

4. **Live sync:** Supabase realtime on the shared row → every device refreshes when it changes.
   (Realtime already enabled on the project.)

5. **No view-only anything** — business-login users get the same editable UI as the owner.

## The hard parts to get right (flag these)

- **Data model decision:** owner currently stores ALL their businesses in one personal `app_state`
  snapshot. For sharing, a single business's data needs to live somewhere BOTH owner and members
  reach. Cleanest is per-business shared rows; the owner's app would merge its personal businesses
  with any shared-business rows. This is the core design challenge.
- **Merge/conflict:** multiple editors on one JSON snapshot = last-write-wins clobbering. Consider
  per-record writes or at least field-level merge for balance entries, or accept last-write-wins
  initially and document it.
- **Don't break the owner's existing experience** — the personal `app_state` sync must keep working.
- **Security:** RLS must ensure only the owner + linked business-login users can read/write a given
  business's shared row. Reuse `business_members` for the linkage. TEST isolation (a member of biz
  A must not read biz B).

## Current working state to preserve (v45)
- Owner cloud auth: signup/confirm/signin/delete/password-reset/in-app-change — ALL WORKING, don't break
- Owner snapshot sync to `app_state` — WORKING
- Boot splash, auth UX, 18 test suites green
- Supabase project: realtime enabled on `businesses`+`shared_items`; tables exist; RLS isolation
  (tab-level) verified for the OLD model

## Suggested first step in the fresh chat
Decide the data model (per-business shared row), write its schema + RLS, test isolation, THEN wire
sign-in to load the full app against shared data, THEN realtime. Build in tested stages like before.
Reuse `api/create-member.js`. Remove the view-only member screen.

---

## How it was built (as-implemented)

### Data model — per-business shared row
`supabase/schema-shared.sql` (run after `schema.sql`) adds:
- `businesses` — one row per shared business (`owner_id`).
- `business_members` — links a hidden business-login auth account to a business
  (created by `api/create-member.js`). `allowed_tabs` is kept for optional UI
  scoping but is no longer a security boundary.
- `shared_state` — **one JSONB snapshot per business** (`business_cloud_id` PK).
  Both the owner and every linked member READ and WRITE this one row. This is the
  shared workspace. `version` supports last-write-wins / optimistic concurrency.

RLS: `can_access_business(b_id)` (owner OR linked member) gates select/insert/
update on `shared_state`; delete is owner-only so a member can't wipe the
business. A member of business A cannot read or write business B — proven by the
isolation tests.

### App wiring
- **`supabase/shared-slice.js`** — pure helpers converting between the app's local
  `state` and a per-business shared snapshot: `buildSharedSlice(state, localId,
  cloudId)`, `sliceToMemberState(slice)`, `memberStateToSlice(state)`,
  `applySliceToOwnerState(state, slice, localId)`. Handles local-id↔cloud-id
  normalization (so owner and member agree on item assignments), strips secrets,
  and never touches the owner's other businesses or trash.
- **`supabase/adapter.js`** — `ensureSharedBusiness`, `loadSharedState`,
  `saveSharedState`, `subscribeSharedState`, `getMemberBusiness`,
  `removeSharedBusiness`. (Old `publishBusiness`/`publishItems`/`fetchMemberView`/
  `subscribeMemberView` removed.)
- **`app.js`**
  - `enterSharedBusiness(biz, email)` — a business login loads the FULL app
    pointed at the shared row (no special screen). Sign-in and boot both route
    here when `getMemberBusiness()` resolves.
  - `pushSharedState()` — a business login's edits write the shared row (debounced
    via `persistAll`). Local prefs only (theme) persist to this device; the
    business's data lives solely in the shared row.
  - `pushOwnerSharedBusinesses()` / `startOwnerSharedSync()` — the owner mirrors
    each shared business's slice up, subscribes to its row, and applies inbound
    member edits live.
  - `refreshSharedFromCloud()` — realtime/refresh re-hydrates the full app.
  - A business login has `bizContext = null` + `__sharedMode = true`, so the full
    editable UI is enabled. `isSharedLogin()` hides owner-account surfaces
    (Businesses management, Management/Backup settings, account delete/email/pw)
    while keeping every data tab fully editable.
  - View-only member screen + CSS removed.

### Conflict model
Last-write-wins at the shared-row level, guarded by an incrementing `version`
(`saveSharedState(expectedVersion)`). Realtime means concurrent editors normally
see each other's writes within a moment; simultaneous edits to the same snapshot
resolve last-write-wins. Documented limitation — fine for small teams; move to
per-record rows if finer merge is needed later.

### Tests (`node test/run-all.js`)
- `test/rls.test.js` — RLS isolation against real Postgres (pglite): members
  read/write only their business; cross-business read/write/insert/delete blocked.
- `test/adapter.test.js` — adapter methods against a mock Supabase client.
- `test/slice.test.js` — slice build/apply/merge + id normalization.
- `test/e2e.test.js` — full flow: owner shares → member loads full app → member
  edits → owner sees them (secrets + other businesses intact) → isolation holds.
- `test/smoke.test.js` — app boots in jsdom with the shared wiring present.

### Things only the human can do
- Run `supabase/schema.sql` then `supabase/schema-shared.sql` in Supabase.
- Optionally drop the old `shared_items` table / `member_allowed_tab()` (see the
  commented block in `schema-shared.sql`).
- Ensure realtime is enabled (the schema adds `shared_state` + `businesses` to the
  `supabase_realtime` publication).
- Live-test on two devices: owner shares a business; team signs in on another
  device with the business email+password; both add/edit and see live sync.

### Troubleshooting: a business login shows the OWNER experience
Symptom: signing in with a business email/password on a fresh browser shows the
owner's businesses, an owner Profile (Change email/password, Delete account), a
Businesses tab, and the account switcher lists the owner.

Cause: `getMemberBusiness()` returned nothing, so older builds fell through to the
owner sign-in path — which then loaded/overwrote owner data under the business
account (a data leak). This happens when `schema-shared.sql` has NOT been applied
to the deployed database, so the `business_members` row can't be read.

Fixes in this build:
1. A HARD GATE: the app now also checks the account's server-stamped metadata
   (`user_metadata.role === 'member'`, set by `api/create-member.js`). A member
   account can NEVER fall through to the owner path, even if the table read fails.
2. `getMembership()` falls back to the metadata `business_id` so the login still
   resolves its business without the table.

To make shared DATA actually sync (not just route correctly), you MUST run
`supabase/schema-shared.sql` on the deployed project. Until then, a business login
gets its own empty, editable, scoped workspace (no owner data) — which is the safe
behavior.
