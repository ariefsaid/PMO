-- 1981_light_scope_once_per_query.test.sql -- migration 1981: crew_members (and work_order_crews beside it) show every caller exactly the
-- rows they showed before (field accounts: leader, member, past member, stranger, another organisation; a full account;
-- a disabled field account), and crew_members' field-account scope is planned once per query, not called per row.
-- MUTATION NOTE: run the rollback (1981_light_scope_once_per_query_down.sql) and the plan assertion goes red; every row
-- assertion stays green (same rows is the point).
begin;
create extension if not exists pgtap;
select plan(17);

insert into organizations (id, name, default_currency, built_in_roles_enabled, default_timezone) values
  ('19810000-0000-0000-0000-00000000000a', 'LS Org',   'IDR', true, 'Asia/Jakarta'),
  ('19810000-0000-0000-0000-00000000000b', 'LS Other', 'IDR', true, 'UTC');
insert into auth.users (id, email) values
  ('19810000-0000-0000-0000-0000000000a1', 'ls-foreman@example.com'),
  ('19810000-0000-0000-0000-0000000000a2', 'ls-field@example.com'),
  ('19810000-0000-0000-0000-0000000000a3', 'ls-stranger@example.com'),
  ('19810000-0000-0000-0000-0000000000a4', 'ls-eng@example.com'),
  ('19810000-0000-0000-0000-0000000000a5', 'ls-gone@example.com'),
  ('19810000-0000-0000-0000-0000000000b1', 'ls-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('19810000-0000-0000-0000-0000000000a1', '19810000-0000-0000-0000-00000000000a', 'LS Foreman',  'ls-foreman@example.com',  'Engineer', 'active', 'foreman'),
  ('19810000-0000-0000-0000-0000000000a2', '19810000-0000-0000-0000-00000000000a', 'LS Field',    'ls-field@example.com',    'Engineer', 'active', 'field_user'),
  ('19810000-0000-0000-0000-0000000000a3', '19810000-0000-0000-0000-00000000000a', 'LS Stranger', 'ls-stranger@example.com', 'Engineer', 'active', 'field_user'),
  ('19810000-0000-0000-0000-0000000000a4', '19810000-0000-0000-0000-00000000000a', 'LS Eng',      'ls-eng@example.com',      'Engineer', 'active', null),
  ('19810000-0000-0000-0000-0000000000a5', '19810000-0000-0000-0000-00000000000a', 'LS Gone',     'ls-gone@example.com',     'Engineer', 'active', 'foreman'),
  ('19810000-0000-0000-0000-0000000000b1', '19810000-0000-0000-0000-00000000000b', 'LS XOrg',     'ls-xorg@example.com',     'Engineer', 'active', 'foreman');
insert into projects (id, org_id, name, status) values
  ('19810000-0000-0000-0000-0000000000d1', '19810000-0000-0000-0000-00000000000a', 'LS Site', 'Ongoing Project'),
  ('19810000-0000-0000-0000-0000000000d2', '19810000-0000-0000-0000-00000000000b', 'LS Other Site', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('19810000-0000-0000-0000-000000000401', '19810000-0000-0000-0000-00000000000a', '19810000-0000-0000-0000-0000000000d1', 'LS led',    'Issued', 1, 'exclusive', 0),
  ('19810000-0000-0000-0000-000000000402', '19810000-0000-0000-0000-00000000000a', '19810000-0000-0000-0000-0000000000d1', 'LS member', 'Issued', 1, 'exclusive', 0),
  ('19810000-0000-0000-0000-000000000403', '19810000-0000-0000-0000-00000000000a', '19810000-0000-0000-0000-0000000000d1', 'LS past',   'Issued', 1, 'exclusive', 0),
  ('19810000-0000-0000-0000-000000000404', '19810000-0000-0000-0000-00000000000a', '19810000-0000-0000-0000-0000000000d1', 'LS gone',   'Issued', 1, 'exclusive', 0),
  ('19810000-0000-0000-0000-000000000405', '19810000-0000-0000-0000-00000000000b', '19810000-0000-0000-0000-0000000000d2', 'LS xorg',   'Issued', 1, 'exclusive', 0);
-- c1 led by the foreman · c2 the field user is in today · c3 the field user left · c4 led by a foreman then disabled · c5 another org
insert into crews (id, org_id, code, name, field_controller_id) values
  ('19810000-0000-0000-0000-000000000c01', '19810000-0000-0000-0000-00000000000a', 'LS-1', 'LS led', '19810000-0000-0000-0000-0000000000a1'),
  ('19810000-0000-0000-0000-000000000c02', '19810000-0000-0000-0000-00000000000a', 'LS-2', 'LS member', null),
  ('19810000-0000-0000-0000-000000000c03', '19810000-0000-0000-0000-00000000000a', 'LS-3', 'LS past', null),
  ('19810000-0000-0000-0000-000000000c04', '19810000-0000-0000-0000-00000000000a', 'LS-4', 'LS gone', '19810000-0000-0000-0000-0000000000a5'),
  ('19810000-0000-0000-0000-000000000c05', '19810000-0000-0000-0000-00000000000b', 'LS-5', 'LS xorg', '19810000-0000-0000-0000-0000000000b1');
insert into people (id, org_id, kind, name, profile_id) values
  ('19810000-0000-0000-0000-000000000f01', '19810000-0000-0000-0000-00000000000a', 'own', 'LS Field person', '19810000-0000-0000-0000-0000000000a2'),
  ('19810000-0000-0000-0000-000000000f02', '19810000-0000-0000-0000-00000000000a', 'own', 'LS Worker', null),
  ('19810000-0000-0000-0000-000000000f03', '19810000-0000-0000-0000-00000000000a', 'own', 'LS Worker two', null),
  ('19810000-0000-0000-0000-000000000f05', '19810000-0000-0000-0000-00000000000b', 'own', 'LS Other worker', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from, valid_to) values
  ('19810000-0000-0000-0000-00000000000a', '19810000-0000-0000-0000-000000000c03', '19810000-0000-0000-0000-000000000f01', current_date - 60, current_date - 10),
  ('19810000-0000-0000-0000-00000000000a', '19810000-0000-0000-0000-000000000c02', '19810000-0000-0000-0000-000000000f01', current_date - 9, null),
  ('19810000-0000-0000-0000-00000000000a', '19810000-0000-0000-0000-000000000c01', '19810000-0000-0000-0000-000000000f02', current_date - 9, null),
  ('19810000-0000-0000-0000-00000000000a', '19810000-0000-0000-0000-000000000c04', '19810000-0000-0000-0000-000000000f03', current_date - 9, null),
  ('19810000-0000-0000-0000-00000000000b', '19810000-0000-0000-0000-000000000c05', '19810000-0000-0000-0000-000000000f05', current_date - 9, null);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from)
select o, ('19810000-0000-0000-0000-00000000040' || n)::uuid, ('19810000-0000-0000-0000-000000000c0' || n)::uuid, current_date - 5
  from (select n, case when n = 5 then '19810000-0000-0000-0000-00000000000b' else '19810000-0000-0000-0000-00000000000a' end::uuid as o
          from generate_series(1, 5) n) x;
update profiles set status = 'disabled' where id = '19810000-0000-0000-0000-0000000000a5';

-- What one caller reads of the two tables, through RLS, limited to this test's rows.
create or replace function pg_temp.reads(p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select coalesce((select string_agg(c.code || ':' || p.name, ',' order by c.code, p.name) from crew_members m
                     join (values ('19810000-0000-0000-0000-000000000c01'::uuid, 'LS-1'), ('19810000-0000-0000-0000-000000000c02', 'LS-2'),
                                  ('19810000-0000-0000-0000-000000000c03', 'LS-3'), ('19810000-0000-0000-0000-000000000c04', 'LS-4'),
                                  ('19810000-0000-0000-0000-000000000c05', 'LS-5')) c(id, code) on c.id = m.crew_id
                     join (values ('19810000-0000-0000-0000-000000000f01'::uuid, 'field'), ('19810000-0000-0000-0000-000000000f02', 'worker'),
                                  ('19810000-0000-0000-0000-000000000f03', 'worker2'), ('19810000-0000-0000-0000-000000000f05', 'other')) p(id, name) on p.id = m.worker_id), '-')
      || ' / ' ||
         coalesce((select string_agg(right(r.work_order_id::text, 1), ',' order by r.work_order_id) from work_order_crews r
                    where r.work_order_id::text like '19810000-%'), '-') into v;
  reset role;
  return v;
end $$;

-- The rows the 1206 policies gave, worked out as the superuser from the helpers they called (the "before").
create or replace function pg_temp.reads_before(p_uid uuid) returns text language plpgsql as $$
declare v text; light boolean; active boolean; org uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  select public.actor_is_light(), public.is_active_member(), public.auth_org_id() into light, active, org;
  select coalesce((select string_agg(c.code || ':' || p.name, ',' order by c.code, p.name) from crew_members m
                     join (values ('19810000-0000-0000-0000-000000000c01'::uuid, 'LS-1'), ('19810000-0000-0000-0000-000000000c02', 'LS-2'),
                                  ('19810000-0000-0000-0000-000000000c03', 'LS-3'), ('19810000-0000-0000-0000-000000000c04', 'LS-4'),
                                  ('19810000-0000-0000-0000-000000000c05', 'LS-5')) c(id, code) on c.id = m.crew_id
                     join (values ('19810000-0000-0000-0000-000000000f01'::uuid, 'field'), ('19810000-0000-0000-0000-000000000f02', 'worker'),
                                  ('19810000-0000-0000-0000-000000000f03', 'worker2'), ('19810000-0000-0000-0000-000000000f05', 'other')) p(id, name) on p.id = m.worker_id
                    where m.org_id = org and active and (light is not true or public.light_can_see_crew_member(m.crew_id, m.worker_id))), '-')
      || ' / ' ||
         coalesce((select string_agg(right(r.work_order_id::text, 1), ',' order by r.work_order_id) from work_order_crews r
                    where r.work_order_id::text like '19810000-%' and r.org_id = org and active
                      and (light is not true or public.light_can_see_crew(r.crew_id))), '-') into v;
  return v;
end $$;

select is(pg_temp.reads('19810000-0000-0000-0000-0000000000a1'), 'LS-1:worker / 1', 'a foreman reads the placements and roster of the crew they lead');
select is(pg_temp.reads('19810000-0000-0000-0000-0000000000a2'), 'LS-2:field,LS-3:field / 2', 'a field user reads their own placements (the old one too) and the roster of the crew they are in today');
select is(pg_temp.reads('19810000-0000-0000-0000-0000000000a3'), '- / -', 'a field user in no crew reads none');
select is(pg_temp.reads('19810000-0000-0000-0000-0000000000a4'), 'LS-1:worker,LS-2:field,LS-3:field,LS-4:worker2 / 1,2,3,4', 'a full account reads its whole organisation');
select is(pg_temp.reads('19810000-0000-0000-0000-0000000000a5'), '- / -', 'a disabled foreman reads none');
select is(pg_temp.reads('19810000-0000-0000-0000-0000000000b1'), 'LS-5:other / 5', 'another organisation''s foreman reads only their own');
select is(pg_temp.reads('19810000-0000-0000-0000-0000000000ff'), '- / -', 'a caller with no profile reads none');
select is(pg_temp.reads(p), pg_temp.reads_before(p), 'same rows as the per-row helpers gave: ' || p::text)
  from unnest(array['19810000-0000-0000-0000-0000000000a1', '19810000-0000-0000-0000-0000000000a2', '19810000-0000-0000-0000-0000000000a3',
                    '19810000-0000-0000-0000-0000000000a4', '19810000-0000-0000-0000-0000000000a5', '19810000-0000-0000-0000-0000000000b1']::uuid[]) p;
-- a placement that ended yesterday on the organisation's clock no longer puts the field user on that crew's roster
update crew_members set valid_to = ((now() at time zone 'Asia/Jakarta')::date - 1) where crew_id = '19810000-0000-0000-0000-000000000c02';
select is(pg_temp.reads('19810000-0000-0000-0000-0000000000a2'), 'LS-2:field,LS-3:field / -', 'the roster scope follows the organisation''s own day');
select is(pg_temp.reads('19810000-0000-0000-0000-0000000000a2'), pg_temp.reads_before('19810000-0000-0000-0000-0000000000a2'), 'and matches the helper there too');

-- plan shape: as a field account, the scope is an InitPlan / hashed SubPlan, never a per-row helper call
create or replace function pg_temp.plan(p_sql text) returns text language plpgsql as $$
declare r text; v text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '19810000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
  set local role authenticated;
  for r in execute 'explain (costs off) ' || p_sql loop v := v || r || E'\n'; end loop;
  reset role;
  return v;
end $$;
-- the guarded table's own filter (the plan's first Filter line) holds hashed subplans and no helper call; the helpers that
-- remain run inside the subplan, on the caller's own led crews only
select ok((select f !~ 'light_can_see' and f ~ 'hashed SubPlan' from (select substring(pg_temp.plan('select * from crew_members') from 'Filter: [^\n]*') f) x),
  'crew_members: the field-account scope is a once-per-query subplan, not a per-row helper');
select is((select count(*)::int from pg_policies where policyname = 'light_account_scope_select' and tablename = 'crew_members'
            and permissive = 'RESTRICTIVE' and cmd = 'SELECT' and roles = '{authenticated}'), 1, 'it stays a restrictive SELECT policy for signed-in accounts');

select * from finish();
rollback;
