-- 1710_headcount_days.test.sql — daily head count of people with no name on the roster (docs/specs/guard-headcount.spec.md).
-- Migration under test: 1710 (headcount_days, record/approve/clear). AC-HC-005 entry authority · 006 separation of duties ·
-- 007 bounds, dates, replace and final · 012 policy/active-member shape (read visibility here; the standing sweeps 2711, 0173, 0203 cover the rest).
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   record_headcount_day: replace `public.attendance_can_record(p_crew_id)` with `true` ... 'AC-HC-005 Finance ...' and the Engineer refusal
--   record/approve/clear: remove `perform public.assert_not_light();` ........................ 'AC-HC-005 a field account ...'
--   approve_headcount_day: replace `v_uid = any(v_h.recorded_by_ids)` with `false` ............ 'AC-HC-006 the person who entered ...'
--   approve_headcount_day: replace `not public.crew_can_manage()` with `false` ................. 'AC-HC-006 Finance cannot approve'
--   record_headcount_day: delete the `approved_at is not null` refusal ........................ 'AC-HC-007 ... approved line is final'
begin;
create extension if not exists pgtap;
select plan(38);

insert into organizations (id, name, default_currency) values ('17100000-0000-0000-0000-00000000000a', 'Head Count Org', 'IDR'), ('17100000-0000-0000-0000-00000000000b', 'Other Org', 'IDR');
update organizations set built_in_roles_enabled = true where id = '17100000-0000-0000-0000-00000000000a';
insert into auth.users (id, email) values
  ('17100000-0000-0000-0000-0000000000a1', 'hc-admin@example.com'), ('17100000-0000-0000-0000-0000000000a2', 'hc-exec@example.com'), ('17100000-0000-0000-0000-0000000000a3', 'hc-pm@example.com'),
  ('17100000-0000-0000-0000-0000000000a4', 'hc-fin@example.com'), ('17100000-0000-0000-0000-0000000000a5', 'hc-foreman@example.com'), ('17100000-0000-0000-0000-0000000000a6', 'hc-eng@example.com'),
  ('17100000-0000-0000-0000-0000000000a7', 'hc-field@example.com'), ('17100000-0000-0000-0000-0000000000a8', 'hc-gone@example.com'), ('17100000-0000-0000-0000-0000000000b1', 'hc-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('17100000-0000-0000-0000-0000000000a1', '17100000-0000-0000-0000-00000000000a', 'Admin', 'hc-admin@example.com', 'Admin', 'active', null),
  ('17100000-0000-0000-0000-0000000000a2', '17100000-0000-0000-0000-00000000000a', 'Exec', 'hc-exec@example.com', 'Executive', 'active', null),
  ('17100000-0000-0000-0000-0000000000a3', '17100000-0000-0000-0000-00000000000a', 'PM', 'hc-pm@example.com', 'Project Manager', 'active', null),
  ('17100000-0000-0000-0000-0000000000a4', '17100000-0000-0000-0000-00000000000a', 'Fin', 'hc-fin@example.com', 'Finance', 'active', null),
  ('17100000-0000-0000-0000-0000000000a5', '17100000-0000-0000-0000-00000000000a', 'Foreman', 'hc-foreman@example.com', 'Engineer', 'active', null),
  ('17100000-0000-0000-0000-0000000000a6', '17100000-0000-0000-0000-00000000000a', 'Engineer', 'hc-eng@example.com', 'Engineer', 'active', null),
  ('17100000-0000-0000-0000-0000000000a7', '17100000-0000-0000-0000-00000000000a', 'Field', 'hc-field@example.com', 'Engineer', 'active', 'field_user'),
  ('17100000-0000-0000-0000-0000000000a8', '17100000-0000-0000-0000-00000000000a', 'Gone', 'hc-gone@example.com', 'Project Manager', 'disabled', null),
  ('17100000-0000-0000-0000-0000000000b1', '17100000-0000-0000-0000-00000000000b', 'Other', 'hc-other@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, currency) values ('17100000-0000-0000-0000-0000000000d1', '17100000-0000-0000-0000-00000000000a', 'HC Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-00000000000a', '17100000-0000-0000-0000-0000000000d1', 'WO-1', 'One', 'Issued', 10000, 'exclusive', 0, 'IDR');
insert into crews (id, org_id, code, name, field_controller_id) values
  ('17100000-0000-0000-0000-000000000c01', '17100000-0000-0000-0000-00000000000a', 'HC-A', 'Crew A', '17100000-0000-0000-0000-0000000000a5'),
  ('17100000-0000-0000-0000-000000000c02', '17100000-0000-0000-0000-00000000000a', 'HC-B', 'Crew B', null);
insert into labour_cost_classes (id, org_id, code, name, archived_at) values
  ('17100000-0000-0000-0000-000000000e01', '17100000-0000-0000-0000-00000000000a', 'hc_guard', 'Guard', null),
  ('17100000-0000-0000-0000-000000000e02', '17100000-0000-0000-0000-00000000000a', 'hc_old', 'Old', now());
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('17100000-0000-0000-0000-00000000000a', '17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', current_date - 40);
create temp table d as select public.equipment_org_today('17100000-0000-0000-0000-00000000000a') as t;
grant select on d to authenticated;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
set local role authenticated;
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 1, '17100000-0000-0000-0000-000000000e01', 3) $$, 'AC-HC-005 an Admin enters a head count');
select is((select head_count from public.headcount_days where work_date = (select t from d) - 1), 3, 'AC-HC-005 the line holds the number and (RLS) the Admin reads it');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 2, '17100000-0000-0000-0000-000000000e01', 2) $$, 'AC-HC-005 an Executive enters a head count');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 3, '17100000-0000-0000-0000-000000000e01', 1) $$, 'AC-HC-005 a Project Manager enters a head count');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a5');
select lives_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 4, '17100000-0000-0000-0000-000000000e01', 4) $$, 'AC-HC-005 the crew''s own foreman with a regular account enters a head count');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 5, '17100000-0000-0000-0000-000000000e01', 1) $$, '42501', 'not authorized', 'AC-HC-005 Finance is refused');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a6');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 5, '17100000-0000-0000-0000-000000000e01', 1) $$, '42501', 'not authorized', 'AC-HC-005 an Engineer who is not the crew''s foreman is refused');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a7');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 5, '17100000-0000-0000-0000-000000000e01', 1) $$, '42501', 'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this', 'AC-HC-005 a field account is refused');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a8');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 5, '17100000-0000-0000-0000-000000000e01', 1) $$, '42501', null, 'AC-HC-005 a disabled account is refused');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 5, '17100000-0000-0000-0000-000000000e01', 1) $$, 'P0002', 'work order or crew not found', 'AC-HC-005 another organisation''s ids read as absent');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c02', (select t from d) - 5, '17100000-0000-0000-0000-000000000e01', 1) $$, '22023', 'HC_CREW_NOT_ROSTERED: that crew is not on this work order on that date', 'AC-HC-005 a crew not on the work order that day is refused');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 5, '17100000-0000-0000-0000-000000000e01', 0) $$, '22023', 'HC_COUNT: a head count is a whole number from 1 to 500', 'AC-HC-007 a count of 0 is refused');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 5, '17100000-0000-0000-0000-000000000e01', 501) $$, '22023', 'HC_COUNT: a head count is a whole number from 1 to 500', 'AC-HC-007 a count of 501 is refused');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) + 1, '17100000-0000-0000-0000-000000000e01', 2) $$, '23514', 'HC_DATE_FUTURE: a head count cannot be recorded for a future date', 'AC-HC-007 a future date is refused');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 30, '17100000-0000-0000-0000-000000000e01', 2) $$, '23514', null, 'AC-HC-007 a date before the back-date limit is refused');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 5, '17100000-0000-0000-0000-000000000e02', 2) $$, '22023', 'HC_CLASS: choose a labour class that is not archived', 'AC-HC-007 an archived class is refused');
select lives_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 1, '17100000-0000-0000-0000-000000000e01', 5) $$, 'AC-HC-007 entering the same class again before approval replaces the number');
select is((select count(*)::int from public.headcount_days where work_date = (select t from d) - 1), 1, 'AC-HC-007 still one line for the day and class');
select is((select head_count from public.headcount_days where work_date = (select t from d) - 1), 5, 'AC-HC-007 the new number is kept');
select throws_ok($$ select public.approve_headcount_day((select id from public.headcount_days where work_date = (select t from d) - 1)) $$, '42501', 'separation of duties: the person who entered a head count cannot approve it', 'AC-HC-006 the person who entered a head count cannot approve it');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.approve_headcount_day((select id from public.headcount_days where work_date = (select t from d) - 4)) $$, '42501', 'separation of duties: the person who entered a head count cannot approve it', 'AC-HC-006 the foreman who entered it cannot approve it either');
select throws_ok($$ select public.approve_headcount_day((select id from public.headcount_days where work_date = (select t from d) - 3)) $$, '42501', 'not authorized', 'AC-HC-006 a foreman with the Engineer role cannot approve another''s line');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.approve_headcount_day((select id from public.headcount_days where work_date = (select t from d) - 3)) $$, '42501', 'not authorized', 'AC-HC-006 Finance cannot approve');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a7');
select throws_ok($$ select public.approve_headcount_day((select id from public.headcount_days where work_date = (select t from d) - 3)) $$, '42501', 'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this', 'AC-HC-006 a field account cannot approve');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.approve_headcount_day((select id from public.headcount_days where work_date = (select t from d) - 2)) $$, 'AC-HC-006 a different Project Manager-level approver approves');
select ok((select approved_at is not null and approved_by is not null from public.headcount_days where work_date = (select t from d) - 2), 'AC-HC-006 approval is stamped with who and when');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.approve_headcount_day((select id from public.headcount_days where work_date = (select t from d) - 3)) $$, 'AC-HC-006 an Admin approves a line the Project Manager entered');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.record_headcount_day('17100000-0000-0000-0000-000000000401', '17100000-0000-0000-0000-000000000c01', (select t from d) - 2, '17100000-0000-0000-0000-000000000e01', 9) $$, '23514', 'HC_LOCKED: this head count is approved and final', 'AC-HC-007 an approved line is final: entering again is refused');
select throws_ok($$ select public.clear_headcount_day((select id from public.headcount_days where work_date = (select t from d) - 2)) $$, '23514', 'HC_LOCKED: this head count is approved and final', 'AC-HC-007 an approved line cannot be cleared');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.approve_headcount_day((select id from public.headcount_days where work_date = (select t from d) - 2)) $$, '23514', 'HC_LOCKED: this head count is approved and final', 'AC-HC-007 an approved line cannot be approved twice');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.clear_headcount_day((select id from public.headcount_days where work_date = (select t from d) - 4)) $$, '42501', 'not authorized', 'AC-HC-005 Finance cannot clear a line');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a5');
select lives_ok($$ select public.clear_headcount_day((select id from public.headcount_days where work_date = (select t from d) - 4)) $$, 'AC-HC-005 the foreman clears an unapproved line');
select is((select count(*)::int from public.headcount_days where work_date = (select t from d) - 4), 0, 'AC-HC-005 the cleared line is gone');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a4');
select ok((select count(*)::int from public.headcount_days) >= 3, 'AC-HC-012 Finance reads the head counts');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from public.headcount_days), 0, 'AC-HC-012 an Engineer who is not the foreman reads none');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a7');
select is((select count(*)::int from public.headcount_days), 0, 'AC-HC-012 a field account reads none');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.headcount_days), 0, 'AC-HC-012 another organisation reads none');
select pg_temp.act_as('17100000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.headcount_days), 3, 'AC-HC-012 the crew''s foreman reads the crew''s lines');
select * from finish();
rollback;
