-- 2690: definer functions follow the house search-path pattern (path ends with pg_temp).
begin;
select plan(1);

select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text), '')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c
         where c like 'search_path=%' and c ~ 'pg_temp"?$')),
  '',
  '2690: every public definer function has a search_path ending with pg_temp');

select * from finish();
rollback;
