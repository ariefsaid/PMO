-- 1980_my_home_visible_crews_once.test.sql -- migration 1980: my_home names the caller's rostered work orders without calling
-- light_can_see_crew once per rostered crew of the organisation, and names exactly the same ones.
-- MUTATION NOTE: put `and public.light_can_see_crew(c.id)` back in my_home's roster filter (1552's body) and
-- 'my_home calls no per-crew visibility helper' goes red (one call per live roster row); the row assertions stay green.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency, built_in_roles_enabled) values
  ('19800000-0000-0000-0000-00000000000a', 'VC Org',   'IDR', true),
  ('19800000-0000-0000-0000-00000000000b', 'VC Other', 'IDR', true);
insert into auth.users (id, email) values
  ('19800000-0000-0000-0000-0000000000a1', 'vc-foreman@example.com'),
  ('19800000-0000-0000-0000-0000000000a2', 'vc-field@example.com'),
  ('19800000-0000-0000-0000-0000000000a3', 'vc-nobody@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('19800000-0000-0000-0000-0000000000a1', '19800000-0000-0000-0000-00000000000a', 'VC Foreman', 'vc-foreman@example.com', 'Engineer', 'active', 'foreman'),
  ('19800000-0000-0000-0000-0000000000a2', '19800000-0000-0000-0000-00000000000a', 'VC Field',   'vc-field@example.com',   'Engineer', 'active', 'field_user'),
  ('19800000-0000-0000-0000-0000000000a3', '19800000-0000-0000-0000-00000000000a', 'VC Nobody',  'vc-nobody@example.com',  'Engineer', 'active', 'field_user');
insert into projects (id, org_id, name, status) values
  ('19800000-0000-0000-0000-0000000000d1', '19800000-0000-0000-0000-00000000000a', 'VC Site', 'Ongoing Project'),
  ('19800000-0000-0000-0000-0000000000d2', '19800000-0000-0000-0000-00000000000b', 'VC Other Site', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount)
select ('19800000-0000-0000-0000-00000000040' || n)::uuid, case when n = 5 then '19800000-0000-0000-0000-00000000000b' else '19800000-0000-0000-0000-00000000000a' end::uuid,
       case when n = 5 then '19800000-0000-0000-0000-0000000000d2' else '19800000-0000-0000-0000-0000000000d1' end::uuid,
       'VC WO ' || n, 'Issued', 1000, 'exclusive', 0
  from generate_series(1, 5) n;
-- c1 led by the foreman · c2 the field user is placed in today · c3 the field user left last week · c4 nobody's · c5 another org
insert into crews (id, org_id, code, name, field_controller_id) values
  ('19800000-0000-0000-0000-000000000c01', '19800000-0000-0000-0000-00000000000a', 'VC-1', 'VC led',      '19800000-0000-0000-0000-0000000000a1'),
  ('19800000-0000-0000-0000-000000000c02', '19800000-0000-0000-0000-00000000000a', 'VC-2', 'VC member',   null),
  ('19800000-0000-0000-0000-000000000c03', '19800000-0000-0000-0000-00000000000a', 'VC-3', 'VC past',     null),
  ('19800000-0000-0000-0000-000000000c04', '19800000-0000-0000-0000-00000000000a', 'VC-4', 'VC unrelated', null),
  ('19800000-0000-0000-0000-000000000c05', '19800000-0000-0000-0000-00000000000b', 'VC-5', 'VC other org', null);
insert into people (id, org_id, kind, name, profile_id) values
  ('19800000-0000-0000-0000-000000000f01', '19800000-0000-0000-0000-00000000000a', 'own', 'VC Field person', '19800000-0000-0000-0000-0000000000a2');
insert into crew_members (org_id, crew_id, worker_id, valid_from, valid_to) values
  ('19800000-0000-0000-0000-00000000000a', '19800000-0000-0000-0000-000000000c03', '19800000-0000-0000-0000-000000000f01', current_date - 60, current_date - 7),
  ('19800000-0000-0000-0000-00000000000a', '19800000-0000-0000-0000-000000000c02', '19800000-0000-0000-0000-000000000f01', current_date - 6, null);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from)
select o, ('19800000-0000-0000-0000-00000000040' || n)::uuid, ('19800000-0000-0000-0000-000000000c0' || n)::uuid, current_date - 30
  from (select n, case when n = 5 then '19800000-0000-0000-0000-00000000000b' else '19800000-0000-0000-0000-00000000000a' end::uuid as o
          from generate_series(1, 5) n) x;

create or replace function pg_temp.home(p_uid uuid) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  return public.my_home();
end $$;
create or replace function pg_temp.wos(p_uid uuid) returns text[] language sql as $$
  select coalesce(array_agg(w->>'title' order by w->>'title'), '{}') from jsonb_array_elements(pg_temp.home(p_uid)->'work_orders') w;
$$;

set local track_functions = 'all';
select is(pg_temp.wos('19800000-0000-0000-0000-0000000000a1'), array['VC WO 1'], 'the foreman sees the work order of the crew they lead and no other');
select is(pg_temp.wos('19800000-0000-0000-0000-0000000000a2'), array['VC WO 2'], 'the field user sees the crew they are placed in today, not the one they left');
select is(pg_temp.wos('19800000-0000-0000-0000-0000000000a3'), '{}'::text[], 'a field user in no crew sees no work order');
select is((select w->>'crew_name' from jsonb_array_elements(pg_temp.home('19800000-0000-0000-0000-0000000000a2')->'work_orders') w),
  'VC member', 'the crew named on the work order is the one the person is in');
select is((select (w->>'is_controller')::boolean from jsonb_array_elements(pg_temp.home('19800000-0000-0000-0000-0000000000a1')->'work_orders') w),
  true, 'the leader is marked as the controller');
select is((select coalesce(sum(calls), 0)::int from pg_stat_xact_user_functions where schemaname = 'public' and funcname = 'light_can_see_crew'),
  0, 'my_home calls no per-crew visibility helper');
-- and the answer is the one the per-crew helper gives, row by row, over every live roster row of the org
select set_config('request.jwt.claims', json_build_object('sub', '19800000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select is(pg_temp.wos('19800000-0000-0000-0000-0000000000a2'),
  (select coalesce(array_agg(w.title order by w.title), '{}') from work_order_crews r join crews c on c.id = r.crew_id join work_orders w on w.id = r.work_order_id
    where r.org_id = '19800000-0000-0000-0000-00000000000a' and public.light_can_see_crew(c.id)),
  'the rows equal the per-crew helper''s answer');
select ok(position('light_can_see_crew' in (select prosrc from pg_proc where oid = 'public.my_home'::regproc)) = 0, 'my_home''s body names no per-crew helper');

select set_config('request.jwt.claims', '{}', true);
select throws_ok($$ select public.my_home() $$, '42501', 'not authenticated', 'a caller without a session cannot read the phone home');

select * from finish();
rollback;
