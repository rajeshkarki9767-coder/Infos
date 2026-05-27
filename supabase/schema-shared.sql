-- ============================================================================
--  Infos — Shared Business Access : schema + RLS  (replaces the view-only model)
-- ----------------------------------------------------------------------------
--  Run AFTER base schema.sql. Safe & re-runnable (drop-then-create).
--
--  WHAT CHANGED FROM THE OLD MODEL
--  -------------------------------
--  The previous build (schema-members.sql) implemented VIEW-ONLY members via a
--  published-copy table (`shared_items`). That was the wrong design. This file
--  implements SHARED EDITING: a business is a shared workspace. The owner AND
--  every business-login user read/write the SAME data and changes sync live.
--
--  THE MODEL
--  ---------
--    businesses          one row per shared business (owner_id = the owner)
--    business_members    links a hidden business-login auth account -> a business
--    shared_state        ONE jsonb snapshot per business — the live shared data.
--                        Both the owner and all linked members read & WRITE it.
--
--  `shared_state` is the heart of the rework: instead of each user keeping the
--  business's data only in their personal `app_state`, a shared business's data
--  lives in a row keyed by business_id that everyone on that business shares.
--
--  SECURITY
--  --------
--  RLS guarantees a `shared_state` row is readable & writable ONLY by:
--    • the owner of that business, OR
--    • an auth account linked to that business via business_members.
--  A member of business A can never read or write business B. Proven by the
--  isolation tests in test/rls.test.js (run against pglite) and the SQL block
--  at the bottom (run in the Supabase SQL editor).
-- ============================================================================

-- 1) businesses --------------------------------------------------------------
create table if not exists public.businesses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null default '',
  color       text not null default '#378ADD',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists businesses_owner_idx on public.businesses (owner_id);

-- 2) business_members --------------------------------------------------------
--  Links a hidden business-login auth account to a business. `allowed_tabs` is
--  retained for optional UI scoping, but members get the FULL editable app — it
--  is no longer a security boundary (the old model used it to gate reads).
create table if not exists public.business_members (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  member_uid   uuid not null references auth.users (id) on delete cascade,
  allowed_tabs text[] not null default '{}',
  created_at   timestamptz not null default now(),
  unique (business_id, member_uid)
);
create index if not exists business_members_member_idx   on public.business_members (member_uid);
create index if not exists business_members_business_idx on public.business_members (business_id);

-- 3) shared_state ------------------------------------------------------------
--  ONE live, editable snapshot per business. Owner + members all read & write.
create table if not exists public.shared_state (
  business_cloud_id uuid primary key references public.businesses (id) on delete cascade,
  data              jsonb not null default '{}'::jsonb,
  version           integer not null default 0,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,                    -- auth.uid() of last writer (audit)
  created_at        timestamptz not null default now()
);
create index if not exists shared_state_updated_at_idx on public.shared_state (updated_at);

-- 4) Helper: may the current user access this business? ----------------------
--  TRUE if auth.uid() owns the business OR is a linked member. SECURITY DEFINER
--  so it can read businesses/business_members regardless of the caller's own
--  RLS, but it only ever answers about auth.uid() — it never returns rows, only
--  a boolean about the current user, so it cannot be used to enumerate data.
create or replace function public.can_access_business(b_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.businesses b
    where b.id = b_id and b.owner_id = auth.uid()
  ) or exists (
    select 1 from public.business_members m
    where m.business_id = b_id and m.member_uid = auth.uid()
  );
$$;

-- Kept for compatibility / optional use by the member read path detection.
create or replace function public.is_member_of(b_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = b_id and m.member_uid = auth.uid()
  );
$$;

-- 5) Enable RLS --------------------------------------------------------------
alter table public.businesses        enable row level security;
alter table public.business_members  enable row level security;
alter table public.shared_state      enable row level security;

-- 6) Policies: businesses ----------------------------------------------------
--  Owner manages their businesses. A linked member may READ the business row
--  (to show its name/color) but not modify the business record itself.
drop policy if exists "biz owner all"    on public.businesses;
create policy "biz owner all" on public.businesses
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "biz member read"  on public.businesses;
create policy "biz member read" on public.businesses
  for select
  using (public.is_member_of(id));

-- 7) Policies: business_members ---------------------------------------------
--  Owner of the business manages member rows; a member may read only their own.
drop policy if exists "bm owner manage"   on public.business_members;
create policy "bm owner manage" on public.business_members
  for all
  using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));

drop policy if exists "bm member read own" on public.business_members;
create policy "bm member read own" on public.business_members
  for select
  using (member_uid = auth.uid());

-- 8) Policies: shared_state  (the important one — shared READ + WRITE) -------
--  Anyone who can access the business (owner OR member) may select, insert,
--  update the shared row. Delete is restricted to the owner so a member can't
--  wipe the whole business.
drop policy if exists "shared read"   on public.shared_state;
create policy "shared read" on public.shared_state
  for select
  using (public.can_access_business(business_cloud_id));

drop policy if exists "shared insert" on public.shared_state;
create policy "shared insert" on public.shared_state
  for insert
  with check (public.can_access_business(business_cloud_id));

drop policy if exists "shared update" on public.shared_state;
create policy "shared update" on public.shared_state
  for update
  using (public.can_access_business(business_cloud_id))
  with check (public.can_access_business(business_cloud_id));

drop policy if exists "shared delete" on public.shared_state;
create policy "shared delete" on public.shared_state
  for delete
  using (exists (
    select 1 from public.businesses b
    where b.id = business_cloud_id and b.owner_id = auth.uid()
  ));

-- 9) keep updated_at honest --------------------------------------------------
create or replace function public.touch_shared_state()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists shared_state_touch on public.shared_state;
create trigger shared_state_touch before update on public.shared_state
  for each row execute function public.touch_shared_state();

create or replace function public.touch_businesses_updated()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists businesses_touch on public.businesses;
create trigger businesses_touch before update on public.businesses
  for each row execute function public.touch_businesses_updated();

-- 10) realtime ---------------------------------------------------------------
--  Add shared_state (and businesses) to the realtime publication so member +
--  owner devices get live updates. Guarded so re-runs don't error.
--  REPLICA IDENTITY FULL is REQUIRED for filtered realtime (we subscribe with
--  filter business_cloud_id=eq.X): without it, Postgres only sends the primary
--  key on UPDATE, the filter can't match, and live updates silently don't fire —
--  which makes the app fall back to slow polling instead of instant sync.
alter table public.shared_state replica identity full;
alter table public.businesses   replica identity full;
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.shared_state'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.businesses';   exception when others then null; end;
end $$;

-- ============================================================================
--  OPTIONAL: drop the old view-only model (run once you've migrated)
-- ----------------------------------------------------------------------------
--  The previous build created public.shared_items + member_allowed_tab(). They
--  are no longer used. Uncomment to remove them:
--
--    drop table if exists public.shared_items cascade;
--    drop function if exists public.member_allowed_tab(uuid, text);
-- ============================================================================

-- ============================================================================
--  ISOLATION TESTS (Supabase SQL editor). Programmatic equivalents live in
--  test/rls.test.js and run against pglite in CI / locally.
-- ----------------------------------------------------------------------------
--  Paste two real auth.users ids and run. Read the NOTICE output.
--
--  do $$
--  declare v_owner uuid := 'OWNER_UUID'; v_member uuid := 'MEMBER_UUID';
--          v_bizA uuid; v_bizB uuid; c int;
--  begin
--    -- owner creates biz A (with a member) and biz B (no member)
--    perform set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
--    insert into businesses(owner_id,name) values (v_owner,'A') returning id into v_bizA;
--    insert into businesses(owner_id,name) values (v_owner,'B') returning id into v_bizB;
--    insert into shared_state(business_cloud_id,data) values (v_bizA,'{"x":1}');
--    insert into shared_state(business_cloud_id,data) values (v_bizB,'{"x":2}');
--    insert into business_members(business_id,member_uid) values (v_bizA,v_member);
--    -- member: can read/write A, cannot touch B
--    perform set_config('request.jwt.claims', json_build_object('sub',v_member::text,'role','authenticated')::text, true);
--    select count(*) into c from shared_state;            raise notice 'member sees % shared rows (expect 1)', c;
--    update shared_state set data='{"x":99}' where business_cloud_id=v_bizA; raise notice 'member wrote A ok';
--    update shared_state set data='{"x":99}' where business_cloud_id=v_bizB; -- affects 0 rows (RLS)
--    select (data->>'x') into c from shared_state where business_cloud_id=v_bizB; raise notice 'B still % (expect 2)', c;
--  end $$;
-- ============================================================================
