-- 1730_idle_cost_scope.test.sql — what idle cost covers (docs/specs/idle-with-rent.spec.md). Migration under test: 1730.
-- AC-IWR-001 default keeps today's figure · AC-IWR-010 only Admin and Finance write the scope; malformed value refused;
-- the head-count helper is not callable by a client role.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   change the column default to 'people_and_equipment' ........ 'AC-IWR-001 no row reads as labour_average'
--   remove labour_cost_gate() from save_idle_cost_scope ........ 'AC-IWR-010 a Project Manager cannot write the scope'
--   grant execute on idle_headcount_days to authenticated ...... 'AC-IWR-010 a client role cannot call the head-count helper'
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name, default_currency) values ('17300000-0000-0000-0000-00000000000a', 'Idle Scope Org', 'IDR');
insert into auth.users (id, email) values
  ('17300000-0000-0000-0000-0000000000a1', 'is-fin@example.com'),
  ('17300000-0000-0000-0000-0000000000a2', 'is-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17300000-0000-0000-0000-0000000000a1', '17300000-0000-0000-0000-00000000000a', 'Fin', 'is-fin@example.com', 'Finance', 'active'),
  ('17300000-0000-0000-0000-0000000000a2', '17300000-0000-0000-0000-00000000000a', 'PM', 'is-pm@example.com', 'Project Manager', 'active');
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('17300000-0000-0000-0000-0000000000a1');

select public.save_idle_cost_setting(true);
select is((select scope from public.idle_cost_settings), 'labour_average',
  'AC-IWR-001 no row for the scope reads as labour_average (today''s figure)');
select lives_ok($$select public.save_idle_cost_scope('people_and_equipment')$$, 'AC-IWR-010 Finance sets the scope');
select is((select scope from public.idle_cost_settings), 'people_and_equipment', 'AC-IWR-010 the scope is saved');
select is((select enabled from public.idle_cost_settings), true, 'AC-IWR-010 saving the scope leaves the idle switch as it was');
select throws_ok($$select public.save_idle_cost_scope('everything')$$, '22023', null, 'AC-IWR-010 a malformed scope is refused');
select throws_ok($$select public.save_idle_cost_scope(null)$$, '22023', null, 'AC-IWR-010 an empty scope is refused');
select throws_ok($$select public.idle_headcount_days('17300000-0000-0000-0000-00000000000a', '17300000-0000-0000-0000-0000000000d1')$$, '42501', null,
  'AC-IWR-010 a client role cannot call the head-count helper');
select pg_temp.act_as('17300000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.save_idle_cost_scope('labour_average')$$, '42501', null,
  'AC-IWR-010 a Project Manager cannot write the scope');

select * from finish();
rollback;
