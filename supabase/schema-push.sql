-- ============================================================================
--  Infos — Web Push notifications : subscriptions table + RLS
-- ----------------------------------------------------------------------------
--  Run AFTER schema.sql and schema-shared.sql (it reuses can_access_business()).
--  Safe & re-runnable.
--
--  Stores one row per (device push subscription). When an owner saves/assigns an
--  entry to a business, an Edge Function looks up every subscription whose
--  business_cloud_id is that business and sends a Web Push to each endpoint.
--
--  SECURITY MODEL (RLS):
--   - A signed-in user (owner OR member) may INSERT/READ/DELETE a subscription
--     ONLY for a business they can access (can_access_business()), and only rows
--     stamped with their own auth uid. This prevents one user registering pushes
--     against a business they don't belong to, or reading others' endpoints.
--   - The Edge Function uses the SERVICE ROLE key (bypasses RLS) to read all
--     subscriptions for a business when sending — that key lives only on the
--     server, never in the app.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  business_cloud_id uuid not null references public.businesses (id) on delete cascade,
  endpoint          text not null,
  p256dh            text not null,
  auth              text not null,
  user_agent        text default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- One subscription endpoint per business per row; re-subscribing upserts.
  unique (business_cloud_id, endpoint)
);

create index if not exists push_subs_business_idx on public.push_subscriptions (business_cloud_id);
create index if not exists push_subs_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Read: only your own subscriptions, and only for businesses you can access.
drop policy if exists "push read own" on public.push_subscriptions;
create policy "push read own" on public.push_subscriptions
  for select
  using (user_id = auth.uid() and public.can_access_business(business_cloud_id));

-- Insert: you may only register a subscription stamped with your own uid, for a
-- business you can access.
drop policy if exists "push insert own" on public.push_subscriptions;
create policy "push insert own" on public.push_subscriptions
  for insert
  with check (user_id = auth.uid() and public.can_access_business(business_cloud_id));

-- Update: only your own rows (used for upsert refresh of keys/user_agent).
drop policy if exists "push update own" on public.push_subscriptions;
create policy "push update own" on public.push_subscriptions
  for update
  using (user_id = auth.uid() and public.can_access_business(business_cloud_id))
  with check (user_id = auth.uid() and public.can_access_business(business_cloud_id));

-- Delete: only your own rows (unsubscribe / cleanup).
drop policy if exists "push delete own" on public.push_subscriptions;
create policy "push delete own" on public.push_subscriptions
  for delete
  using (user_id = auth.uid());

-- Keep updated_at fresh on upsert.
create or replace function public.touch_push_subscriptions()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_push_subs on public.push_subscriptions;
create trigger trg_touch_push_subs
  before update on public.push_subscriptions
  for each row execute function public.touch_push_subscriptions();
