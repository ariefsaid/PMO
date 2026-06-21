begin;
select plan(1);

-- AC-105: catalog-driven — every ordinary table in the public schema must have
-- RLS enabled. The old test hardcoded 16 tables; that list never grew, so all
-- tables added in migrations 0006-0042 (now 35 total) were silently uncovered.
-- This single assertion is self-extending: any new business table shipped with
-- RLS disabled will fail here automatically, with the offending name(s) surfaced
-- in the diagnostic message.
--
-- Allowlist: none. Every public relkind='r' table has relrowsecurity=true as of
-- migration 0042 (verified against pg_class on a clean db reset). There are no
-- intentionally-exempt config/infra tables in the public schema:
--   - pipeline_stage_config has RLS+FORCE (migration 0008)
--   - supabase's own schema_migrations lives in supabase_migrations, not public

select is(
  (select count(*)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = false),
  0::bigint,
  'AC-105: every public table has RLS enabled (offenders: '
    || coalesce(
         (select string_agg(c2.relname, ', ' order by c2.relname)
            from pg_class c2
            join pg_namespace n2 on n2.oid = c2.relnamespace
           where n2.nspname = 'public'
             and c2.relkind = 'r'
             and c2.relrowsecurity = false),
         'none')
    || ')');

select * from finish();
rollback;
