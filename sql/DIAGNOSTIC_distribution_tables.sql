-- =============================================================================
-- DIAGNOSTIC — which Distribution tables / columns currently exist?
-- =============================================================================
-- Run this FIRST in Supabase -> SQL Editor. It only READS; it changes nothing.
-- It tells you exactly what is and isn't present, so you know whether the
-- companion migration (v89.32.35) needs to run.
-- =============================================================================

-- 1) Which of the three distribution tables exist?
select 'TABLE' as kind, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'app_distribution_salaries',
    'app_distribution_shares',
    'app_split_parties'
  )
order by table_name;
-- Expect 3 rows. Fewer = the missing ones are why that data does not sync.

-- 2) Did the split_currency / split_rate columns get added (v89.32.33)?
select 'COLUMN' as kind, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'app_businesses'
  and column_name in ('split_currency', 'split_rate')
order by column_name;
-- Expect 2 rows. 0 = the v89.32.33 migration has not been run yet.

-- 3) Are the existing distribution tables registered for realtime?
select 'REALTIME' as kind, tablename as table_name
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in (
    'app_distribution_salaries',
    'app_distribution_shares',
    'app_split_parties'
  )
order by tablename;
-- Ideally 3 rows. Missing ones won't live-update across devices (but will
-- still persist + appear on next load/refresh once the table exists).
