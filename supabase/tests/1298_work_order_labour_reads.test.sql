-- 1298_work_order_labour_reads.test.sql — labour cost reads for Project Managers are aggregate.
-- Migration under test: 1298 (on top of 1250-1252, 1255-1256).
-- AC-LCM-015 a Project Manager reads labour money only in aggregate: one row per work order, discipline and class,
--   summed hours and summed amount, no record id, no date, no person; amounts still equal what Finance reads.
-- AC-IHC-005 the idle-cost read shows no hourly cost to a Project Manager.
begin;
create extension if not exists pgtap;
select plan(12);

insert into organizations (id, name, default_currency) values ('26960000-0000-0000-0000-00000000000a', 'Aggregate Org', 'IDR');
insert into auth.users (id, email) values
  ('26960000-0000-0000-0000-0000000000a1', 'ag-fin@example.com'),
  ('26960000-0000-0000-0000-0000000000a2', 'ag-pm@example.com'),
  ('26960000-0000-0000-0000-0000000000a3', 'ag-one@example.com'),
  ('26960000-0000-0000-0000-0000000000a4', 'ag-two@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26960000-0000-0000-0000-0000000000a1', '26960000-0000-0000-0000-00000000000a', 'Fin', 'ag-fin@example.com', 'Finance', 'active'),
  ('26960000-0000-0000-0000-0000000000a2', '26960000-0000-0000-0000-00000000000a', 'PM', 'ag-pm@example.com', 'Project Manager', 'active'),
  ('26960000-0000-0000-0000-0000000000a3', '26960000-0000-0000-0000-00000000000a', 'One', 'ag-one@example.com', 'Engineer', 'active'),
  ('26960000-0000-0000-0000-0000000000a4', '26960000-0000-0000-0000-00000000000a', 'Two', 'ag-two@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('26960000-0000-0000-0000-0000000000d1', '26960000-0000-0000-0000-00000000000a', 'AG Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('26960000-0000-0000-0000-000000000401', '26960000-0000-0000-0000-00000000000a', '26960000-0000-0000-0000-0000000000d1', 'WO-A', 'A', 'Issued', 10000, 'exclusive', 0, 'IDR');

-- Fixture rows: the switch on, one direct class, a role rate and a person rate, approved hours on two days.
insert into public.labour_cost_settings (org_id, enabled) values ('26960000-0000-0000-0000-00000000000a', true);
insert into public.labour_cost_classes (id, org_id, code, name) values
  ('26960000-0000-0000-0000-00000000c001', '26960000-0000-0000-0000-00000000000a', 'direct', 'Direct'),
  ('26960000-0000-0000-0000-00000000c002', '26960000-0000-0000-0000-00000000000a', 'guard', 'Guard');
insert into public.labour_cost_rates (org_id, subject_kind, role_key, class_id, basis, amount, effective_from) values
  ('26960000-0000-0000-0000-00000000000a', 'role', 'Engineer', '26960000-0000-0000-0000-00000000c001', 'hourly', 50000, '2026-11-01');
insert into public.labour_cost_rates (org_id, subject_kind, person_id, class_id, basis, amount, day_hours, effective_from) values
  ('26960000-0000-0000-0000-00000000000a', 'person', '26960000-0000-0000-0000-0000000000a4', '26960000-0000-0000-0000-00000000c002', 'daily', 800000, 8, '2026-11-01');
set local session_replication_role = replica;
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('26960000-0000-0000-0000-000000000701', '26960000-0000-0000-0000-00000000000a', '26960000-0000-0000-0000-0000000000a3', '2026-11-02', 'Approved'),
  ('26960000-0000-0000-0000-000000000702', '26960000-0000-0000-0000-00000000000a', '26960000-0000-0000-0000-0000000000a4', '2026-11-02', 'Approved');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, work_order_id, entry_date, hours) values
  ('26960000-0000-0000-0000-000000000711', '26960000-0000-0000-0000-00000000000a', '26960000-0000-0000-0000-000000000701', '26960000-0000-0000-0000-0000000000d1', '26960000-0000-0000-0000-000000000401', '2026-11-02', 8),
  ('26960000-0000-0000-0000-000000000712', '26960000-0000-0000-0000-00000000000a', '26960000-0000-0000-0000-000000000701', '26960000-0000-0000-0000-0000000000d1', '26960000-0000-0000-0000-000000000401', '2026-11-03', 6),
  ('26960000-0000-0000-0000-000000000721', '26960000-0000-0000-0000-00000000000a', '26960000-0000-0000-0000-000000000702', '26960000-0000-0000-0000-0000000000d1', '26960000-0000-0000-0000-000000000401', '2026-11-02', 4);
set local session_replication_role = origin;
-- Idle fixture: one validated report with 60 idle minutes on WO-A, idle switch on.
insert into dsr_idle_reasons (id, org_id, label) values ('26960000-0000-0000-0000-00000000b001', '26960000-0000-0000-0000-00000000000a', 'Rain');
insert into idle_cost_settings (org_id, enabled) values ('26960000-0000-0000-0000-00000000000a', true);
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at, submitted_at) values
  ('26960000-0000-0000-0000-00000000d001', '26960000-0000-0000-0000-00000000000a', '26960000-0000-0000-0000-0000000000d1', '26960000-0000-0000-0000-000000000401', '2026-11-02', 'validated', '26960000-0000-0000-0000-0000000000a3', '26960000-0000-0000-0000-0000000000a1', now(), now());
insert into dsr_idle_periods (org_id, report_id, position, minutes, reason_id) values
  ('26960000-0000-0000-0000-00000000000a', '26960000-0000-0000-0000-00000000d001', 1, 60, '26960000-0000-0000-0000-00000000b001');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;

-- Finance control: priced labour exists per entry, and the idle hourly cost is present.
select pg_temp.act_as('26960000-0000-0000-0000-0000000000a1');
create temp table fin_cost as select * from public.work_order_cost_amounts('26960000-0000-0000-0000-0000000000d1');
grant select on fin_cost to authenticated;
select is((select count(*)::int from fin_cost where source = 'timesheet_entry' and reason = 'counted'), 3,
  'control: Finance reads one priced row per approved entry');
select is((select hourly_cost from public.work_order_idle_cost('26960000-0000-0000-0000-0000000000d1')), '61111.11',
  'control: Finance reads the work order hourly cost (1100000 over 18 h)');
create temp table fin_idle as select * from public.work_order_idle_cost('26960000-0000-0000-0000-0000000000d1');
grant select on fin_idle to authenticated;

-- Project Manager: labour money only in aggregate.
select pg_temp.act_as('26960000-0000-0000-0000-0000000000a2');
create temp table pm_cost as select * from public.work_order_cost_amounts('26960000-0000-0000-0000-0000000000d1');
grant select on pm_cost to authenticated;

select is((select count(*)::int from pm_cost
   where source = 'timesheet_entry' and reason = 'counted'
     and (record_id is not null or occurred_on is not null or person_id is not null)), 0,
  'AC-LCM-015 a labour money row for a Project Manager carries no record id, no date and no person');
select is((select count(*)::int from pm_cost c join public.timesheet_entries e on e.id = c.record_id), 0,
  'AC-LCM-015 no cost row of a Project Manager resolves to a timesheet entry this role can read');
select is((select count(*)::int
   from pm_cost c join public.timesheet_entries e on e.entry_date = c.occurred_on
   join public.timesheets t on t.id = e.timesheet_id
  where c.source = 'timesheet_entry' and c.reason = 'counted'), 0,
  'AC-LCM-015 no cost row pairs with a dated timesheet line: hours and money are sums, not per-entry pairs');
select is((select count(*)::int from pm_cost where source = 'timesheet_entry' and reason = 'counted'), 2,
  'AC-LCM-015 labour money is one row per work order, discipline and class (direct 14 h, guard 4 h)');
select is((select sum(quantity)::text from pm_cost where labour_class_id = '26960000-0000-0000-0000-00000000c001'), '14.00',
  'AC-LCM-015 the direct-class row carries summed hours');
select is((select sum(amount::numeric)::text from pm_cost where labour_class_id = '26960000-0000-0000-0000-00000000c001'), '700000.00',
  'AC-LCM-015 the direct-class row carries the summed amount (8 h + 6 h at 50000)');
select is((select sum(amount::numeric)::text from pm_cost where labour_class_id = '26960000-0000-0000-0000-00000000c002'), '400000.00',
  'AC-LCM-015 the guard-class row carries the summed amount (4 h of the daily rate)');
select is((select coalesce(sum(c.amount::numeric), 0) from pm_cost c where c.source = 'timesheet_entry' and c.reason = 'counted'),
         (select coalesce(sum(f.amount::numeric), 0) from fin_cost f where f.source = 'timesheet_entry' and f.reason = 'counted'),
  'AC-LCM-015 the amounts a Project Manager reads equal what Finance reads');

select is((select count(*)::int from public.work_order_idle_cost('26960000-0000-0000-0000-0000000000d1') where hourly_cost is not null), 0,
  'AC-IHC-005 the idle-cost read gives a Project Manager no hourly cost');
select is((select i.amount from public.work_order_idle_cost('26960000-0000-0000-0000-0000000000d1') i),
         (select f.amount from fin_idle f),
  'AC-IHC-005 and still reads the idle amount (1 h at the work order average)');

select * from finish();
rollback;
