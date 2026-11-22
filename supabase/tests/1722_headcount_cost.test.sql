-- 1722_headcount_cost.test.sql — approved daily head counts become work-order labour cost (docs/specs/guard-headcount.spec.md).
-- Migrations under test: 1722 (labour_cost_class_lines, headcount branch), 1723 (labour_class_locked), 1724 (end_labour_cost_rate span).
-- AC-HC-001 switch off = identical · 002 pricing · 003 approved only · 004 privacy · 008 history lock · 009 no double count.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   1722: delete `where h.approved_at is not null` in the priced arm ................ 'AC-HC-003 a line entered but not approved ...'
--   1722: replace `public.labour_cost_enabled(org.id)` with `true` in the head-count arms 'AC-HC-001 ...'
--   1722: replace `h.head_count *` with `1 *` in the amount ............................ 'AC-HC-002 ...'
--   1722: replace `h.head_count * r.day_hours` with `h.head_count` ..................... 'AC-HC-002 ... person-hours'
--   work_order_cost_amounts: `where not v_pm or l.amount is null` -> `where true` ..... 'AC-HC-004 ...'
--   1723: replace the head-count arm of labour_class_locked with `false` ............... 'AC-HC-008 ...'
--   1724: delete the head-count arm of the added-span check ............................ 'AC-HC-008 moving the end later ...'
begin;
create extension if not exists pgtap;
select plan(32);

insert into organizations (id, name, default_currency) values ('17220000-0000-0000-0000-00000000000a', 'Head Count Cost Org', 'IDR');
insert into auth.users (id, email) values
  ('17220000-0000-0000-0000-0000000000a1', 'hcc-fin@example.com'), ('17220000-0000-0000-0000-0000000000a2', 'hcc-exec@example.com'), ('17220000-0000-0000-0000-0000000000a3', 'hcc-pm@example.com'),
  ('17220000-0000-0000-0000-0000000000a4', 'hcc-eng@example.com'), ('17220000-0000-0000-0000-0000000000a5', 'hcc-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17220000-0000-0000-0000-0000000000a1', '17220000-0000-0000-0000-00000000000a', 'Fin', 'hcc-fin@example.com', 'Finance', 'active'),
  ('17220000-0000-0000-0000-0000000000a2', '17220000-0000-0000-0000-00000000000a', 'Exec', 'hcc-exec@example.com', 'Executive', 'active'),
  ('17220000-0000-0000-0000-0000000000a3', '17220000-0000-0000-0000-00000000000a', 'PM', 'hcc-pm@example.com', 'Project Manager', 'active'),
  ('17220000-0000-0000-0000-0000000000a4', '17220000-0000-0000-0000-00000000000a', 'Eng', 'hcc-eng@example.com', 'Engineer', 'active'),
  ('17220000-0000-0000-0000-0000000000a5', '17220000-0000-0000-0000-00000000000a', 'Admin', 'hcc-admin@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, currency) values ('17220000-0000-0000-0000-0000000000d1', '17220000-0000-0000-0000-00000000000a', 'HCC Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('17220000-0000-0000-0000-000000000401', '17220000-0000-0000-0000-00000000000a', '17220000-0000-0000-0000-0000000000d1', 'WO-1', 'One', 'Issued', 10000, 'exclusive', 0, 'IDR');
insert into crews (id, org_id, code, name) values ('17220000-0000-0000-0000-000000000c01', '17220000-0000-0000-0000-00000000000a', 'HCC-A', 'Crew A');
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values ('17220000-0000-0000-0000-00000000000a', '17220000-0000-0000-0000-000000000401', '17220000-0000-0000-0000-000000000c01', current_date - 40);
insert into people (id, org_id, kind, code, name, profile_id) values
  ('17220000-0000-0000-0000-000000000f01', '17220000-0000-0000-0000-00000000000a', 'own', 'HCC-N', 'Named Worker', null);
insert into labour_cost_classes (id, org_id, code, name) values
  ('17220000-0000-0000-0000-0000000000e11', '17220000-0000-0000-0000-00000000000a', 'hcc_hourly', 'Hourly'), ('17220000-0000-0000-0000-0000000000e12', '17220000-0000-0000-0000-00000000000a', 'hcc_daily', 'Daily'), ('17220000-0000-0000-0000-0000000000e13', '17220000-0000-0000-0000-00000000000a', 'hcc_monthly', 'Monthly'),
  ('17220000-0000-0000-0000-0000000000e14', '17220000-0000-0000-0000-00000000000a', 'hcc_norate', 'No rate'), ('17220000-0000-0000-0000-0000000000e15', '17220000-0000-0000-0000-00000000000a', 'hcc_early', 'Early');
create temp table d as select public.equipment_org_today('17220000-0000-0000-0000-00000000000a') as t;
create temp table hl (k text primary key, id uuid);
grant select on d to authenticated;
grant all on hl to authenticated;
insert into labour_cost_rates (id, org_id, subject_kind, class_id, basis, amount, overtime_multiplier, day_hours, month_hours, effective_from, effective_to) values
  ('17220000-0000-0000-0000-0000000000f1', '17220000-0000-0000-0000-00000000000a', 'class', '17220000-0000-0000-0000-0000000000e11', 'hourly', 40000, 1.5, 8, 173, '2020-01-01', null),
  ('17220000-0000-0000-0000-0000000000f2', '17220000-0000-0000-0000-00000000000a', 'class', '17220000-0000-0000-0000-0000000000e12', 'daily', 800000, 1, 8, 173, '2020-01-01', null),
  ('17220000-0000-0000-0000-0000000000f3', '17220000-0000-0000-0000-00000000000a', 'class', '17220000-0000-0000-0000-0000000000e13', 'monthly', 3460000, 1, 8, 173, '2020-01-01', null),
  ('17220000-0000-0000-0000-0000000000f4', '17220000-0000-0000-0000-00000000000a', 'class', '17220000-0000-0000-0000-0000000000e15', 'hourly', 10000, 1, 8, 173, '2020-01-01', (select t from d) - 20),
  ('17220000-0000-0000-0000-0000000000f5', '17220000-0000-0000-0000-00000000000a', 'class', '17220000-0000-0000-0000-0000000000e15', 'hourly', 20000, 1, 8, 173, (select t from d) - 15, null);
insert into labour_class_assignments (org_id, worker_id, class_id, effective_from) values
  ('17220000-0000-0000-0000-00000000000a', '17220000-0000-0000-0000-000000000f01', '17220000-0000-0000-0000-0000000000e11', '2020-01-01');
set local session_replication_role = replica;
-- The named worker's approved attendance on the same work order and date as head-count line L1 (8 h at 40000).
insert into attendance_days (id, org_id, worker_id, work_order_id, project_id, crew_id, work_date, status, hours, source, submitted_at, approved_at, locked_at) values
  ('17220000-0000-0000-0000-000000000a11', '17220000-0000-0000-0000-00000000000a', '17220000-0000-0000-0000-000000000f01', '17220000-0000-0000-0000-000000000401', '17220000-0000-0000-0000-0000000000d1', '17220000-0000-0000-0000-000000000c01', (select t from d) - 1, 'present', 8, 'roster_tick', now(), now(), now());
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
set local role authenticated;
select pg_temp.act_as('17220000-0000-0000-0000-0000000000a1');
select public.save_labour_cost_settings(true);
select public.save_labour_cost_settings(false);
-- AC-HC-001 snapshot, switch off, before any head count exists
create temp table before_cost as select * from public.work_order_cost_amounts('17220000-0000-0000-0000-0000000000d1');
create temp table before_idle as select * from public.work_order_idle_cost('17220000-0000-0000-0000-0000000000d1');
grant select on before_cost, before_idle to authenticated;
select pg_temp.act_as('17220000-0000-0000-0000-0000000000a5');
insert into hl values ('L1', public.record_headcount_day('17220000-0000-0000-0000-000000000401', '17220000-0000-0000-0000-000000000c01', (select t from d) - 1, '17220000-0000-0000-0000-0000000000e11', 3));
insert into hl values ('L2', public.record_headcount_day('17220000-0000-0000-0000-000000000401', '17220000-0000-0000-0000-000000000c01', (select t from d) - 2, '17220000-0000-0000-0000-0000000000e12', 2));
insert into hl values ('L3', public.record_headcount_day('17220000-0000-0000-0000-000000000401', '17220000-0000-0000-0000-000000000c01', (select t from d) - 3, '17220000-0000-0000-0000-0000000000e13', 5));
insert into hl values ('L4', public.record_headcount_day('17220000-0000-0000-0000-000000000401', '17220000-0000-0000-0000-000000000c01', (select t from d) - 4, '17220000-0000-0000-0000-0000000000e14', 1));
insert into hl values ('L5', public.record_headcount_day('17220000-0000-0000-0000-000000000401', '17220000-0000-0000-0000-000000000c01', (select t from d) - 5, '17220000-0000-0000-0000-0000000000e11', 9));
insert into hl values ('L7', public.record_headcount_day('17220000-0000-0000-0000-000000000401', '17220000-0000-0000-0000-000000000c01', (select t from d) - 6, '17220000-0000-0000-0000-0000000000e15', 1));
select pg_temp.act_as('17220000-0000-0000-0000-0000000000a2');
select public.approve_headcount_day((select id from hl where k = 'L1'));
select public.approve_headcount_day((select id from hl where k = 'L2'));
select public.approve_headcount_day((select id from hl where k = 'L3'));
select public.approve_headcount_day((select id from hl where k = 'L4'));
select public.approve_headcount_day((select id from hl where k = 'L7'));
select pg_temp.act_as('17220000-0000-0000-0000-0000000000a1');
create temp table after_cost as select * from public.work_order_cost_amounts('17220000-0000-0000-0000-0000000000d1');
create temp table after_idle as select * from public.work_order_idle_cost('17220000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from (select * from before_cost except all select * from after_cost) x)
        + (select count(*)::int from (select * from after_cost except all select * from before_cost) y), 0,
  'AC-HC-001 with the switch off the cost read is identical after approved head counts exist');
select is((select count(*)::int from (select * from before_idle except all select * from after_idle) x)
        + (select count(*)::int from (select * from after_idle except all select * from before_idle) y), 0,
  'AC-HC-001 with the switch off the idle cost read is identical too');
select is((select count(*)::int from after_cost where source = 'headcount_day'), 0, 'AC-HC-001 with the switch off no head-count row is read');
select public.save_labour_cost_settings(true);
create temp table fin_rows as select * from public.work_order_cost_amounts('17220000-0000-0000-0000-0000000000d1');
grant select on fin_rows to authenticated;
select ok((select count(*)::int from fin_rows where source = 'headcount_day') > 0, 'AC-HC-001 the same data with the switch on is read (the off proof is not vacuous)');
select is((select amount from fin_rows where record_id = (select id from hl where k = 'L1')), '960000.00', 'AC-HC-002 3 heads at a 40000 hourly class rate over an 8 h day cost 960000.00');
select is((select reason || ':' || currency || ':' || quantity::text || ':' || quantity_unit from fin_rows where record_id = (select id from hl where k = 'L1')), 'counted:IDR:24.00:hours', 'AC-HC-002 the quantity is person-hours: 3 heads x the 8 h day length');
select is((select labour_class_id from fin_rows where record_id = (select id from hl where k = 'L1')), '17220000-0000-0000-0000-0000000000e11'::uuid, 'AC-HC-002 the line carries its class');
select is((select coalesce(person_id::text, 'none') || ':' || work_order_id::text from fin_rows where record_id = (select id from hl where k = 'L1')), 'none:' || '17220000-0000-0000-0000-000000000401', 'AC-HC-002 the line names no person and belongs to its work order');
select is((select amount from fin_rows where record_id = (select id from hl where k = 'L2')), '1600000.00', 'AC-HC-002 2 heads at an 800000 daily class rate cost 1600000.00');
select is((select amount || ':' || quantity::text from fin_rows where record_id = (select id from hl where k = 'L3')), '800000.00:40.00', 'AC-HC-002 5 heads at a 3460000 monthly class rate over 173 h cost 800000.00 (40 person-hours)');
select is((select amount from fin_rows where record_id = (select id from hl where k = 'L7')), '160000.00', 'AC-HC-002 the rate in force on the date prices the line (the later-start rate, 20000 x 8 x 1)');
select is((select reason || ':' || coalesce(amount, 'null') || ':' || coalesce(quantity::text, 'null') from fin_rows where record_id = (select id from hl where k = 'L4')), 'no-rate:null:null', 'AC-HC-002 a class with no rate is no-rate, hours and money unknown');
select is((select count(*)::int from fin_rows where record_id = (select id from hl where k = 'L5')), 0, 'AC-HC-003 a line entered but not approved is absent from the cost read');
select is((select count(*)::int from fin_rows where occurred_on = (select t from d) - 1 and source in ('attendance_day', 'headcount_day')), 2, 'AC-HC-009 a named attendance day and a head-count line on the same date are each counted once');
select is((select amount from fin_rows where source = 'attendance_day'), '320000.00', 'AC-HC-009 the named day is priced exactly as without a head count');
select is((select sum(amount::numeric)::text from fin_rows where reason = 'counted' and labour_class_id is not null), '3840000.00', 'AC-HC-009 total counted labour equals the hand sum (320000 named + 3520000 head count)');
select pg_temp.act_as('17220000-0000-0000-0000-0000000000a3');
create temp table pm_rows as select * from public.work_order_cost_amounts('17220000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from pm_rows where source = 'headcount_day' and reason = 'counted' and (record_id is not null or occurred_on is not null or person_id is not null)), 0, 'AC-HC-004 a Project Manager reads head-count money with no record, no date and no person');
select is((select sum(amount::numeric)::text from pm_rows where source = 'headcount_day' and reason = 'counted'), '3520000.00', 'AC-HC-004 the aggregate equals what Finance sees per row');
select is((select count(*)::int from pm_rows where source = 'headcount_day' and reason = 'counted'), 4, 'AC-HC-004 one aggregate row per class');
select is((select sum(quantity)::text from pm_rows where source = 'headcount_day' and reason = 'counted'), '88.00', 'AC-HC-004 the aggregate quantity is person-hours (24 + 16 + 40 + 8)');
select is((select count(*)::int from pm_rows where source = 'headcount_day' and person_id is not null), 0, 'AC-HC-004 no head-count row names a person, priced or not');
select is((select count(*)::int from public.labour_cost_rates where subject_kind = 'class'), 0, 'AC-HC-004 a Project Manager reads no class rate');
select pg_temp.act_as('17220000-0000-0000-0000-0000000000a4');
select throws_ok($$select * from public.work_order_cost_amounts('17220000-0000-0000-0000-0000000000d1')$$, '42501', 'not authorized', 'AC-HC-004 a role outside the four is refused the read');
select pg_temp.act_as('17220000-0000-0000-0000-0000000000a1');
select public.save_labour_cost_settings(false);
select throws_like(format($$select public.save_labour_cost_rate(%L::jsonb)$$, jsonb_build_object('subject_kind', 'class', 'class_id', '17220000-0000-0000-0000-0000000000e11'::uuid, 'basis', 'hourly', 'amount', 1000, 'overtime_multiplier', 1, 'effective_from', (select t from d) - 1)), '%LCM_RATE_LOCKED%', 'AC-HC-008 a class rate starting on or before an approved head-count day of that class is refused, even with the switch off');
select throws_like($$select public.end_labour_cost_rate('17220000-0000-0000-0000-0000000000f1', (select t from d) - 3)$$, '%LCM_RATE_LOCKED%', 'AC-HC-008 ending the class rate that prices an approved head-count day before it is refused');
select throws_like($$select public.archive_labour_cost_rate('17220000-0000-0000-0000-0000000000f1')$$, '%LCM_RATE_LOCKED%', 'AC-HC-008 archiving the class rate that prices an approved head-count day is refused');
select lives_ok(format($$select public.save_labour_cost_rate(%L::jsonb)$$, jsonb_build_object('subject_kind', 'class', 'class_id', '17220000-0000-0000-0000-0000000000e11'::uuid, 'basis', 'hourly', 'amount', 1000, 'overtime_multiplier', 1, 'effective_from', (select t from d) + 1)), 'AC-HC-008 a class rate starting after the last approved day is allowed');
select throws_like($$select public.end_labour_cost_rate('17220000-0000-0000-0000-0000000000f4', (select t from d) - 3)$$, '%LCM_RATE_LOCKED%', 'AC-HC-008 moving the end of a class rate later over a day another rate prices is refused');
select lives_ok(format($$select public.save_labour_cost_rate(%L::jsonb)$$, jsonb_build_object('subject_kind', 'class', 'class_id', '17220000-0000-0000-0000-0000000000e14'::uuid, 'basis', 'hourly', 'amount', 1000, 'overtime_multiplier', 1, 'effective_from', (select t from d) - 10)), 'AC-HC-008 a first rate for a class whose approved head count had no rate prices nothing already priced, so it is allowed');
select public.save_labour_cost_settings(true);
select pg_temp.act_as('17220000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.approve_headcount_day((select id from hl where k = 'L5'))$$, 'AC-HC-003 the approver approves the remaining line');
select pg_temp.act_as('17220000-0000-0000-0000-0000000000a1');
select is((select amount from public.work_order_cost_amounts('17220000-0000-0000-0000-0000000000d1') where record_id = (select id from hl where k = 'L5')), '2880000.00', 'AC-HC-003 once approved the line is in the cost read (9 heads x 320000)');
select is((select reason from public.work_order_cost_amounts('17220000-0000-0000-0000-0000000000d1') where record_id = (select id from hl where k = 'L4')), 'counted', 'AC-HC-008 the late class rate now prices the line that had none');
select * from finish();
rollback;
