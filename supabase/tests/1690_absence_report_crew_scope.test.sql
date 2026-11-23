-- 1690_absence_report_crew_scope.test.sql — an absence report is read by the person, a crew manager, and the field
-- controller of the crew the person is in on that day (home crew, or the host crew on a loan day the host is scheduled).
-- The field controller of another crew, of another organisation, and a member leading no crew read none.
-- Mutation check (recorded in the report): put the 1631 arm back (a crew whose field controller is the caller, no crew test)
-- and the "another crew's field controller reads none" assertions go red; restore.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone) values
  ('16900000-0000-0000-0000-00000000000a', 'ACS Org', 'IDR', 'UTC'),
  ('16900000-0000-0000-0000-00000000000b', 'ACS Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('16900000-0000-0000-0000-0000000000a1', 'acs-foreman-a@example.com'),
  ('16900000-0000-0000-0000-0000000000a2', 'acs-foreman-b@example.com'),
  ('16900000-0000-0000-0000-0000000000a3', 'acs-worker@example.com'),
  ('16900000-0000-0000-0000-0000000000a4', 'acs-pm@example.com'),
  ('16900000-0000-0000-0000-0000000000a5', 'acs-admin@example.com'),
  ('16900000-0000-0000-0000-0000000000a6', 'acs-engineer@example.com'),
  ('16900000-0000-0000-0000-0000000000b1', 'acs-foreman-other-org@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16900000-0000-0000-0000-0000000000a1', '16900000-0000-0000-0000-00000000000a', 'ACS Foreman A', 'acs-foreman-a@example.com', 'Engineer', 'active'),
  ('16900000-0000-0000-0000-0000000000a2', '16900000-0000-0000-0000-00000000000a', 'ACS Foreman B', 'acs-foreman-b@example.com', 'Engineer', 'active'),
  ('16900000-0000-0000-0000-0000000000a3', '16900000-0000-0000-0000-00000000000a', 'ACS Worker', 'acs-worker@example.com', 'Engineer', 'active'),
  ('16900000-0000-0000-0000-0000000000a4', '16900000-0000-0000-0000-00000000000a', 'ACS PM', 'acs-pm@example.com', 'Project Manager', 'active'),
  ('16900000-0000-0000-0000-0000000000a5', '16900000-0000-0000-0000-00000000000a', 'ACS Admin', 'acs-admin@example.com', 'Admin', 'active'),
  ('16900000-0000-0000-0000-0000000000a6', '16900000-0000-0000-0000-00000000000a', 'ACS Engineer', 'acs-engineer@example.com', 'Engineer', 'active'),
  ('16900000-0000-0000-0000-0000000000b1', '16900000-0000-0000-0000-00000000000b', 'ACS Other Foreman', 'acs-foreman-other-org@example.com', 'Engineer', 'active');
create temp table acs_today as select public.equipment_org_today('16900000-0000-0000-0000-00000000000a') as d;
grant select on acs_today to authenticated;
insert into projects (id, org_id, name, status, project_manager_id) values
  ('16900000-0000-0000-0000-0000000000d1', '16900000-0000-0000-0000-00000000000a', 'ACS Site', 'Ongoing Project', '16900000-0000-0000-0000-0000000000a4');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16900000-0000-0000-0000-000000000401', '16900000-0000-0000-0000-00000000000a', '16900000-0000-0000-0000-0000000000d1', 'ACS WO host', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('16900000-0000-0000-0000-000000000c01', '16900000-0000-0000-0000-00000000000a', 'AC-A', 'Crew A', '16900000-0000-0000-0000-0000000000a1'),
  ('16900000-0000-0000-0000-000000000c02', '16900000-0000-0000-0000-00000000000a', 'AC-B', 'Crew B', '16900000-0000-0000-0000-0000000000a2'),
  ('16900000-0000-0000-0000-000000000cb1', '16900000-0000-0000-0000-00000000000b', 'AC-X', 'Other Org Crew', '16900000-0000-0000-0000-0000000000b1');
insert into people (id, org_id, kind, name, profile_id) values
  ('16900000-0000-0000-0000-000000000f01', '16900000-0000-0000-0000-00000000000a', 'own', 'ACS Worker', '16900000-0000-0000-0000-0000000000a3');
insert into crew_members (org_id, crew_id, worker_id, valid_from)
  select '16900000-0000-0000-0000-00000000000a', '16900000-0000-0000-0000-000000000c01', '16900000-0000-0000-0000-000000000f01', d - 30 from acs_today;
insert into absence_reports (id, org_id, person_id, work_date, reason, note, reported_by)
  select '16900000-0000-0000-0000-000000000b01', '16900000-0000-0000-0000-00000000000a', '16900000-0000-0000-0000-000000000f01', d, 'sick', 'acs note', '16900000-0000-0000-0000-0000000000a3' from acs_today;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.reads() returns int language sql as $$
  select count(*)::int from public.absence_reports where id = '16900000-0000-0000-0000-000000000b01'
$$;
set local role authenticated;

-- the worker is in crew A today
select pg_temp.act_as('16900000-0000-0000-0000-0000000000a1');
select is(pg_temp.reads(), 1, 'the field controller of the person''s own crew reads the report');
select pg_temp.act_as('16900000-0000-0000-0000-0000000000a2');
select is(pg_temp.reads(), 0, 'the field controller of another crew in the same organisation reads none');
select is((select count(*)::int from public.absence_reports), 0, 'the field controller of another crew reads no absence report at all');
select pg_temp.act_as('16900000-0000-0000-0000-0000000000a3');
select is(pg_temp.reads(), 1, 'the person reads their own report');
select pg_temp.act_as('16900000-0000-0000-0000-0000000000a4');
select is(pg_temp.reads(), 1, 'a Project Manager (crew manager) reads it');
select pg_temp.act_as('16900000-0000-0000-0000-0000000000a5');
select is(pg_temp.reads(), 1, 'an Admin reads it');
select pg_temp.act_as('16900000-0000-0000-0000-0000000000a6');
select is(pg_temp.reads(), 0, 'a member who leads no crew reads none');
select pg_temp.act_as('16900000-0000-0000-0000-0000000000b1');
select is(pg_temp.reads(), 0, 'the field controller of a crew in another organisation reads none');

-- loan day: the worker is lent to crew B, which is on a work order today; the report follows the worker to crew B
reset role;
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from)
  select '16900000-0000-0000-0000-00000000000a', '16900000-0000-0000-0000-000000000401', '16900000-0000-0000-0000-000000000c02', d - 5 from acs_today;
insert into crew_loans (org_id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to)
  select '16900000-0000-0000-0000-00000000000a', '16900000-0000-0000-0000-000000000f01',
         '16900000-0000-0000-0000-000000000c01', '16900000-0000-0000-0000-000000000c02', d, d from acs_today;
set local role authenticated;
select pg_temp.act_as('16900000-0000-0000-0000-0000000000a2');
select is(pg_temp.reads(), 1, 'on a loan day the host crew''s field controller reads the report');
select pg_temp.act_as('16900000-0000-0000-0000-0000000000a1');
select is(pg_temp.reads(), 0, 'on a loan day the home crew''s field controller no longer reads it');

select * from finish();
rollback;
