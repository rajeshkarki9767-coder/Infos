-- ============================================================================
--  Infos — Member Cloud Sync : Stage 1 schema + RLS
-- ----------------------------------------------------------------------------
--  *** SUPERSEDED — DO NOT RUN FOR NEW SETUPS ***
--  This is the OLD view-only model (published-copy `shared_items`). It has been
--  replaced by the SHARED EDITING model in `schema-shared.sql`, where the owner
--  and business logins read+write one shared row per business. Use that file
--  instead. This is kept only so existing deployments can locate/drop the old
--  `shared_items` table (see the cleanup block in `schema-shared.sql`).
-- ----------------------------------------------------------------------------
--  Run AFTER the base schema.sql. Safe & re-runnable (drop-then-create).
--  This adds normalized tables so a TEAM MEMBER (a hidden Supabase auth
--  account behind a "business login") can read ONLY their allowed slice of an
--  owner's shared data — enforced by Postgres RLS, not client code.
--
--  Nothing in the app uses these yet (Stage 1 is schema only). After running,
--  use the ISOLATION TESTS at the bottom to prove a member cannot see another
--  member's or business's data.
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
--  Links a HIDDEN member auth account to a business, with the tabs it may view.
create table if not exists public.business_members (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  member_uid   uuid not null references auth.users (id) on delete cascade,
  allowed_tabs text[] not null default '{}',
  created_at   timestamptz not null default now(),
  unique (business_id, member_uid)
);
create index if not exists business_members_member_idx on public.business_members (member_uid);
create index if not exists business_members_business_idx on public.business_members (business_id);

-- 3) shared_items ------------------------------------------------------------
--  The view-only slice the owner publishes for members to read.
create table if not exists public.shared_items (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  tab          text not null,
  data         jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);
create index if not exists shared_items_business_idx on public.shared_items (business_id);
create index if not exists shared_items_business_tab_idx on public.shared_items (business_id, tab);

-- 4) Helper: is the current user a member allowed to see this business? ------
--  SECURITY DEFINER so it can read business_members regardless of the caller's
--  own RLS, but it only ever answers about auth.uid() — never leaks rows.
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

create or replace function public.member_allowed_tab(b_id uuid, t text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = b_id
      and m.member_uid = auth.uid()
      and t = any(m.allowed_tabs)
  );
$$;

-- 5) Enable RLS --------------------------------------------------------------
alter table public.businesses        enable row level security;
alter table public.business_members  enable row level security;
alter table public.shared_items      enable row level security;

-- 6) Policies: businesses ----------------------------------------------------
drop policy if exists "biz owner all" on public.businesses;
create policy "biz owner all" on public.businesses
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "biz member read" on public.businesses;
create policy "biz member read" on public.businesses
  for select
  using (public.is_member_of(id));

-- 7) Policies: business_members ---------------------------------------------
--  Owner of the business manages member rows; member may read only their own.
drop policy if exists "bm owner manage" on public.business_members;
create policy "bm owner manage" on public.business_members
  for all
  using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));

drop policy if exists "bm member read own" on public.business_members;
create policy "bm member read own" on public.business_members
  for select
  using (member_uid = auth.uid());

-- 8) Policies: shared_items --------------------------------------------------
drop policy if exists "items owner all" on public.shared_items;
create policy "items owner all" on public.shared_items
  for all
  using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));

drop policy if exists "items member read allowed" on public.shared_items;
create policy "items member read allowed" on public.shared_items
  for select
  using (public.member_allowed_tab(business_id, tab));

-- 9) keep updated_at honest --------------------------------------------------
create or replace function public.touch_shared_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists shared_items_touch on public.shared_items;
create trigger shared_items_touch before update on public.shared_items
  for each row execute function public.touch_shared_updated_at();

drop trigger if exists businesses_touch on public.businesses;
create trigger businesses_touch before update on public.businesses
  for each row execute function public.touch_shared_updated_at();

-- ============================================================================
--  ISOLATION TESTS (run manually in SQL editor to PROVE security)
-- ----------------------------------------------------------------------------
--  These must pass before trusting the model. Pseudocode — adapt with real
--  user ids from auth.users:
--
--  As owner A: insert a business + shared_items, add member M with allowed_tabs={'notices'}.
--  Then, impersonating member M (set request.jwt.claim.sub = M's uid):
--    • SELECT from businesses        → sees ONLY A's business they're linked to
--    • SELECT from shared_items WHERE tab='notices'  → returns rows
--    • SELECT from shared_items WHERE tab='balance'  → returns NOTHING (not allowed)
--    • SELECT from a DIFFERENT owner B's business    → returns NOTHING
--    • UPDATE/INSERT/DELETE anything                 → blocked (members are read-only)
--
--  If any of those leak, STOP and fix the policy before proceeding to Stage 2.
-- ============================================================================
