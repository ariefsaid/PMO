-- 2716_role_capability_consumers.test.sql — each role capability is read by one gate function, or is held for a ruling.
-- Standing sweep over the catalogue (the CHECK list of built_in_role_capabilities) and the public function bodies and policies at head:
--   (a) every capability is read through role_has_capability / actor_has_role_capability with its literal by at least one
--       function or policy, unless it is on the explicit "held for a ruling" list below;
--   (b) a read capability is read by exactly one gate function, and by no policy directly: every channel calls that gate;
--   (c) no body or policy reads built_in_role_capabilities directly except role_has_capability itself;
--   (d) the held list is checked, not trusted: an entry that gains a reader, or leaves the catalogue, fails.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   add 'zzz_probe' to the capability CHECK list ............... (a) 'every capability is read by a gate or is held for a ruling'
--   read the table directly in a new function body ............. (c) 'no body or policy reads the capability table directly'
--   copy a gate's capability call into a second function ....... (b) 'each read capability has exactly one gate function'
--   add a held entry that is read, or remove one from the CHECK  (d) 'every held entry is still in the catalogue and still unread'
begin;
create extension if not exists pgtap;
select plan(6);

-- capabilities held in the catalogue with no reading rule yet, each awaiting a ruling
create temp table cap_held (cap text primary key, why text not null);
insert into cap_held values
  ('daily_report_enter', 'held for a ruling: no reading rule yet');

create temp table cap_catalogue as
  select (regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g'))[1] as cap
    from pg_constraint c
   where c.conrelid = 'public.built_in_role_capabilities'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%capability%';

-- readers: (cap, kind, name) for every public function body and policy expression that calls a capability helper with the literal
create temp table cap_reader as
  select k.cap, 'function'::text as kind, p.proname::text as name
    from cap_catalogue k
    join pg_proc p on p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
   where p.proname <> 'role_has_capability'
     and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ ('(role_has_capability|actor_has_role_capability)\s*\(.{0,80}?''' || k.cap || '''')
  union all
  select k.cap, 'policy', pol.tablename || '.' || pol.policyname
    from cap_catalogue k
    join pg_policies pol on pol.schemaname in ('public', 'storage')
   where coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~ ('(role_has_capability|actor_has_role_capability)\s*\(.{0,80}?''' || k.cap || '''');

select is((select coalesce(string_agg(k.cap, ', ' order by k.cap), '') from cap_catalogue k
            where not exists (select 1 from cap_reader r where r.cap = k.cap)
              and not exists (select 1 from cap_held h where h.cap = k.cap)),
  '', 'AC-RCG-001 every capability is read by a gate or is held for a ruling');

select is((select coalesce(string_agg(k.cap || ' (' || (select string_agg(r.kind || ' ' || r.name, ', ' order by r.name) from cap_reader r where r.cap = k.cap) || ')', '; ' order by k.cap), '')
             from cap_catalogue k
            where not exists (select 1 from cap_held h where h.cap = k.cap)
              and ((select count(*) from cap_reader r where r.cap = k.cap and r.kind = 'function') <> 1
                   or exists (select 1 from cap_reader r where r.cap = k.cap and r.kind = 'policy'))),
  '', 'AC-RCG-002 each read capability has exactly one gate function and no policy reads it directly');

select is((
  select coalesce(string_agg(x.name, ', ' order by x.name), '')
    from (select p.proname::text as name
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> 'role_has_capability'
             and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'built_in_role_capabilities'
          union all
          select pol.tablename || '.' || pol.policyname
            from pg_policies pol
           where coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~* 'built_in_role_capabilities') x),
  '', 'AC-RCG-003 no body or policy reads the capability table directly');

select is((select coalesce(string_agg(h.cap, ', ' order by h.cap), '') from cap_held h
            where not exists (select 1 from cap_catalogue k where k.cap = h.cap)
               or exists (select 1 from cap_reader r where r.cap = h.cap)),
  '', 'AC-RCG-004 every held entry is still in the catalogue and still unread');

select is((select count(*)::int from cap_held), 1, 'AC-RCG-004 the held list is exactly the capability awaiting a ruling (daily_report_validate is read by dsr_may_validate, 2043)');

select is((select string_agg(cap, ',' order by cap) from cap_catalogue),
  'billing_steps_run,billing_steps_view,daily_report_enter,daily_report_validate,medical_documents_view,people_documents_view,sees_prices',
  'AC-RCG-005 the catalogue lists exactly the read capabilities and the held one');

select * from finish();
rollback;
