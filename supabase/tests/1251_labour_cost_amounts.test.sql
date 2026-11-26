-- 1251_labour_cost_amounts.test.sql — #2670. Migrations under test: 1250, 1251, 1252.
-- AC-LCM-001/002 off = identical · 004-009 pricing · 010 approved only · 011 direct/shared · 015 Project Manager redaction.
begin;
create extension if not exists pgtap;
select plan(21);

insert into organizations (id, name, default_currency) values ('26710000-0000-0000-0000-00000000000a', 'Labour Cost Org', 'IDR');
insert into auth.users (id, email) values
  ('26710000-0000-0000-0000-0000000000a1', 'lm-fin@example.com'),
  ('26710000-0000-0000-0000-0000000000a2', 'lm-pm@example.com'),
  ('26710000-0000-0000-0000-0000000000a3', 'lm-one@example.com'),
  ('26710000-0000-0000-0000-0000000000a4', 'lm-two@example.com'),
  ('26710000-0000-0000-0000-0000000000a5', 'lm-three@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26710000-0000-0000-0000-0000000000a1', '26710000-0000-0000-0000-00000000000a', 'Fin', 'lm-fin@example.com', 'Finance', 'active'),
  ('26710000-0000-0000-0000-0000000000a2', '26710000-0000-0000-0000-00000000000a', 'PM', 'lm-pm@example.com', 'Project Manager', 'active'),
  ('26710000-0000-0000-0000-0000000000a3', '26710000-0000-0000-0000-00000000000a', 'One', 'lm-one@example.com', 'Engineer', 'active'),
  ('26710000-0000-0000-0000-0000000000a4', '26710000-0000-0000-0000-00000000000a', 'Two', 'lm-two@example.com', 'Engineer', 'active'),
  ('26710000-0000-0000-0000-0000000000a5', '26710000-0000-0000-0000-00000000000a', 'Three', 'lm-three@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('26710000-0000-0000-0000-0000000000d1', '26710000-0000-0000-0000-00000000000a', 'LM Site', 'Ongoing Project', 'IDR'),
  ('26710000-0000-0000-0000-0000000000d2', '26710000-0000-0000-0000-00000000000a', 'LM Site 2', 'Ongoing Project', 'IDR');
-- A Project Manager reads project money for their own projects (2750): this Project Manager manages the project under test.
update projects set project_manager_id = '26710000-0000-0000-0000-0000000000a2' where org_id = '26710000-0000-0000-0000-00000000000a' and project_manager_id is null;
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('26710000-0000-0000-0000-000000000401', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-0000000000d1', 'WO-A', 'A', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('26710000-0000-0000-0000-000000000402', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-0000000000d2', 'WO-B', 'B', 'Issued', 10000, 'exclusive', 0, 'IDR');

set local session_replication_role = replica;
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('26710000-0000-0000-0000-000000000701', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-0000000000a3', '2026-11-02', 'Approved'),
  ('26710000-0000-0000-0000-000000000702', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-0000000000a4', '2026-11-02', 'Approved'),
  ('26710000-0000-0000-0000-000000000703', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-0000000000a5', '2026-11-02', 'Submitted');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, work_order_id, entry_date, hours) values
  -- One: 8 h on 11-02 (hourly role), 10 h on 11-03 (overtime), a day before any rate 2025-12-31 not possible in this week -> use 11-04 after rate end
  ('26710000-0000-0000-0000-000000000711', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-000000000701', '26710000-0000-0000-0000-0000000000d1', '26710000-0000-0000-0000-000000000401', '2026-11-02', 8),
  ('26710000-0000-0000-0000-000000000712', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-000000000701', '26710000-0000-0000-0000-0000000000d1', '26710000-0000-0000-0000-000000000401', '2026-11-03', 6),
  ('26710000-0000-0000-0000-000000000713', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-000000000701', '26710000-0000-0000-0000-0000000000d2', '26710000-0000-0000-0000-000000000402', '2026-11-03', 4),
  ('26710000-0000-0000-0000-000000000714', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-000000000701', '26710000-0000-0000-0000-0000000000d1', null, '2026-11-05', 8),
  -- Two (person rate daily 800000, day 8h): 4 h on 11-02
  ('26710000-0000-0000-0000-000000000721', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-000000000702', '26710000-0000-0000-0000-0000000000d1', '26710000-0000-0000-0000-000000000401', '2026-11-02', 4),
  -- Three: Submitted week
  ('26710000-0000-0000-0000-000000000731', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-000000000703', '26710000-0000-0000-0000-0000000000d1', '26710000-0000-0000-0000-000000000401', '2026-11-02', 8);
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a1');

-- Switch never turned on: no row. Snapshot the read.
create temp table before_rows as select source, record_id, reason, amount from public.work_order_cost_amounts('26710000-0000-0000-0000-0000000000d1');
grant select on before_rows to authenticated;
select is((select count(*)::int from before_rows where source = 'timesheet_entry' and reason = 'no-rate'), 4,
  'AC-LCM-001 with the switch never on, Approved lines are hours only (no-rate) as before');
select is((select count(*)::int from public.work_order_cost_amounts('26710000-0000-0000-0000-0000000000d1') where labour_class_id is not null), 0,
  'AC-LCM-001 no labour class on any row while off');

-- Enable classes without enabling pricing: rates present while the switch is off (fixture rows, as the seed can
-- only add rates that do not touch priced hours once the lock holds). Then the switch goes on.
select public.save_labour_cost_settings(true);
create temp table cls as select code, id from public.labour_cost_classes;
grant select on cls to authenticated;
select public.save_labour_cost_settings(false);
reset role;
insert into public.labour_cost_rates (org_id, subject_kind, role_key, class_id, basis, amount, overtime_multiplier, day_hours, effective_from, effective_to) values
  ('26710000-0000-0000-0000-00000000000a', 'role', 'Engineer', (select id from public.labour_cost_classes where code = 'direct'),
   'hourly', 50000, 1.5, 8, '2026-11-01', '2026-11-04');
insert into public.labour_cost_rates (org_id, subject_kind, person_id, class_id, basis, amount, day_hours, effective_from) values
  ('26710000-0000-0000-0000-00000000000a', 'person', '26710000-0000-0000-0000-0000000000a4', (select id from public.labour_cost_classes where code = 'guard'),
   'daily', 800000, 8, '2026-11-01');
set local role authenticated;
select is((select count(*)::int from public.work_order_cost_amounts('26710000-0000-0000-0000-0000000000d1') where reason = 'counted' and source = 'timesheet_entry'), 0,
  'AC-LCM-002 rates present with the switch off price nothing');

select public.save_labour_cost_settings(true);
create temp table rows_on as select * from public.work_order_cost_amounts('26710000-0000-0000-0000-0000000000d1');
grant select on rows_on to authenticated;

select is((select amount from rows_on where record_id = '26710000-0000-0000-0000-000000000711'), '400000.00',
  'AC-LCM-004 8 h at 50000 an hour cost 400000.00');
select is((select reason || ':' || currency from rows_on where record_id = '26710000-0000-0000-0000-000000000711'), 'counted:IDR',
  'AC-LCM-004 a priced line is counted, in the organisation currency');
select is((select labour_class_id from rows_on where record_id = '26710000-0000-0000-0000-000000000711'), (select id from cls where code = 'direct'),
  'AC-LCM-004 the line carries its labour class');
select is((select amount from rows_on where record_id = '26710000-0000-0000-0000-000000000721'), '400000.00',
  'AC-LCM-005 4 h of a 800000 daily rate over an 8 h day cost 400000.00');
select is((select labour_class_id from rows_on where record_id = '26710000-0000-0000-0000-000000000721'), (select id from cls where code = 'guard'),
  'AC-LCM-008 the person rate (guard, daily) wins over the role rate');
-- Day 11-03: One has 6 h on project d1 and 4 h on d2 (10 h). Lines ordered by project then id: d1 first (6 regular),
-- d2: 2 regular + 2 overtime at 1.5 -> 2*50000 + 2*50000*1.5 = 250000. d1 line = 300000.
select is((select amount from rows_on where record_id = '26710000-0000-0000-0000-000000000712'), '300000.00',
  'AC-LCM-006 the first 6 h of a 10 h day are regular');
select is((select amount from public.work_order_cost_amounts('26710000-0000-0000-0000-0000000000d2') where record_id = '26710000-0000-0000-0000-000000000713'), '250000.00',
  'AC-LCM-007 overtime is counted once across projects: 2 h regular + 2 h at 1.5');
select is((select reason from rows_on where record_id = '26710000-0000-0000-0000-000000000714'), 'no-rate',
  'AC-LCM-009 a date after a rate ended is no-rate (hours only)');
select is((select amount from rows_on where record_id = '26710000-0000-0000-0000-000000000714'), null,
  'AC-LCM-009 and carries no money');
select is((select reason from rows_on where record_id = '26710000-0000-0000-0000-000000000731'), 'not-posted',
  'AC-LCM-010 a Submitted week is not posted');
select is((select amount from rows_on where record_id = '26710000-0000-0000-0000-000000000731'), null, 'AC-LCM-010 and carries no money');
select is((select work_order_id from rows_on where record_id = '26710000-0000-0000-0000-000000000711'), '26710000-0000-0000-0000-000000000401'::uuid,
  'AC-LCM-011 a line with a work order is that work order''s cost');
-- Project-level (no work order) line with a rate: add a rate-covered no-WO line.
reset role;
set local session_replication_role = replica;
insert into timesheet_entries (id, org_id, timesheet_id, project_id, work_order_id, entry_date, hours) values
  ('26710000-0000-0000-0000-000000000715', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-000000000701', '26710000-0000-0000-0000-0000000000d1', null, '2026-11-04', 2);
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a1');
select is((select work_order_id from public.work_order_cost_amounts('26710000-0000-0000-0000-0000000000d1') where record_id = '26710000-0000-0000-0000-000000000715'), null::uuid,
  'AC-LCM-011 a line with no work order is priced as project-level cost (no work order)');
select is((select amount from public.work_order_cost_amounts('26710000-0000-0000-0000-0000000000d1') where record_id = '26710000-0000-0000-0000-000000000715'), '100000.00',
  'AC-LCM-011 2 h at 50000');
select is((select count(*)::int from public.work_order_cost_amounts('26710000-0000-0000-0000-0000000000d1') where source = 'project_actuals'),
  (select count(*)::int from before_rows where source = 'project_actuals'),
  'AC-LCM-011 the ledger project-actuals remainder row is unchanged by labour');

-- Reopen: week no longer Approved removes the cost.
reset role;
set local session_replication_role = replica;
update timesheets set status = 'Draft' where id = '26710000-0000-0000-0000-000000000702';
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a1');
select is((select reason || ':' || coalesce(amount, 'null') from public.work_order_cost_amounts('26710000-0000-0000-0000-0000000000d1') where record_id = '26710000-0000-0000-0000-000000000721'), 'not-posted:null',
  'AC-LCM-010 reopening a week removes its cost');

-- Project Manager: amounts in aggregate, no person, no entry.
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a2');
select is((select sum(amount::numeric)::text from public.work_order_cost_amounts('26710000-0000-0000-0000-0000000000d1') where source = 'timesheet_entry' and reason = 'counted'), '800000.00',
  'AC-LCM-015 a Project Manager sees the same labour amounts (in aggregate)');
select is((select count(*)::int from public.work_order_cost_amounts('26710000-0000-0000-0000-0000000000d1') where source = 'timesheet_entry' and reason = 'counted'
   and (record_id is not null or person_id is not null or occurred_on is not null)), 0,
  'AC-LCM-015 but no person, no record id and no date on a labour row');

select * from finish();
rollback;
