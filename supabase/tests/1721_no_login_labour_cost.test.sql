-- 1721_no_login_labour_cost.test.sql — labour cost for crew members with no login (docs/specs/no-login-labour-cost.spec.md).
-- Migrations under test: 1720 (class rates, class assignments, the costed-day view), 1721 (the reader).
-- AC-NLL-001 switch off = identical · 002-005 pricing · 006 whole-read once · 007 privacy · 008 idle cost.
-- Mutation checks (plan "Mutation checks"): M1 (a)/(b) turn AC-NLL-006 red, M2 turns AC-NLL-001 red, M3 (a) turns
-- AC-NLL-007 red.
begin;
create extension if not exists pgtap;
select plan(34);

insert into organizations (id, name, default_currency) values ('17210000-0000-0000-0000-00000000000a', 'No Login Cost Org', 'IDR');
insert into auth.users (id, email) values
  ('17210000-0000-0000-0000-0000000000a1', 'nll-fin@example.com'),
  ('17210000-0000-0000-0000-0000000000a2', 'nll-pm@example.com'),
  ('17210000-0000-0000-0000-0000000000a3', 'nll-exec@example.com'),
  ('17210000-0000-0000-0000-0000000000a4', 'nll-login-one@example.com'),
  ('17210000-0000-0000-0000-0000000000a5', 'nll-login-two@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17210000-0000-0000-0000-0000000000a1', '17210000-0000-0000-0000-00000000000a', 'Fin', 'nll-fin@example.com', 'Finance', 'active'),
  ('17210000-0000-0000-0000-0000000000a2', '17210000-0000-0000-0000-00000000000a', 'PM', 'nll-pm@example.com', 'Project Manager', 'active'),
  ('17210000-0000-0000-0000-0000000000a3', '17210000-0000-0000-0000-00000000000a', 'Exec', 'nll-exec@example.com', 'Executive', 'active'),
  ('17210000-0000-0000-0000-0000000000a4', '17210000-0000-0000-0000-00000000000a', 'Login One', 'nll-login-one@example.com', 'Engineer', 'active'),
  ('17210000-0000-0000-0000-0000000000a5', '17210000-0000-0000-0000-00000000000a', 'Login Two', 'nll-login-two@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-00000000000a', 'NLL Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('17210000-0000-0000-0000-000000000401', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-0000000000d1', 'WO-1', 'One', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('17210000-0000-0000-0000-000000000402', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-0000000000d1', 'WO-2', 'Two', 'Issued', 10000, 'exclusive', 0, 'IDR');
insert into cost_disciplines (id, org_id, code, name) values
  ('17210000-0000-0000-0000-000000000501', '17210000-0000-0000-0000-00000000000a', 'CIV', 'Civil');
insert into crews (id, org_id, code, name, discipline_id) values
  ('17210000-0000-0000-0000-000000000c01', '17210000-0000-0000-0000-00000000000a', 'NLL-A', 'Crew A', '17210000-0000-0000-0000-000000000501');
-- N, M, G, Q, Z have no login; L and B have one.
insert into people (id, org_id, kind, code, name, profile_id) values
  ('17210000-0000-0000-0000-000000000f01', '17210000-0000-0000-0000-00000000000a', 'own', 'NLL-N', 'Worker N', null),
  ('17210000-0000-0000-0000-000000000f02', '17210000-0000-0000-0000-00000000000a', 'own', 'NLL-M', 'Worker M', null),
  ('17210000-0000-0000-0000-000000000f03', '17210000-0000-0000-0000-00000000000a', 'own', 'NLL-G', 'Worker G', null),
  ('17210000-0000-0000-0000-000000000f04', '17210000-0000-0000-0000-00000000000a', 'own', 'NLL-Q', 'Worker Q', null),
  ('17210000-0000-0000-0000-000000000f05', '17210000-0000-0000-0000-00000000000a', 'own', 'NLL-L', 'Worker L', '17210000-0000-0000-0000-0000000000a4'),
  ('17210000-0000-0000-0000-000000000f06', '17210000-0000-0000-0000-00000000000a', 'own', 'NLL-B', 'Worker B', '17210000-0000-0000-0000-0000000000a5'),
  ('17210000-0000-0000-0000-000000000f07', '17210000-0000-0000-0000-00000000000a', 'own', 'NLL-Z', 'Worker Z', null);

set local session_replication_role = replica;
-- L's attendance generated its timesheet line (the link); B's line was typed on their timesheet for the same project
-- and date as an attendance day approved without a link. Both weeks are Approved.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('17210000-0000-0000-0000-000000000701', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-0000000000a4', '2026-11-02', 'Approved'),
  ('17210000-0000-0000-0000-000000000702', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-0000000000a5', '2026-11-02', 'Approved');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, work_order_id, entry_date, hours) values
  ('17210000-0000-0000-0000-000000000711', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000701', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000401', '2026-11-02', 8),
  ('17210000-0000-0000-0000-000000000712', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000702', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000401', '2026-11-02', 8);
-- 1670's organizations_switch_defaults trigger already seeds this row on org insert (enabled true). State the value the
-- fixture needs on the seeded row rather than inserting a second one, so a changed seed default cannot mask these goals.
insert into idle_cost_settings (org_id, enabled) values ('17210000-0000-0000-0000-00000000000a', true)
  on conflict (org_id) do update set enabled = excluded.enabled;
insert into dsr_idle_reasons (id, org_id, label) values
  ('17210000-0000-0000-0000-000000000b01', '17210000-0000-0000-0000-00000000000a', 'Waiting');
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at, superseded_at, archived_at, submitted_at) values
  ('17210000-0000-0000-0000-000000000c11', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000402', '2026-11-02', 'validated', '17210000-0000-0000-0000-0000000000a2', '17210000-0000-0000-0000-0000000000a1', now(), null, null, now());
insert into dsr_idle_periods (org_id, report_id, position, minutes, reason_id) values
  ('17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000c11', 1, 60, '17210000-0000-0000-0000-000000000b01');
-- L's linked attendance exists before the snapshot (it is today's state of a login's attendance).
insert into attendance_days (id, org_id, worker_id, work_order_id, project_id, crew_id, work_date, status, hours, source,
                             approved_at, locked_at, timesheet_entry_id) values
  ('17210000-0000-0000-0000-000000000a11', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f05', '17210000-0000-0000-0000-000000000401',
   '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-02', 'present', 8, 'roster_tick', now(), now(), '17210000-0000-0000-0000-000000000711');
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('17210000-0000-0000-0000-0000000000a1');
-- Classes exist (first switch-on seeds them); the switch is then off.
select public.save_labour_cost_settings(true);
select public.save_labour_cost_settings(false);

-- ── AC-NLL-001: snapshot both reads with the switch off, before any no-login day, class rate or assignment exists ──
create temp table before_cost as select * from public.work_order_cost_amounts('17210000-0000-0000-0000-0000000000d1');
create temp table before_idle as select * from public.work_order_idle_cost('17210000-0000-0000-0000-0000000000d1');
grant select on before_cost, before_idle to authenticated;

reset role;
insert into labour_cost_classes (org_id, code, name) values ('17210000-0000-0000-0000-00000000000a', 'helper', 'Helper');
create temp table k as select code, id from labour_cost_classes where org_id = '17210000-0000-0000-0000-00000000000a';
grant select on k to authenticated;
insert into labour_cost_rates (org_id, subject_kind, role_key, class_id, basis, amount, effective_from) values
  ('17210000-0000-0000-0000-00000000000a', 'role', 'Engineer', (select id from k where code = 'direct'), 'hourly', 30000, '2026-10-01');
insert into labour_cost_rates (org_id, subject_kind, class_id, basis, amount, overtime_multiplier, day_hours, month_hours, effective_from, effective_to) values
  ('17210000-0000-0000-0000-00000000000a', 'class', (select id from k where code = 'direct'), 'hourly', 40000, 1.5, 8, 173, '2026-10-01', '2026-11-04'),
  ('17210000-0000-0000-0000-00000000000a', 'class', (select id from k where code = 'direct'), 'hourly', 50000, 1.5, 8, 173, '2026-11-05', null),
  ('17210000-0000-0000-0000-00000000000a', 'class', (select id from k where code = 'indirect'), 'daily', 800000, 1, 8, 173, '2026-10-01', null),
  ('17210000-0000-0000-0000-00000000000a', 'class', (select id from k where code = 'guard'), 'monthly', 3460000, 1, 8, 173, '2026-10-01', null);
insert into labour_class_assignments (org_id, worker_id, class_id, effective_from, effective_to) values
  ('17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f01', (select id from k where code = 'direct'), '2026-11-01', '2026-11-09'),
  ('17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f01', (select id from k where code = 'indirect'), '2026-11-10', null),
  ('17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f02', (select id from k where code = 'indirect'), '2026-10-01', null),
  ('17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f03', (select id from k where code = 'guard'), '2026-10-01', null),
  ('17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f06', (select id from k where code = 'direct'), '2026-10-01', null),
  ('17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f07', (select id from k where code = 'helper'), '2026-10-01', null);
set local session_replication_role = replica;
insert into attendance_days (id, org_id, worker_id, work_order_id, project_id, crew_id, work_date, status, hours, source,
                             submitted_at, approved_at, locked_at) values
  -- B: approved on the attendance (no link) and also on B's Approved timesheet for the same project and date
  ('17210000-0000-0000-0000-000000000a21', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f06', '17210000-0000-0000-0000-000000000401', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-02', 'present', 8, 'roster_tick', now(), now(), now()),
  -- N: 11-02 8 h; 11-03 6 h on WO-1 then 4 h on WO-2; 11-06 8 h (second direct rate); 11-10 8 h (indirect from 11-10); 10-30 before any class
  ('17210000-0000-0000-0000-000000000a31', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f01', '17210000-0000-0000-0000-000000000401', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-02', 'present', 8, 'roster_tick', now(), now(), now()),
  ('17210000-0000-0000-0000-000000000a32', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f01', '17210000-0000-0000-0000-000000000401', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-03', 'present', 6, 'roster_tick', now(), now(), now()),
  ('17210000-0000-0000-0000-000000000a33', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f01', '17210000-0000-0000-0000-000000000402', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-03', 'present', 4, 'roster_tick', now(), now(), now()),
  ('17210000-0000-0000-0000-000000000a34', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f01', '17210000-0000-0000-0000-000000000401', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-06', 'present', 8, 'roster_tick', now(), now(), now()),
  ('17210000-0000-0000-0000-000000000a35', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f01', '17210000-0000-0000-0000-000000000401', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-10', 'present', 8, 'roster_tick', now(), now(), now()),
  ('17210000-0000-0000-0000-000000000a36', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f01', '17210000-0000-0000-0000-000000000401', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-10-30', 'present', 8, 'roster_tick', now(), now(), now()),
  -- N: submitted, not approved; and an approved absent day
  ('17210000-0000-0000-0000-000000000a37', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f01', '17210000-0000-0000-0000-000000000401', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-04', 'present', 8, 'roster_tick', now(), null, null),
  -- M 4 h on WO-2 (indirect daily); G 8 h on WO-2 (guard monthly); Q 8 h with no class; Z 8 h in a class with no rate
  ('17210000-0000-0000-0000-000000000a41', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f02', '17210000-0000-0000-0000-000000000402', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-02', 'present', 4, 'roster_tick', now(), now(), now()),
  ('17210000-0000-0000-0000-000000000a42', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f03', '17210000-0000-0000-0000-000000000402', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-02', 'present', 8, 'roster_tick', now(), now(), now()),
  ('17210000-0000-0000-0000-000000000a43', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f04', '17210000-0000-0000-0000-000000000401', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-02', 'present', 8, 'roster_tick', now(), now(), now()),
  ('17210000-0000-0000-0000-000000000a44', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f07', '17210000-0000-0000-0000-000000000401', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-02', 'present', 8, 'roster_tick', now(), now(), now());
insert into attendance_days (id, org_id, worker_id, work_order_id, project_id, crew_id, work_date, status, hours, source,
                             submitted_at, approved_at, locked_at) values
  ('17210000-0000-0000-0000-000000000a38', '17210000-0000-0000-0000-00000000000a', '17210000-0000-0000-0000-000000000f01', '17210000-0000-0000-0000-000000000401', '17210000-0000-0000-0000-0000000000d1', '17210000-0000-0000-0000-000000000c01', '2026-11-05', 'absent', null, 'roster_tick', now(), now(), now());
set local session_replication_role = origin;

set local role authenticated;
select pg_temp.act_as('17210000-0000-0000-0000-0000000000a1');
create temp table after_cost as select * from public.work_order_cost_amounts('17210000-0000-0000-0000-0000000000d1');
create temp table after_idle as select * from public.work_order_idle_cost('17210000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from (select * from before_cost except all select * from after_cost) x)
        + (select count(*)::int from (select * from after_cost except all select * from before_cost) y), 0,
  'AC-NLL-001 with the switch off the cost read is identical after no-login days, class rates and assignments exist');
select is((select count(*)::int from (select * from before_idle except all select * from after_idle) x)
        + (select count(*)::int from (select * from after_idle except all select * from before_idle) y), 0,
  'AC-NLL-001 with the switch off the idle cost read is identical too');
select is((select count(*)::int from after_cost where source = 'attendance_day'), 0,
  'AC-NLL-001 with the switch off no attendance row is read');

-- ── switch on ─────────────────────────────────────────────────────────────────────────────────────────────────
select public.save_labour_cost_settings(true);
create temp table fin_rows as select * from public.work_order_cost_amounts('17210000-0000-0000-0000-0000000000d1');
grant select on fin_rows to authenticated;
select ok((select count(*)::int from fin_rows where source = 'attendance_day') > 0,
  'AC-NLL-001 the same data with the switch on is read (the off proof is not vacuous)');

-- ── AC-NLL-002 hourly class rate ──────────────────────────────────────────────────────────────────────────────
select is((select amount from fin_rows where record_id = '17210000-0000-0000-0000-000000000a31'), '320000.00',
  'AC-NLL-002 8 approved hours at a 40000 hourly class rate cost 320000.00');
select is((select reason || ':' || currency || ':' || quantity::text || ':' || quantity_unit from fin_rows where record_id = '17210000-0000-0000-0000-000000000a31'),
  'counted:IDR:8.00:hours', 'AC-NLL-002 the day is counted, in the organisation currency, with its hours');
select is((select labour_class_id from fin_rows where record_id = '17210000-0000-0000-0000-000000000a31'), (select id from k where code = 'direct'),
  'AC-NLL-002 the day carries the class the person holds');
select is((select person_id from fin_rows where record_id = '17210000-0000-0000-0000-000000000a31'), '17210000-0000-0000-0000-000000000f01'::uuid,
  'AC-NLL-002 Finance sees the person (register id)');
select is((select work_order_id::text || ':' || discipline_id::text from fin_rows where record_id = '17210000-0000-0000-0000-000000000a31'),
  '17210000-0000-0000-0000-000000000401:17210000-0000-0000-0000-000000000501', 'AC-NLL-002 the day is the work order''s cost, in the crew''s discipline');

-- ── AC-NLL-003 daily, monthly, overtime across two work orders ───────────────────────────────────────────────
select is((select amount from fin_rows where record_id = '17210000-0000-0000-0000-000000000a41'), '400000.00',
  'AC-NLL-003 4 h of an 800000 daily class rate over an 8 h day cost 400000.00');
select is((select amount from fin_rows where record_id = '17210000-0000-0000-0000-000000000a42'), '160000.00',
  'AC-NLL-003 8 h of a 3460000 monthly class rate over 173 h cost 160000.00');
select is((select amount from fin_rows where record_id = '17210000-0000-0000-0000-000000000a32'), '240000.00',
  'AC-NLL-003 the first 6 h of a 10 h day are regular');
select is((select amount from fin_rows where record_id = '17210000-0000-0000-0000-000000000a33'), '200000.00',
  'AC-NLL-003 the other work order gets 2 h regular and 2 h at 1.5: the day is priced once');

-- ── AC-NLL-004 history; no class; no rate ────────────────────────────────────────────────────────────────────
select is((select amount from fin_rows where record_id = '17210000-0000-0000-0000-000000000a34'), '400000.00',
  'AC-NLL-004 a date after the second direct rate starts takes it (50000 x 8)');
select is((select amount || ':' || (labour_class_id = (select id from k where code = 'indirect'))::text from fin_rows where record_id = '17210000-0000-0000-0000-000000000a35'),
  '800000.00:true', 'AC-NLL-004 a date after the person''s new class starts takes that class and its rate');
select is((select reason || ':' || coalesce(amount, 'null') || ':' || coalesce(labour_class_id::text, 'null') || ':' || quantity::text
             from fin_rows where record_id = '17210000-0000-0000-0000-000000000a36'),
  'no-rate:null:null:8.00', 'AC-NLL-004 a day before the person holds any class is no-rate, hours only');
select is((select reason || ':' || coalesce(amount, 'null') from fin_rows where record_id = '17210000-0000-0000-0000-000000000a43'),
  'no-rate:null', 'AC-NLL-004 a person with no class is no-rate');
select is((select reason || ':' || coalesce(amount, 'null') from fin_rows where record_id = '17210000-0000-0000-0000-000000000a44'),
  'no-rate:null', 'AC-NLL-004 a person in a class with no rate is no-rate');

-- ── AC-NLL-005 not approved, not present ─────────────────────────────────────────────────────────────────────
select is((select count(*)::int from fin_rows where record_id in ('17210000-0000-0000-0000-000000000a37', '17210000-0000-0000-0000-000000000a38')), 0,
  'AC-NLL-005 a submitted-not-approved day and an absent day give no row');

-- ── AC-NLL-006 the whole read counts one worker's day once ───────────────────────────────────────────────────
select is((select string_agg(source, ',' order by source) from fin_rows
            where record_id in ('17210000-0000-0000-0000-000000000711', '17210000-0000-0000-0000-000000000a11')),
  'timesheet_entry', 'AC-NLL-006 (a) a login''s attendance with its timesheet line is counted once, through the line');
select is((select count(*)::int from fin_rows where source = 'attendance_day' and occurred_on = '2026-11-02'
              and person_id = '17210000-0000-0000-0000-000000000f01'), 1,
  'AC-NLL-006 (b) a no-login person''s day is counted once');
select is((select string_agg(source, ',' order by source) from fin_rows
            where record_id in ('17210000-0000-0000-0000-000000000712', '17210000-0000-0000-0000-000000000a21')),
  'timesheet_entry', 'AC-NLL-006 (c) one worker, one day, attendance and an approved timesheet line: counted once, through the line');
select is((select count(*)::int from fin_rows where source = 'attendance_day'
              and person_id in ('17210000-0000-0000-0000-000000000f05', '17210000-0000-0000-0000-000000000f06')), 0,
  'AC-NLL-006 no attendance row for either person with a login');
select is((select sum(amount::numeric)::text from fin_rows where reason = 'counted' and labour_class_id is not null), '3000000.00',
  'AC-NLL-006 total counted labour equals the hand sum (2 timesheet lines + 7 no-login days)');

-- ── AC-NLL-007 privacy ───────────────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('17210000-0000-0000-0000-0000000000a2');
create temp table pm_rows as select * from public.work_order_cost_amounts('17210000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from pm_rows where source = 'attendance_day' and reason = 'counted'
              and (record_id is not null or occurred_on is not null or person_id is not null)), 0,
  'AC-NLL-007 a Project Manager reads attendance money with no record, no date and no person');
select is((select sum(amount::numeric)::text from pm_rows where source = 'attendance_day' and reason = 'counted'),
  (select sum(amount::numeric)::text from fin_rows where source = 'attendance_day' and reason = 'counted'),
  'AC-NLL-007 and the aggregate equals what Finance sees');
select is((select count(*)::int from pm_rows where source = 'attendance_day' and person_id is not null), 0,
  'AC-NLL-007 no attendance row names a person for a Project Manager, priced or not');
select is((select count(*)::int from public.labour_cost_rates where subject_kind = 'class'), 0,
  'AC-NLL-007 a Project Manager reads no class rate');
select is((select count(*)::int from public.labour_class_assignments), 0,
  'AC-NLL-007 a Project Manager reads no class assignment');
select pg_temp.act_as('17210000-0000-0000-0000-0000000000a4');
select throws_ok($$select * from public.work_order_cost_amounts('17210000-0000-0000-0000-0000000000d1')$$, '42501', null,
  'AC-NLL-007 a role outside the four is refused the read');
select pg_temp.act_as('17210000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.work_order_cost_amounts('17210000-0000-0000-0000-0000000000d1')
            where source = 'attendance_day' and reason = 'counted' and record_id is not null), 7,
  'AC-NLL-007 Executive reads the per-day rows');
select is((select count(*)::int from public.labour_cost_rates where subject_kind = 'class'), 4,
  'AC-NLL-007 Executive reads the class rates');

-- ── AC-NLL-008 idle cost on a work order whose only priced labour is attendance ──────────────────────────────
select pg_temp.act_as('17210000-0000-0000-0000-0000000000a1');
-- WO-2: N 4 h (200000) + M 4 h (400000) + G 8 h (160000) = 760000 over 16 h = 47500 an hour; 60 idle minutes.
select is((select reason || ':' || hourly_cost || ':' || amount from public.work_order_idle_cost('17210000-0000-0000-0000-0000000000d1')
            where work_order_id = '17210000-0000-0000-0000-000000000402'),
  'counted:47500.00:47500.00', 'AC-NLL-008 idle hours on an attendance-only work order are costed at its hourly cost');
select pg_temp.act_as('17210000-0000-0000-0000-0000000000a2');
select is((select reason || ':' || coalesce(hourly_cost, 'null') || ':' || amount from public.work_order_idle_cost('17210000-0000-0000-0000-0000000000d1')
            where work_order_id = '17210000-0000-0000-0000-000000000402'),
  'counted:null:47500.00', 'AC-NLL-008 a Project Manager sees the idle amount but no hourly cost');

select * from finish();
rollback;
