-- 1255_idle_cost.test.sql — #2673. Migrations under test: 1255, 1256 (on top of 1250-1252).
-- AC-IHC-001/002 off = nothing · 003-007 costing · 008 switch write · 009 org scope and roles.
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name, default_currency) values
  ('26730000-0000-0000-0000-00000000000a', 'Idle Cost Org', 'IDR'),
  ('26730000-0000-0000-0000-00000000000b', 'Other Idle Org', 'IDR');
insert into auth.users (id, email) values
  ('26730000-0000-0000-0000-0000000000a1', 'ic-fin@example.com'),
  ('26730000-0000-0000-0000-0000000000a2', 'ic-pm@example.com'),
  ('26730000-0000-0000-0000-0000000000a3', 'ic-one@example.com'),
  ('26730000-0000-0000-0000-0000000000a4', 'ic-two@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26730000-0000-0000-0000-0000000000a1', '26730000-0000-0000-0000-00000000000a', 'Fin', 'ic-fin@example.com', 'Finance', 'active'),
  ('26730000-0000-0000-0000-0000000000a2', '26730000-0000-0000-0000-00000000000a', 'PM', 'ic-pm@example.com', 'Project Manager', 'active'),
  ('26730000-0000-0000-0000-0000000000a3', '26730000-0000-0000-0000-00000000000a', 'One', 'ic-one@example.com', 'Engineer', 'active'),
  ('26730000-0000-0000-0000-0000000000a4', '26730000-0000-0000-0000-00000000000a', 'Two', 'ic-two@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('26730000-0000-0000-0000-0000000000d1', '26730000-0000-0000-0000-00000000000a', 'IC Site', 'Ongoing Project', 'IDR'),
  ('26730000-0000-0000-0000-0000000000d9', '26730000-0000-0000-0000-00000000000b', 'Other Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('26730000-0000-0000-0000-000000000401', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000d1', 'WO-A', 'A', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('26730000-0000-0000-0000-000000000402', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000d1', 'WO-B', 'B', 'Issued', 10000, 'exclusive', 0, 'IDR');

set local session_replication_role = replica;
-- priced hours on WO-A only: One 8 h (role rate 50000/h = 400000), Two 8 h (person rate 75000/h = 600000) -> 62500 per hour.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('26730000-0000-0000-0000-000000000701', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000a3', '2026-11-02', 'Approved'),
  ('26730000-0000-0000-0000-000000000702', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000a4', '2026-11-02', 'Approved');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, work_order_id, entry_date, hours) values
  ('26730000-0000-0000-0000-000000000711', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-000000000701', '26730000-0000-0000-0000-0000000000d1', '26730000-0000-0000-0000-000000000401', '2026-11-02', 8),
  ('26730000-0000-0000-0000-000000000721', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-000000000702', '26730000-0000-0000-0000-0000000000d1', '26730000-0000-0000-0000-000000000401', '2026-11-03', 8);

insert into dsr_idle_reasons (id, org_id, label) values
  ('26730000-0000-0000-0000-000000000b01', '26730000-0000-0000-0000-00000000000a', 'Reason A'),
  ('26730000-0000-0000-0000-000000000b02', '26730000-0000-0000-0000-00000000000a', 'Reason B');
-- reports: two validated and current on WO-A; draft, submitted, returned, superseded, archived are excluded; one validated on WO-B.
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at, superseded_at, archived_at, submitted_at) values
  ('26730000-0000-0000-0000-000000000c01', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000d1', '26730000-0000-0000-0000-000000000401', '2026-11-02', 'validated', '26730000-0000-0000-0000-0000000000a3', '26730000-0000-0000-0000-0000000000a1', now(), null, null, now()),
  ('26730000-0000-0000-0000-000000000c02', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000d1', '26730000-0000-0000-0000-000000000401', '2026-11-03', 'validated', '26730000-0000-0000-0000-0000000000a3', '26730000-0000-0000-0000-0000000000a1', now(), null, null, now()),
  ('26730000-0000-0000-0000-000000000c03', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000d1', '26730000-0000-0000-0000-000000000401', '2026-11-04', 'draft', '26730000-0000-0000-0000-0000000000a3', null, null, null, null, null),
  ('26730000-0000-0000-0000-000000000c04', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000d1', '26730000-0000-0000-0000-000000000401', '2026-11-05', 'submitted', '26730000-0000-0000-0000-0000000000a3', null, null, null, null, now()),
  ('26730000-0000-0000-0000-000000000c05', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000d1', '26730000-0000-0000-0000-000000000401', '2026-11-06', 'returned', '26730000-0000-0000-0000-0000000000a3', null, null, null, null, now()),
  ('26730000-0000-0000-0000-000000000c06', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000d1', '26730000-0000-0000-0000-000000000401', '2026-11-07', 'validated', '26730000-0000-0000-0000-0000000000a3', '26730000-0000-0000-0000-0000000000a1', now(), now(), null, now()),
  ('26730000-0000-0000-0000-000000000c07', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000d1', '26730000-0000-0000-0000-000000000401', '2026-11-08', 'validated', '26730000-0000-0000-0000-0000000000a3', '26730000-0000-0000-0000-0000000000a1', now(), null, now(), now()),
  ('26730000-0000-0000-0000-000000000c08', '26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-0000000000d1', '26730000-0000-0000-0000-000000000402', '2026-11-02', 'validated', '26730000-0000-0000-0000-0000000000a3', '26730000-0000-0000-0000-0000000000a1', now(), null, null, now());
insert into dsr_idle_periods (org_id, report_id, position, minutes, reason_id) values
  ('26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-000000000c01', 1, 30, '26730000-0000-0000-0000-000000000b01'),
  ('26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-000000000c01', 2, 20, '26730000-0000-0000-0000-000000000b02'),
  ('26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-000000000c02', 1, 30, '26730000-0000-0000-0000-000000000b01'),
  ('26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-000000000c03', 1, 600, '26730000-0000-0000-0000-000000000b01'),
  ('26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-000000000c04', 1, 600, '26730000-0000-0000-0000-000000000b01'),
  ('26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-000000000c05', 1, 600, '26730000-0000-0000-0000-000000000b01'),
  ('26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-000000000c06', 1, 600, '26730000-0000-0000-0000-000000000b01'),
  ('26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-000000000c07', 1, 600, '26730000-0000-0000-0000-000000000b01'),
  ('26730000-0000-0000-0000-00000000000a', '26730000-0000-0000-0000-000000000c08', 1, 30, '26730000-0000-0000-0000-000000000b01');
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('26730000-0000-0000-0000-0000000000a1');

select is((select count(*)::int from public.work_order_idle_cost('26730000-0000-0000-0000-0000000000d1')), 0,
  'AC-IHC-001 with neither switch ever turned on the read returns no row');

-- Rates are saved while labour cost is off (the lock rule only guards priced hours), as in 1251; then labour cost goes on.
select public.save_labour_cost_settings(true);
create temp table cls as select code, id from public.labour_cost_classes;
grant select on cls to authenticated;
select public.save_labour_cost_settings(false);
select public.save_labour_cost_rate(jsonb_build_object('subject_kind','role','role_key','Engineer','class_id',(select id from cls where code='direct'),
  'basis','hourly','amount',50000,'effective_from','2026-11-01'));
select public.save_labour_cost_rate(jsonb_build_object('subject_kind','person','person_id','26730000-0000-0000-0000-0000000000a4',
  'class_id',(select id from cls where code='direct'),'basis','hourly','amount',75000,'effective_from','2026-11-01'));
select public.save_labour_cost_settings(true);
select is((select count(*)::int from public.work_order_idle_cost('26730000-0000-0000-0000-0000000000d1')), 0,
  'AC-IHC-002 labour cost on but idle switch off: no row');

select lives_ok($$select public.save_idle_cost_setting(true)$$, 'AC-IHC-008 Finance turns the idle switch on');
select public.save_labour_cost_settings(false);
select is((select count(*)::int from public.work_order_idle_cost('26730000-0000-0000-0000-0000000000d1')), 0,
  'AC-IHC-002 idle switch on but labour cost off: no row');
select public.save_labour_cost_settings(true);

create temp table idle_rows as select * from public.work_order_idle_cost('26730000-0000-0000-0000-0000000000d1');
grant select on idle_rows to authenticated;

select is((select hours from idle_rows where work_order_id = '26730000-0000-0000-0000-000000000401' and reason_label = 'Reason A'), '1.00',
  'AC-IHC-003 30 + 30 idle minutes of reason A are 1.00 h');
select is((select amount || ':' || reason from idle_rows where work_order_id = '26730000-0000-0000-0000-000000000401' and reason_label = 'Reason A'), '62500.00:counted',
  'AC-IHC-003 1 h at the work order hourly cost costs 62500.00, counted');
select is((select hourly_cost from idle_rows where work_order_id = '26730000-0000-0000-0000-000000000401' and reason_label = 'Reason A'), '62500.00',
  'AC-IHC-004 hourly cost is the weighted average (400000 + 600000) / 16 h');
select is((select count(*)::int from idle_rows where work_order_id = '26730000-0000-0000-0000-000000000401'), 2,
  'AC-IHC-005 one row per idle reason');
select is((select sum(minutes)::int from idle_rows where work_order_id = '26730000-0000-0000-0000-000000000401'), 80,
  'AC-IHC-006 draft, submitted, returned, superseded and archived reports add no idle minutes');
select is((select hours || ':' || coalesce(amount, 'null') || ':' || reason from idle_rows where work_order_id = '26730000-0000-0000-0000-000000000402'), '0.50:null:no-rate',
  'AC-IHC-007 a work order with no priced labour shows hours, no money');

select pg_temp.act_as('26730000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.work_order_idle_cost('26730000-0000-0000-0000-0000000000d1')), 3,
  'AC-IHC-009 a Project Manager reads the same rows (amounts, no person, no rate)');
select throws_ok($$select public.save_idle_cost_setting(false)$$, '42501', null,
  'AC-IHC-008 a Project Manager cannot write the switch');
select pg_temp.act_as('26730000-0000-0000-0000-0000000000a3');
select throws_ok($$select * from public.work_order_idle_cost('26730000-0000-0000-0000-0000000000d1')$$, '42501', null,
  'AC-IHC-009 an Engineer cannot read idle cost');
select pg_temp.act_as('26730000-0000-0000-0000-0000000000a1');
select throws_ok($$select * from public.work_order_idle_cost('26730000-0000-0000-0000-0000000000d9')$$, 'P0002', null,
  'AC-IHC-009 another organisation''s project reads as absent');

select * from finish();
rollback;
