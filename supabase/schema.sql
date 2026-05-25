-- ============================================================================
--  Infos — Supabase schema + Row-Level Security
-- ----------------------------------------------------------------------------
--  Run this in your Supabase project: SQL Editor → New query → paste → Run.
--
--  SECURITY MODEL
--  --------------
--  • Each authenticated user stores their entire app state as one JSONB row in
--    `app_state`, keyed by their auth user id.
--  • Row-Level Security (RLS) is ENABLED and policies restrict every operation
--    so a user can read/insert/update/delete ONLY their own row
--    (user_id = auth.uid()). This is enforced by Postgres on the server — the
--    client physically cannot read another user's data, even with a crafted
--    request, because the anon key carries the user's JWT and auth.uid() is
--    derived from it server-side.
--  • This prevents IDOR / horizontal privilege escalation by construction.
--  • The service_role key (which bypasses RLS) must NEVER be shipped to the
--    client. Only the anon (public) key goes in the browser.
-- ============================================================================

-- 1) State table -------------------------------------------------------------
create table if not exists public.app_state (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  state       jsonb not null default '{}'::jsonb,
  version     integer not null default 0,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Helpful for ordering/debugging; PK already indexes user_id.
create index if not exists app_state_updated_at_idx on public.app_state (updated_at);

-- 2) Enable Row-Level Security ----------------------------------------------
alter table public.app_state enable row level security;

-- 3) Policies: a user may touch ONLY their own row --------------------------
-- (Drop-then-create so this script is safely re-runnable.)
drop policy if exists "own row select" on public.app_state;
create policy "own row select"
  on public.app_state for select
  using (auth.uid() = user_id);

drop policy if exists "own row insert" on public.app_state;
create policy "own row insert"
  on public.app_state for insert
  with check (auth.uid() = user_id);

drop policy if exists "own row update" on public.app_state;
create policy "own row update"
  on public.app_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own row delete" on public.app_state;
create policy "own row delete"
  on public.app_state for delete
  using (auth.uid() = user_id);

-- 4) Keep updated_at honest --------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch
  before update on public.app_state
  for each row execute function public.touch_updated_at();

-- ============================================================================
--  OPTIONAL — future normalized model (when you outgrow the snapshot approach)
-- ----------------------------------------------------------------------------
--  The snapshot model above is the simplest correct first step. When you want
--  true multi-user collaboration (members editing live, server-side validation
--  per record), migrate to normalized tables — each with its own RLS. Sketch:
--
--    create table public.businesses (
--      id uuid primary key default gen_random_uuid(),
--      owner_id uuid not null references auth.users(id) on delete cascade,
--      name text not null check (char_length(name) between 1 and 120),
--      created_at timestamptz not null default now()
--    );
--    alter table public.businesses enable row level security;
--    create policy "owner manages own businesses" on public.businesses
--      using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
--
--    create table public.business_members (
--      business_id uuid references public.businesses(id) on delete cascade,
--      member_id   uuid references auth.users(id) on delete cascade,
--      role text not null check (role in ('viewer','editor')),
--      primary key (business_id, member_id)
--    );
--    -- members see businesses they belong to:
--    -- (add a policy joining business_members so members get scoped read access)
--
--  Each item table (items, balance_entries, etc.) would carry business_id and
--  an RLS policy checking either ownership OR membership. This is where
--  per-record server-side validation, editor/viewer RBAC, and least-privilege
--  access become real. Build it when collaboration requires it.
-- ============================================================================
