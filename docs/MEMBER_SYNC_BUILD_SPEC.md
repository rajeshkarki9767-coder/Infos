# Infos — Member Cloud Sync: Build Spec

This document is the plan for adding **always-live cloud sync for business (team) logins**.
Hand this to a fresh chat to start the build cleanly, or follow it stage by stage.

---

## The goal (in plain terms)

- Any user signs up → owns their account → creates their own businesses + data. *(Already works.)*
- An owner gives their **team** a "business login" (email + password the owner sets) that grants
  **view-only** access to specific tabs/items of that business.
- A team member can enter that business login **on their own phone** and see the owner's shared
  data, **always live** (updates as the owner changes things).
- Team members do **not** see or manage a "separate account" — they just type the business login.

## The chosen architecture (Option 1)

**Each business login is, behind the scenes, a real Supabase auth account** — created by the owner,
but presented to the user as a simple "business login." This lets Supabase's Row-Level Security do
the access control (battle-tested) instead of hand-rolled logic.

- Owner creates a business login → app creates a hidden Supabase auth user (via a serverless
  function using the service_role key, since creating users is an admin action).
- That hidden member account is linked to the owner + business + allowed tabs in the DB.
- When the member signs in on their device, Supabase authenticates them normally; RLS scopes what
  they can read to exactly their business's shared data.
- "Always-live" = the member device subscribes to Supabase **realtime** changes on the shared data.

---

## Database design (new tables, alongside existing `app_state`)

> Keep `app_state` as-is for now (owner's own working copy / fallback). Add normalized tables that
> the member side reads from. The owner publishes a "shared view" into these tables.

```
businesses
  id            uuid pk
  owner_id      uuid  -> auth.users(id)     -- the owner account
  name          text
  color         text
  created_at    timestamptz

business_members
  id            uuid pk
  business_id   uuid  -> businesses(id)
  member_uid    uuid  -> auth.users(id)     -- the HIDDEN member auth account
  allowed_tabs  text[]                       -- which tabs this login may view
  created_at    timestamptz

shared_items
  id            uuid pk
  business_id   uuid  -> businesses(id)
  tab           text                         -- which tab/category
  data          jsonb                        -- the item payload (view-only for members)
  updated_at    timestamptz
```

## Row-Level Security (the critical part — must be tested)

- **businesses**: owner can CRUD their own (`owner_id = auth.uid()`). A member can SELECT a business
  only if a `business_members` row links their `member_uid` to it.
- **business_members**: only the owner of the business may write; a member may read only their own row.
- **shared_items**: owner of the parent business may write; a member may SELECT only items whose
  `business_id` is in their `business_members` set AND whose `tab` is in their `allowed_tabs`.

> ⚠️ Isolation tests are mandatory before trusting this: prove member A cannot read member B's
> business, and cannot read tabs they aren't allowed.

---

## The 5 build stages (each tested before the next)

1. **Schema + RLS** — create the tables and policies above. Write SQL isolation tests proving a
   member can read only their slice. Nothing in the app changes yet.
2. **Member account creation (serverless)** — a `/api/create-member` function: owner calls it to
   create the hidden Supabase account for a business login + insert the `business_members` link.
   (Uses service_role; validates the caller is the business owner.)
3. **Owner publishes shared data** — when the owner edits a business/items, mirror the view-only
   slice into `businesses` / `shared_items` so members can read it.
4. **Member sign-in + read path** — when someone signs in with a business login, detect it's a
   member account, fetch their allowed business + items from the cloud, render view-only.
5. **Always-live (realtime)** — member device subscribes to Supabase realtime on `shared_items`
   for their business, so changes appear without a manual refresh.

## What stays the same / fallback
- Owner's own experience is unchanged; `app_state` snapshot sync keeps working.
- Local business logins keep working offline; cloud read is additive.
- We do NOT break the current app at any stage — new path runs alongside until proven.

## Things only the human can do
- Run the schema SQL in Supabase.
- Add a `/api/create-member` serverless function's env (service_role already set).
- Live-test on real devices: owner creates a member login, member signs in on a SEPARATE device,
  confirms they see only allowed data and it updates live.
- Verify RLS isolation in the Supabase SQL editor with test rows.

## Honest risks
- RLS mistakes can leak data between businesses — hence mandatory isolation tests.
- "Hidden member accounts" means deleting a business should also delete its member auth accounts
  (cleanup via serverless), or they orphan.
- Realtime adds a Supabase connection per member device — fine at small scale, watch quotas.
- Existing owners' data must be migrated/published into the new tables (Stage 3).
