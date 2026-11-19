-- attendance_timesheet.test.sql — #2528 Slice 3 (docs/specs/crews-roster-attendance.spec.md). Money path + SoD.
-- Migration under test: 0990_attendance_timesheet.sql (with 0988/0989).
-- AC-CRW-009 a week's attendance becomes a submitted timesheet, once · AC-CRW-010 the recorder cannot approve, another
-- supervisor can and the attendance locks · AC-CRW-011 locked attendance cannot be edited; re-opening is the correction
-- path · AC-CRW-012 a person with no login gets approved hours on the attendance, read by cost attribution.
-- Mutation checks (plan, Slice 3): allowing recorder = approver turns AC-CRW-010 red; dropping the lock turns AC-CRW-011 red.
begin;
create extension if not exists pgtap;
select plan(26);

insert into organizations (id, name, default_currency, attendance_backdate_days) values
  ('25280000-0000-0000-0000-00000000020a', 'ATS Org', 'IDR', 60);
insert into auth.users (id, email) values
  ('25280000-0000-0000-0000-0000000002a1', 'ats-admin@example.com'),
  ('25280000-0000-0000-0000-0000000002a2', 'ats-fin@example.com'),
  ('25280000-0000-0000-0000-0000000002a3', 'ats-pm@example.com'),
  ('25280000-0000-0000-0000-0000000002a4', 'ats-fc@example.com'),
  ('25280000-0000-0000-0000-0000000002a5', 'ats-worker@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25280000-0000-0000-0000-0000000002a1', '25280000-0000-0000-0000-00000000020a', 'ATS Admin',  'ats-admin@example.com',  'Admin', 'active'),
  ('25280000-0000-0000-0000-0000000002a2', '25280000-0000-0000-0000-00000000020a', 'ATS Fin',    'ats-fin@example.com',    'Finance', 'active'),
  ('25280000-0000-0000-0000-0000000002a3', '25280000-0000-0000-0000-00000000020a', 'ATS PM',     'ats-pm@example.com',     'Project Manager', 'active'),
  ('25280000-0000-0000-0000-0000000002a4', '25280000-0000-0000-0000-00000000020a', 'ATS FC',     'ats-fc@example.com',     'Project Manager', 'active'),
  ('25280000-0000-0000-0000-0000000002a5', '25280000-0000-0000-0000-00000000020a', 'ATS Worker', 'ats-worker@example.com', 'Engineer', 'active');
-- The field controller is ALSO the worker's line manager: every existing approval rule would let them approve, so only
-- the recorder rule stands between them and approving hours they recorded themselves.
update profiles set manager_id = '25280000-0000-0000-0000-0000000002a4' where id = '25280000-0000-0000-0000-0000000002a5';
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25280000-0000-0000-0000-0000000002d1', '25280000-0000-0000-0000-00000000020a', 'ATS Site', 'Ongoing Project', '25280000-0000-0000-0000-0000000002a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25280000-0000-0000-0000-000000002401', '25280000-0000-0000-0000-00000000020a', '25280000-0000-0000-0000-0000000002d1', 'ATS WO one', 'Issued', 1000, 'exclusive', 0);
insert into cost_disciplines (id, org_id, code, name) values
  ('25280000-0000-0000-0000-000000002501', '25280000-0000-0000-0000-00000000020a', 'MEC', 'Mechanical');
insert into crews (id, org_id, code, name, field_controller_id, discipline_id) values
  ('25280000-0000-0000-0000-000000002c01', '25280000-0000-0000-0000-00000000020a', 'TS-A', 'Crew A',
   '25280000-0000-0000-0000-0000000002a4', '25280000-0000-0000-0000-000000002501');
insert into crew_workers (id, org_id, kind, display_name, profile_id) values
  ('25280000-0000-0000-0000-000000002f01', '25280000-0000-0000-0000-00000000020a', 'own',    'Own Worker', '25280000-0000-0000-0000-0000000002a5'),
  ('25280000-0000-0000-0000-000000002f02', '25280000-0000-0000-0000-00000000020a', 'vendor', 'Vendor Two', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('25280000-0000-0000-0000-00000000020a', '25280000-0000-0000-0000-000000002c01', '25280000-0000-0000-0000-000000002f01', current_date - 50),
  ('25280000-0000-0000-0000-00000000020a', '25280000-0000-0000-0000-000000002c01', '25280000-0000-0000-0000-000000002f02', current_date - 50);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('25280000-0000-0000-0000-00000000020a', '25280000-0000-0000-0000-000000002401', '25280000-0000-0000-0000-000000002c01', current_date - 50);

create temp table ats (k text primary key, d date, id uuid);
insert into ats (k, d) values ('week', (date_trunc('week', current_date)::date - 14));
grant all on ats to authenticated;
create or replace function pg_temp.week() returns date language sql stable as $$ select d from ats where k = 'week' $$;
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
-- A complete week: the field controller ticks Mon–Fri present 8 hours (Friday with 2 overtime), Sat/Sun absent.
select pg_temp.act_as('25280000-0000-0000-0000-0000000002a4');
select attendance_record('25280000-0000-0000-0000-000000002401', pg_temp.week() + i, 'roster_tick',
         case when i < 5 then jsonb_build_array(
           jsonb_build_object('worker_id', '25280000-0000-0000-0000-000000002f01', 'status', 'present', 'hours', 8,
                              'overtime_hours', case when i = 4 then 2 end),
           jsonb_build_object('worker_id', '25280000-0000-0000-0000-000000002f02', 'status', 'present', 'hours', 8))
         else jsonb_build_array(
           jsonb_build_object('worker_id', '25280000-0000-0000-0000-000000002f01', 'status', 'absent'),
           jsonb_build_object('worker_id', '25280000-0000-0000-0000-000000002f02', 'status', 'absent')) end)
  from generate_series(0, 6) i;

-- AC-CRW-009
select is((attendance_generate_timesheet('25280000-0000-0000-0000-000000002f01', pg_temp.week()) ->> 'changed')::boolean, true,
  'AC-CRW-009 generation writes the week');
insert into ats (k, id) select 'sheet', id from timesheets
  where user_id = '25280000-0000-0000-0000-0000000002a5' and week_start_date = pg_temp.week();
select is((select status::text from timesheets where id = (select id from ats where k = 'sheet')), 'Submitted',
  'AC-CRW-009 the person''s weekly timesheet is Submitted');
select is((select jsonb_agg(jsonb_build_object('d', e.entry_date - pg_temp.week(), 'h', e.hours, 'wo', right(e.work_order_id::text, 4),
                                               'disc', right(e.discipline_id::text, 4)) order by e.entry_date)
             from timesheet_entries e where e.timesheet_id = (select id from ats where k = 'sheet')),
  '[{"d": 0, "h": 8.00, "wo": "2401", "disc": "2501"}, {"d": 1, "h": 8.00, "wo": "2401", "disc": "2501"},
    {"d": 2, "h": 8.00, "wo": "2401", "disc": "2501"}, {"d": 3, "h": 8.00, "wo": "2401", "disc": "2501"},
    {"d": 4, "h": 10.00, "wo": "2401", "disc": "2501"}]'::jsonb,
  'AC-CRW-009 one line per present day carrying the work order, the crew''s discipline and hours with overtime');
select is((select count(*)::int from attendance_days a join timesheet_entries e on e.id = a.timesheet_entry_id
            where a.worker_id = '25280000-0000-0000-0000-000000002f01'), 5,
  'AC-CRW-009 each present day is linked to its line');
select is((attendance_generate_timesheet('25280000-0000-0000-0000-000000002f01', pg_temp.week()) ->> 'changed')::boolean, false,
  'AC-CRW-009 a second run changes nothing');
select is((select count(*)::int from timesheet_entries where timesheet_id = (select id from ats where k = 'sheet')), 5,
  'AC-CRW-009 a second run adds no duplicate lines');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000002401', pg_temp.week(), 'roster_tick',
  '[{"worker_id": "25280000-0000-0000-0000-000000002f01", "status": "present", "hours": 4}]') $$,
  '55000', 'ATT_SUBMITTED: this week is submitted; return it through the timesheet correction path to change it',
  'AC-CRW-009 once submitted, attendance is not silently edited (FR-CRW-017)');

-- AC-CRW-010: the recorder (also the line manager) tries to approve.
select throws_ok($$ select transition_timesheet((select id from ats where k = 'sheet'), 'Approved') $$,
  '42501', 'separation of duties: the attendance recorder cannot approve these hours',
  'AC-CRW-010 the attendance recorder cannot approve the timesheet, even as the line manager');
select is((select status::text from timesheets where id = (select id from ats where k = 'sheet')), 'Submitted',
  'AC-CRW-010 the refused approval leaves the sheet Submitted');
select pg_temp.act_as('25280000-0000-0000-0000-0000000002a5');
select throws_ok($$ select transition_timesheet((select id from ats where k = 'sheet'), 'Approved') $$,
  '42501', 'separation of duties: cannot approve own timesheet', 'AC-CRW-010 the person cannot approve their own hours');
select pg_temp.act_as('25280000-0000-0000-0000-0000000002a1');
select lives_ok($$ select transition_timesheet((select id from ats where k = 'sheet'), 'Approved') $$,
  'AC-CRW-010 a different supervisor approves');
select is((select count(*)::int from attendance_days where worker_id = '25280000-0000-0000-0000-000000002f01'
             and timesheet_entry_id is not null and locked_at is not null
             and approved_by = '25280000-0000-0000-0000-0000000002a1'), 5,
  'AC-CRW-010 approval locks the attendance behind the sheet');

-- AC-CRW-011
select pg_temp.act_as('25280000-0000-0000-0000-0000000002a4');
select throws_ok($$ select attendance_record('25280000-0000-0000-0000-000000002401', pg_temp.week(), 'manual_correction',
  '[{"worker_id": "25280000-0000-0000-0000-000000002f01", "status": "present", "hours": 4}]') $$,
  '55000', 'ATT_LOCKED: approved attendance cannot be changed; correct it through the timesheet correction path',
  'AC-CRW-011 a correction of locked attendance is refused and names the correction path');
select throws_ok($$ update attendance_days set hours = 4 where worker_id = '25280000-0000-0000-0000-000000002f01' $$,
  '42501', null, 'AC-CRW-011 a user cannot edit attendance directly');
reset role;
select throws_ok($$ update attendance_days set hours = 4 where worker_id = '25280000-0000-0000-0000-000000002f01' and work_date = (select d from ats where k = 'week') $$,
  '55000', 'ATT_LOCKED: approved attendance cannot be changed; correct it through the timesheet correction path',
  'AC-CRW-011 not even the table owner edits locked attendance');
select throws_ok($$ delete from attendance_days where worker_id = '25280000-0000-0000-0000-000000002f01' and work_date = (select d from ats where k = 'week') $$,
  '55000', null, 'AC-CRW-011 locked attendance cannot be deleted');
set local role authenticated;
-- The correction path: the approver re-opens the sheet; the attendance unlocks and can be corrected and re-sent.
select pg_temp.act_as('25280000-0000-0000-0000-0000000002a1');
select lives_ok($$ select transition_timesheet((select id from ats where k = 'sheet'), 'Draft') $$,
  'AC-CRW-011 the approver re-opens the sheet (correction path)');
select is((select count(*)::int from attendance_days where worker_id = '25280000-0000-0000-0000-000000002f01' and locked_at is not null), 0,
  'AC-CRW-011 re-opening unlocks the attendance');
select pg_temp.act_as('25280000-0000-0000-0000-0000000002a4');
select is(attendance_record('25280000-0000-0000-0000-000000002401', pg_temp.week(), 'manual_correction',
  '[{"worker_id": "25280000-0000-0000-0000-000000002f01", "status": "present", "hours": 6}]'), 1,
  'AC-CRW-011 the re-opened day is corrected');
select is((attendance_generate_timesheet('25280000-0000-0000-0000-000000002f01', pg_temp.week()) ->> 'changed')::boolean, true,
  'AC-CRW-011 regeneration updates the line and re-submits');
select is((select e.hours from timesheet_entries e where e.timesheet_id = (select id from ats where k = 'sheet')
            and e.entry_date = pg_temp.week()), 6.00::numeric,
  'AC-CRW-011 the line carries the corrected hours, still one line');

-- AC-CRW-012: the vendor worker has no login.
select is(attendance_generate_timesheet('25280000-0000-0000-0000-000000002f02', pg_temp.week()) ->> 'mode', 'attendance',
  'AC-CRW-012 a person with no login submits on the attendance itself');
select throws_ok($$ select attendance_decide_week('25280000-0000-0000-0000-000000002f02', pg_temp.week(), 'approve') $$,
  '42501', 'separation of duties: the attendance recorder cannot approve these hours',
  'AC-CRW-012 the recorder cannot approve the no-login week');
select pg_temp.act_as('25280000-0000-0000-0000-0000000002a3');
select is(attendance_decide_week('25280000-0000-0000-0000-000000002f02', pg_temp.week(), 'approve'), 5,
  'AC-CRW-012 a different supervisor approves the five present days');
select pg_temp.act_as('25280000-0000-0000-0000-0000000002a2');
select is((select jsonb_build_object('n', count(*), 'hours', sum(quantity), 'wo', min(right(work_order_id::text, 4)),
                                     'disc', min(right(discipline_id::text, 4)))
             from work_order_cost_lines where source = 'attendance_day'),
  '{"n": 5, "hours": 40.00, "wo": "2401", "disc": "2501"}'::jsonb,
  'AC-CRW-012 cost attribution reads the approved hours per work order');
select is((select count(*)::int from work_order_cost_lines l join attendance_days a on a.id = l.record_id
            where l.source = 'attendance_day' and a.worker_id = '25280000-0000-0000-0000-000000002f01'), 0,
  'AC-CRW-012 hours that reached a timesheet are never counted twice');

select * from finish();
rollback;
