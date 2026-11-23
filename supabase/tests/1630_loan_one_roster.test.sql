-- 1630_loan_one_roster.test.sql — a lent worker appears in exactly one roster on every loan day.
-- Host crew scheduled on a work order that day: the host roster only. Host crew on no work order that day: the home roster
-- (never lost). Mutation check: drop the "host is rostered" test from worker_effective_crew and the third assertion fails.
begin;
create extension if not exists pgtap;
select plan(6);

insert into organizations (id, name, default_currency) values ('16300000-0000-0000-0000-00000000000a', 'ONE Org', 'IDR');
create temp table one_today as select public.equipment_org_today('16300000-0000-0000-0000-00000000000a') as d;
grant select on one_today to authenticated;
create or replace function pg_temp.d(p int) returns date language sql stable as $$ select d + p from one_today $$;
insert into auth.users (id, email) values ('16300000-0000-0000-0000-0000000000a1', 'one-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16300000-0000-0000-0000-0000000000a1', '16300000-0000-0000-0000-00000000000a', 'ONE Admin', 'one-admin@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('16300000-0000-0000-0000-0000000000d1', '16300000-0000-0000-0000-00000000000a', 'ONE Site', 'Ongoing Project', '16300000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16300000-0000-0000-0000-000000000401', '16300000-0000-0000-0000-00000000000a', '16300000-0000-0000-0000-0000000000d1', 'ONE WO home', 'Issued', 1000, 'exclusive', 0),
  ('16300000-0000-0000-0000-000000000402', '16300000-0000-0000-0000-00000000000a', '16300000-0000-0000-0000-0000000000d1', 'ONE WO host', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name) values
  ('16300000-0000-0000-0000-000000000c01', '16300000-0000-0000-0000-00000000000a', 'ON-A', 'Home crew'),
  ('16300000-0000-0000-0000-000000000c02', '16300000-0000-0000-0000-00000000000a', 'ON-B', 'Host crew');
insert into people (id, org_id, kind, name, profile_id) values
  ('16300000-0000-0000-0000-000000000f01', '16300000-0000-0000-0000-00000000000a', 'vendor', 'Lent Worker', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('16300000-0000-0000-0000-00000000000a', '16300000-0000-0000-0000-000000000c01', '16300000-0000-0000-0000-000000000f01', pg_temp.d(-40));
-- Home crew is on its work order throughout; the host crew is scheduled only from d(+2).
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('16300000-0000-0000-0000-00000000000a', '16300000-0000-0000-0000-000000000401', '16300000-0000-0000-0000-000000000c01', pg_temp.d(-40)),
  ('16300000-0000-0000-0000-00000000000a', '16300000-0000-0000-0000-000000000402', '16300000-0000-0000-0000-000000000c02', pg_temp.d(2));
insert into crew_loans (org_id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('16300000-0000-0000-0000-00000000000a', '16300000-0000-0000-0000-000000000f01',
   '16300000-0000-0000-0000-000000000c01', '16300000-0000-0000-0000-000000000c02', pg_temp.d(1), pg_temp.d(3));
select set_config('request.jwt.claims', json_build_object('sub', '16300000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

create or replace function pg_temp.rosters_with_worker(p_day date) returns int language sql as $$
  select count(*)::int from (
    select r.crew_id, r.members from public.work_order_roster('16300000-0000-0000-0000-000000000401', p_day) r
    union all
    select r.crew_id, r.members from public.work_order_roster('16300000-0000-0000-0000-000000000402', p_day) r
  ) x where x.members @> '[{"worker_id": "16300000-0000-0000-0000-000000000f01"}]'::jsonb
$$;

select is(pg_temp.rosters_with_worker(pg_temp.d(0)), 1, 'before the loan: the home roster only');
select is(pg_temp.rosters_with_worker(pg_temp.d(2)), 1, 'loan day, host crew scheduled: exactly one roster');
select is(pg_temp.rosters_with_worker(pg_temp.d(1)), 1, 'loan day, host crew on no work order: the worker stays in the home roster (not lost)');
select is(public.worker_effective_crew('16300000-0000-0000-0000-000000000f01', pg_temp.d(2)), '16300000-0000-0000-0000-000000000c02'::uuid, 'scheduled host day: effective crew is the host');
select is(public.worker_effective_crew('16300000-0000-0000-0000-000000000f01', pg_temp.d(1)), '16300000-0000-0000-0000-000000000c01'::uuid, 'unscheduled host day: effective crew is the home crew');
select is(pg_temp.rosters_with_worker(pg_temp.d(4)), 1, 'after the loan: the home roster only');

select * from finish();
rollback;
