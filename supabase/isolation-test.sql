-- ============================================================================
--  Infos — Member Sync ISOLATION TEST (Supabase web SQL editor version)
-- ----------------------------------------------------------------------------
--  Proves the RLS isolates members. Runs in the Supabase dashboard SQL editor
--  (no psql \set commands). Uses a DO block so we can impersonate users.
--
--  SETUP: you need TWO real auth user ids.
--    1. Create 2 accounts in your app (an owner, and a throwaway "member").
--    2. Run:  select id, email from auth.users;
--    3. Paste the two uuids into v_owner and v_member below.
--    4. Run this whole script. Read the NOTICE messages in the Results/Output.
-- ============================================================================

do $$
declare
  v_owner   uuid := 'PASTE_OWNER_UUID_HERE';
  v_member  uuid := 'PASTE_MEMBER_UUID_HERE';
  v_biz     uuid;
  c_biz     int;
  c_notices int;
  c_balance int;
begin
  -- As OWNER: create a business + items + member link (allowed: notices only)
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role','authenticated')::text, true);

  insert into public.businesses (owner_id, name, color)
    values (v_owner, 'Test Biz A', '#378ADD')
    returning id into v_biz;

  insert into public.shared_items (business_id, tab, data) values
    (v_biz, 'notices', '{"t":"visible note"}'),
    (v_biz, 'balance', '{"t":"secret balance"}');

  insert into public.business_members (business_id, member_uid, allowed_tabs)
    values (v_biz, v_member, array['notices']);

  -- As MEMBER: check what they can see
  perform set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role','authenticated')::text, true);

  select count(*) into c_biz     from public.businesses;
  select count(*) into c_notices from public.shared_items where tab = 'notices';
  select count(*) into c_balance from public.shared_items where tab = 'balance';

  raise notice '--------------------------------------------';
  raise notice 'businesses visible to member (expect 1): %', c_biz;
  raise notice 'notices items visible       (expect 1): %', c_notices;
  raise notice 'balance items visible (expect 0=safe): %', c_balance;
  if c_balance > 0 then
    raise notice '*** LEAK *** member can see a tab they are NOT allowed. DO NOT proceed.';
  else
    raise notice 'PASS: member cannot see disallowed tab. Isolation works.';
  end if;
  raise notice '--------------------------------------------';

  -- Cleanup (back as owner so RLS allows the deletes)
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role','authenticated')::text, true);
  delete from public.business_members where business_id = v_biz;
  delete from public.shared_items     where business_id = v_biz;
  delete from public.businesses       where id = v_biz;
end $$;
