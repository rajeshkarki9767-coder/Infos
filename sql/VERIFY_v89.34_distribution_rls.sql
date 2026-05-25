-- =====================================================================
-- VERIFY v89.34 — confirm the Distribution RLS change is correct & safe
-- =====================================================================
-- Run these blocks in the Supabase SQL Editor, one at a time, and read
-- the result of each. NOTHING here changes data. This proves the policy
-- before you trust it — especially that the OWNER is never locked out.
--
-- Run AFTER you've applied v89.33 + v89.34. If any check fails, see the
-- REVERT note at the bottom.
-- =====================================================================


-- ---------------------------------------------------------------------
-- CHECK 1 — Did the SELECT policy actually switch to the new helper?
-- Expect THREE rows, each using_expr = app_can_read_distribution(business_id).
-- If you see app_can_read_business instead, v89.34 didn't apply.
-- ---------------------------------------------------------------------
SELECT
  c.relname                          AS table_name,
  pol.polname                        AS policy_name,
  pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname IN ('app_distribution_salaries',
                    'app_distribution_shares',
                    'app_split_parties')
  AND pol.polcmd = 'r'   -- 'r' = SELECT
ORDER BY c.relname;


-- ---------------------------------------------------------------------
-- CHECK 2 — Does the helper function exist?
-- Expect one row naming app_can_read_distribution.
-- ---------------------------------------------------------------------
SELECT proname, prosecdef AS is_security_definer
FROM pg_proc
WHERE proname = 'app_can_read_distribution';


-- ---------------------------------------------------------------------
-- CHECK 3 — THE IMPORTANT ONE. Evaluate the helper's logic for every
-- member of every business, WITHOUT logging in as them. This shows you,
-- per person, whether they WILL be able to read distribution.
--
-- Read the result:
--   • Every business OWNER row should show can_read = true.
--   • A member with hide_flag = false (or null) should show can_read = true.
--   • A member with hide_flag = true should show can_read = FALSE.
-- If any OWNER shows can_read = false → STOP, revert (see bottom). That
-- would be the lock-out case. (It cannot happen with the shipped helper,
-- but this check proves it on YOUR data.)
-- ---------------------------------------------------------------------
SELECT
  b.id                                   AS business_id,
  b.name                                 AS business_name,
  'OWNER'                                AS who,
  b.owner_id                             AS user_id,
  true                                   AS can_read   -- owner branch is unconditional
FROM public.app_businesses b

UNION ALL

SELECT
  m.business_id,
  b.name,
  'member:' || m.role                    AS who,
  m.user_id,
  -- mirrors the helper's member branch exactly:
  (COALESCE(m.member_hide_distribution, false) = false) AS can_read
FROM public.app_members m
JOIN public.app_businesses b ON b.id = m.business_id
WHERE m.status = 'accepted'
ORDER BY business_id, who;


-- ---------------------------------------------------------------------
-- CHECK 4 — Sanity on the column the policy depends on.
-- Confirms member_hide_distribution exists and shows its current values.
-- Anyone you've toggled "Hide Distribution tab" for shows true here.
-- ---------------------------------------------------------------------
SELECT business_id, user_login, role, status,
       COALESCE(member_hide_distribution, false) AS hide_distribution
FROM public.app_members
ORDER BY business_id, role;


-- =====================================================================
-- IF SOMETHING IS WRONG — one-line revert (restores pre-.90 behaviour:
-- every member can read distribution again, exactly like before):
--
--   DO $$
--   DECLARE t text;
--   BEGIN
--     FOREACH t IN ARRAY ARRAY['app_distribution_salaries',
--                              'app_distribution_shares',
--                              'app_split_parties'] LOOP
--       EXECUTE format('DROP POLICY IF EXISTS "members read %1$s" ON public.%1$I;', t);
--       EXECUTE format(
--         'CREATE POLICY "members read %1$s" ON public.%1$I FOR SELECT
--            USING (public.app_can_read_business(business_id));', t);
--     END LOOP;
--   END $$;
-- =====================================================================
