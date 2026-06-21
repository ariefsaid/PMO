begin;
select plan(1);

-- AC-LOW-1: catalog-driven — every public table that has RLS enabled must also
-- have it forced. Hard-coding a list was fragile: 18 business tables added since
-- the original 16 were listed (procurement record + file tables, migs 0035-0041)
-- were never covered. This single assertion is self-extending: any new table that
-- enables RLS without FORCE will fail here automatically.

select is(
  (select count(*)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = true
      and c.relforcerowsecurity = false),
  0::bigint,
  'AC-LOW-1: every RLS-enabled table in public also has FORCE ROW LEVEL SECURITY');

select * from finish();
rollback;
