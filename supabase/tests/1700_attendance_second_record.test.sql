-- 1700_attendance_second_record.test.sql — docs/specs/pay-time.spec.md. Money path (hours feed cost) + SoD.
-- Migrations under test: 1700, 1701, 1702.
-- AC-PAY-001 a second record is stored apart and changes no figure · AC-PAY-002 who may enter, and the submitted-week fence ·
-- AC-PAY-003 an undecided day cannot be submitted, a correction does not clear it · AC-PAY-004 a decision puts the chosen figure on the
-- day, the other stays as evidence · AC-PAY-005 whole ledger: one worker, one day, two records, counted once ·
-- AC-PAY-006 separation (AC-PAY-009: never on one's own working day, 1932) · AC-PAY-007 the organisation names the decider (Admin-only setting) · AC-PAY-008 within tolerance nothing to decide.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   drop the recorder test in attendance_second_record_decide ........... 'AC-PAY-006 the foreman who ticked cannot decide'
--   drop the may_decide test in the decide RPC .......................... 'AC-PAY-007 ... not the named role'
--   drop the may_enter test in attendance_second_record ................. 'AC-PAY-002 a role that is not named'
--   drop trigger attendance_days_undecided_guard ........................ 'AC-PAY-003 ...'
--   drop the merge of the second record's authors into recorded_by_ids (1701) ... 'AC-PAY-006 the manager who entered the standing second record cannot approve ...'
--   decide 'second' by inserting a second attendance row / keep both ..... 'AC-PAY-005 ...'
--   change the tolerance comparison to >= 0 ............................. 'AC-PAY-008 ...'
--   (1932) drop the own-day test in attendance_second_record (mut:enter_self) .. 'AC-PAY-009 nobody enters a second record for their own day'
--   (1932) drop the own-day test in the decide RPC (mut:decide_self) ............ 'AC-PAY-009 nobody decides the hours of their own day'
begin;
create extension if not exists pgtap;
select plan(59);

insert into organizations (id, name, default_currency, attendance_backdate_days, built_in_roles_enabled) values
  ('17000000-0000-0000-0000-00000000020a', 'PT Org', 'IDR', 60, true);
insert into auth.users (id, email) values
  ('17000000-0000-0000-0000-0000000000a1', 'pt-admin@example.com'),
  ('17000000-0000-0000-0000-0000000000a2', 'pt-fc@example.com'),
  ('17000000-0000-0000-0000-0000000000a3', 'pt-sv@example.com'),
  ('17000000-0000-0000-0000-0000000000a4', 'pt-pm@example.com'),
  ('17000000-0000-0000-0000-0000000000a5', 'pt-pm2@example.com'),
  ('17000000-0000-0000-0000-0000000000a6', 'pt-eng@example.com'),
  ('17000000-0000-0000-0000-0000000000a7', 'pt-worker@example.com'),
  ('17000000-0000-0000-0000-0000000000a8', 'pt-pcm@example.com'),
  ('17000000-0000-0000-0000-0000000000a9', 'pt-worker2@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('17000000-0000-0000-0000-0000000000a1', '17000000-0000-0000-0000-00000000020a', 'PT Admin',  'pt-admin@example.com',  'Admin', 'active', null),
  ('17000000-0000-0000-0000-0000000000a2', '17000000-0000-0000-0000-00000000020a', 'PT FC',     'pt-fc@example.com',     'Project Manager', 'active', null),
  ('17000000-0000-0000-0000-0000000000a3', '17000000-0000-0000-0000-00000000020a', 'PT SV',     'pt-sv@example.com',     'Engineer', 'active', 'quantity_surveyor'),
  ('17000000-0000-0000-0000-0000000000a4', '17000000-0000-0000-0000-00000000020a', 'PT PM',     'pt-pm@example.com',     'Project Manager', 'active', null),
  ('17000000-0000-0000-0000-0000000000a5', '17000000-0000-0000-0000-00000000020a', 'PT PM2',    'pt-pm2@example.com',    'Project Manager', 'active', null),
  ('17000000-0000-0000-0000-0000000000a6', '17000000-0000-0000-0000-00000000020a', 'PT Eng',    'pt-eng@example.com',    'Engineer', 'active', null),
  ('17000000-0000-0000-0000-0000000000a7', '17000000-0000-0000-0000-00000000020a', 'PT Worker', 'pt-worker@example.com', 'Engineer', 'active', null),
  ('17000000-0000-0000-0000-0000000000a8', '17000000-0000-0000-0000-00000000020a', 'PT PCM',    'pt-pcm@example.com',    'Project Manager', 'active', 'project_control_manager'),
  ('17000000-0000-0000-0000-0000000000a9', '17000000-0000-0000-0000-00000000020a', 'PT Worker2', 'pt-worker2@example.com', 'Engineer', 'active', null);
-- The Project Manager is the second login worker's line manager: the base approval route WOULD let them approve that timesheet,
-- so only the recorder separation can refuse them (AC-PAY-006, last assertion).
update profiles set manager_id = '17000000-0000-0000-0000-0000000000a4' where id = '17000000-0000-0000-0000-0000000000a9';
insert into projects (id, org_id, name, status, project_manager_id) values
  ('17000000-0000-0000-0000-0000000000d1', '17000000-0000-0000-0000-00000000020a', 'PT Site', 'Ongoing Project', '17000000-0000-0000-0000-0000000000a4');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('17000000-0000-0000-0000-000000000401', '17000000-0000-0000-0000-00000000020a', '17000000-0000-0000-0000-0000000000d1', 'PT WO one', 'Issued', 1000, 'exclusive', 0);
insert into cost_disciplines (id, org_id, code, name) values
  ('17000000-0000-0000-0000-000000000501', '17000000-0000-0000-0000-00000000020a', 'MEC', 'Mechanical');
insert into crews (id, org_id, code, name, field_controller_id, discipline_id) values
  ('17000000-0000-0000-0000-000000000c01', '17000000-0000-0000-0000-00000000020a', 'PT-A', 'Crew A',
   '17000000-0000-0000-0000-0000000000a2', '17000000-0000-0000-0000-000000000501');
insert into people (id, org_id, kind, name, profile_id) values
  ('17000000-0000-0000-0000-000000000f01', '17000000-0000-0000-0000-00000000020a', 'vendor', 'No Login One', null),
  ('17000000-0000-0000-0000-000000000f02', '17000000-0000-0000-0000-00000000020a', 'own',    'Login Two',   '17000000-0000-0000-0000-0000000000a7'),
  ('17000000-0000-0000-0000-000000000f03', '17000000-0000-0000-0000-00000000020a', 'vendor', 'No Login Three', null),
  ('17000000-0000-0000-0000-000000000f04', '17000000-0000-0000-0000-00000000020a', 'vendor', 'No Login Four', null),
  ('17000000-0000-0000-0000-000000000f05', '17000000-0000-0000-0000-00000000020a', 'own',    'Login Five',  '17000000-0000-0000-0000-0000000000a9');
insert into crew_members (org_id, crew_id, worker_id, valid_from)
  select '17000000-0000-0000-0000-00000000020a', '17000000-0000-0000-0000-000000000c01', id, current_date - 50
    from people where id::text like '17000000-%';
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('17000000-0000-0000-0000-00000000020a', '17000000-0000-0000-0000-000000000401', '17000000-0000-0000-0000-000000000c01', current_date - 50);

create temp table pt (k text primary key, d date, id uuid);
insert into pt (k, d) values ('week', (date_trunc('week', current_date)::date - 14));
grant all on pt to authenticated;
create function pg_temp.week() returns date language sql stable as $$ select d from pt where k = 'week' $$;
create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- The live "waiting for a decision" check is internal (no client may call it): read it as the owner.
create function pg_temp.und(p_worker uuid, p_date date) returns boolean language sql security definer as $$
  select public.attendance_day_undecided(p_worker, '17000000-0000-0000-0000-000000000401', p_date) $$;
grant execute on function pg_temp.und(uuid, date) to authenticated;

set local role authenticated;
-- The foreman ticks two people on Tuesday and the login worker on Wednesday.
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a2');
select attendance_record('17000000-0000-0000-0000-000000000401', pg_temp.week() + 1, 'roster_tick',
  '[{"worker_id":"17000000-0000-0000-0000-000000000f01","status":"present","hours":8},
    {"worker_id":"17000000-0000-0000-0000-000000000f02","status":"present","hours":8}]');
select attendance_record('17000000-0000-0000-0000-000000000401', pg_temp.week() + 2, 'roster_tick',
  '[{"worker_id":"17000000-0000-0000-0000-000000000f02","status":"present","hours":6}]');

-- AC-PAY-002 who may enter
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a6');
select throws_ok($$ select attendance_second_record('17000000-0000-0000-0000-000000000401', pg_temp.week() + 1,
  '[{"worker_id":"17000000-0000-0000-0000-000000000f01","status":"present","hours":5}]') $$,
  '42501', 'ATT_SECOND_ROLE: your role does not enter second records', 'AC-PAY-002 a role that is not named (and not a manager level) cannot enter a second record');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select attendance_second_record('17000000-0000-0000-0000-000000000401', pg_temp.week() + 1,
  '[{"worker_id":"17000000-0000-0000-0000-000000000f01","status":"present","hours":5}]') $$,
  '42501', 'ATT_SECOND_SAME_PERSON: you recorded this day; a second record comes from someone else',
  'AC-PAY-002 nobody gives a second opinion on a day they recorded');

-- AC-PAY-001: the surveyor records 5 hours against the foreman's 8.
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a3');
select is(attendance_second_record('17000000-0000-0000-0000-000000000401', pg_temp.week() + 1,
  '[{"worker_id":"17000000-0000-0000-0000-000000000f01","status":"present","hours":5,"note":"survey sheet"},
    {"worker_id":"17000000-0000-0000-0000-000000000f02","status":"present","hours":7.5}]'), 2,
  'AC-PAY-001 the surveyor records second records');
select is((select count(*)::int from attendance_second_records where work_date = pg_temp.week() + 1), 2, 'AC-PAY-001 stored apart, one per worker and day');
-- A surveyor cannot read attendance days (row security), so the day is read as a manager.
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a4');
select is((select hours from attendance_days where worker_id = '17000000-0000-0000-0000-000000000f01' and work_date = pg_temp.week() + 1),
  8.00::numeric, 'AC-PAY-001 the day still carries the site report figure (8)');
select is((select count(*)::int from attendance_days where worker_id = '17000000-0000-0000-0000-000000000f01'), 1,
  'AC-PAY-001 still one attendance row for the worker');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a3');
select throws_ok($$ select attendance_second_record('17000000-0000-0000-0000-000000000401', pg_temp.week() + 1,
  '[{"worker_id":"17000000-0000-0000-0000-000000000f01","status":"present","hours":30}]') $$,
  '22023', 'ATT_HOURS: a present person needs hours', 'AC-PAY-001 hours run from 0 to 24');
select throws_ok($$ update attendance_second_records set hours = 1 $$, '42501', null, 'AC-PAY-001 a user cannot edit second records directly');

-- AC-PAY-008 / AC-PAY-003 what needs deciding
select is(pg_temp.und('17000000-0000-0000-0000-000000000f01', pg_temp.week() + 1), true, 'AC-PAY-003 8 versus 5 waits for a decision');
select is(pg_temp.und('17000000-0000-0000-0000-000000000f02', pg_temp.week() + 1), false, 'AC-PAY-008 8 versus 7.5 is within the tolerance: nothing to decide');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a4');
select throws_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f02', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() + 1, 'second', 'x') $$, '23514', 'ATT_NOT_DISAGREEING: the two records agree, nothing to decide',
  'AC-PAY-008 a decision is refused when the records agree, the site report figure stands');
select is((select hours from attendance_days where worker_id = '17000000-0000-0000-0000-000000000f02' and work_date = pg_temp.week() + 1),
  8.00::numeric, 'AC-PAY-008 the day''s 8 stands, the 7.5 stays on file');

-- AC-PAY-003: the undecided day cannot be sent on, and a correction does not clear it.
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a2');
select throws_like($$ select attendance_generate_timesheet('17000000-0000-0000-0000-000000000f01', pg_temp.week()) $$,
  'ATT_UNDECIDED:%', 'AC-PAY-003 a no-login week with an undecided day cannot be sent for approval');
select attendance_record('17000000-0000-0000-0000-000000000401', pg_temp.week() + 1, 'manual_correction',
  '[{"worker_id":"17000000-0000-0000-0000-000000000f01","status":"present","hours":8}]');
select throws_like($$ select attendance_generate_timesheet('17000000-0000-0000-0000-000000000f01', pg_temp.week()) $$,
  'ATT_UNDECIDED:%', 'AC-PAY-003 a correction of the day does not clear the disagreement');
select is((select count(*)::int from attendance_days where worker_id = '17000000-0000-0000-0000-000000000f01' and submitted_at is not null), 0,
  'AC-PAY-003 nothing was submitted');
-- The login worker's second day: 6 versus 9 blocks the timesheet line.
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a3');
select attendance_second_record('17000000-0000-0000-0000-000000000401', pg_temp.week() + 2,
  '[{"worker_id":"17000000-0000-0000-0000-000000000f02","status":"present","hours":9}]');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a2');
select throws_like($$ select attendance_generate_timesheet('17000000-0000-0000-0000-000000000f02', pg_temp.week()) $$,
  'ATT_UNDECIDED:%', 'AC-PAY-003 a login worker''s timesheet line is not made while a day is undecided');
select is((select count(*)::int from timesheet_entries e join timesheets t on t.id = e.timesheet_id
            where t.user_id = '17000000-0000-0000-0000-0000000000a7'), 0, 'AC-PAY-003 no timesheet line was written');

-- AC-PAY-006 separation
select throws_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f01', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() + 1, 'day', 'site report') $$, '42501', 'ATT_DECIDE_SAME_PERSON: you recorded one of these figures; someone else decides',
  'AC-PAY-006 the foreman who ticked cannot decide');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a3');
select throws_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f01', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() + 1, 'second', 'survey') $$, '42501', 'ATT_DECIDE_SAME_PERSON: you recorded one of these figures; someone else decides',
  'AC-PAY-006 the surveyor who entered the second record cannot decide');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a6');
select throws_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f01', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() + 1, 'second', 'survey') $$, '42501', 'ATT_DECIDER_ROLE: your role does not decide which hours stand',
  'AC-PAY-006 a role that is not an approver cannot decide');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a4');
select throws_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f01', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() + 1, 'second', '  ') $$, '22023', 'ATT_DECIDE_REASON: say why this figure stands', 'AC-PAY-004 the decision needs a reason');

-- AC-PAY-004: the manager chooses the second record for the no-login worker, the site report figure for the login worker.
select lives_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f01', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() + 1, 'second', 'survey sheet is signed') $$, 'AC-PAY-004 a manager who recorded neither decides');
select is((select jsonb_build_object('h', hours, 'tick', tick_hours) from attendance_days
            where worker_id = '17000000-0000-0000-0000-000000000f01' and work_date = pg_temp.week() + 1),
  '{"h": 5.00, "tick": 8.00}'::jsonb, 'AC-PAY-004 the day now carries 5, the foreman''s 8 is kept as evidence');
select is((select jsonb_build_object('s', standing, 'by', right(decided_by::text, 2)) from attendance_second_records
            where worker_id = '17000000-0000-0000-0000-000000000f01'), '{"s": "second", "by": "a4"}'::jsonb,
  'AC-PAY-004 the decision records who decided and which figure stands');
select lives_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f02', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() + 2, 'day', 'site report is the record of work') $$, 'AC-PAY-004 choosing the site report figure');
select is((select hours from attendance_days where worker_id = '17000000-0000-0000-0000-000000000f02' and work_date = pg_temp.week() + 2),
  6.00::numeric, 'AC-PAY-004 the day keeps 6; the surveyor''s 9 stays on file');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a5');
select throws_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f01', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() + 1, 'day', 'again') $$, '55000', 'ATT_DECIDED: this day is already decided', 'AC-PAY-004 a decided day is not decided twice');

-- Approval of both weeks. The decider cannot approve what they decided.
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a2');
select is(attendance_generate_timesheet('17000000-0000-0000-0000-000000000f01', pg_temp.week()) ->> 'mode', 'attendance',
  'AC-PAY-004 once decided, the no-login week goes for approval');
select attendance_generate_timesheet('17000000-0000-0000-0000-000000000f02', pg_temp.week());
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a3');
select throws_ok($$ select attendance_second_record('17000000-0000-0000-0000-000000000401', pg_temp.week() + 1,
  '[{"worker_id":"17000000-0000-0000-0000-000000000f01","status":"present","hours":4}]') $$,
  '55000', 'ATT_SUBMITTED: this week is submitted; return it through the timesheet correction path to change it',
  'AC-PAY-002 a submitted week takes no second record');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a4');
select throws_ok($$ select attendance_decide_week('17000000-0000-0000-0000-000000000f01', pg_temp.week(), 'approve') $$,
  '42501', 'separation of duties: the attendance recorder cannot approve these hours', 'AC-PAY-006 the decider cannot then approve that week');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a5');
select is(attendance_decide_week('17000000-0000-0000-0000-000000000f01', pg_temp.week(), 'approve'), 1, 'AC-PAY-004 another manager approves the week');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select transition_timesheet((select t.id from timesheets t where t.user_id = '17000000-0000-0000-0000-0000000000a7'
                                                 and t.week_start_date = pg_temp.week()), 'Approved') $$,
  'AC-PAY-004 the login worker''s timesheet is approved');

-- AC-PAY-005 whole ledger: one worker, one day, two records, counted once.
select is((select sum(quantity) from work_order_cost_lines
            where source in ('attendance_day', 'timesheet_entry') and work_order_id = '17000000-0000-0000-0000-000000000401'
              and occurred_on = pg_temp.week() + 1), 13.00::numeric,
  'AC-PAY-005 Tuesday: 5 (no-login, second record stands) + 8 (login, site report stands), nothing counted twice');
select is((select sum(quantity) from work_order_cost_lines l join attendance_days a on a.id = l.record_id
            where l.source = 'attendance_day' and a.worker_id = '17000000-0000-0000-0000-000000000f01'), 5.00::numeric,
  'AC-PAY-005 the no-login worker''s day is costed once, at the chosen figure');
select is((select sum(quantity) from work_order_cost_lines
            where source in ('attendance_day', 'timesheet_entry') and work_order_id = '17000000-0000-0000-0000-000000000401'
              and occurred_on = pg_temp.week() + 2), 6.00::numeric,
  'AC-PAY-005 Wednesday: the login worker''s line carries the chosen 6, the 9 is not costed');
select is((select count(*)::int from work_order_cost_lines l join attendance_days a on a.id = l.record_id
            where l.source = 'attendance_day' and a.worker_id = '17000000-0000-0000-0000-000000000f02'), 0,
  'AC-PAY-005 a day that became a timesheet line is not also costed as a day');
reset role;
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, author_id) values
  ('17000000-0000-0000-0000-0000000005a1', '17000000-0000-0000-0000-00000000020a', '17000000-0000-0000-0000-0000000000d1',
   '17000000-0000-0000-0000-000000000401', (select d from pt where k = 'week') + 1, '17000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a4');
select is((dsr_report_hours('17000000-0000-0000-0000-0000000005a1') ->> 'people_hours')::numeric, 13.00::numeric,
  'AC-PAY-005 the site report counts the day once');
-- Every person the fixture places in the rostered crew (No Login One, Login Two, No Login Three, No Login Four, Login Five) is rostered on this day.
select is((select jsonb_array_length(attendance_report_day_hours('17000000-0000-0000-0000-0000000005a1') -> 'workers')),
  5,
  'FR-PAY-007 the manager sees exactly the rostered workers on the site report (all five placed in the crew)');
select is((select w -> 'second' ->> 'standing' from jsonb_array_elements(attendance_report_day_hours('17000000-0000-0000-0000-0000000005a1') -> 'workers') w
            where w ->> 'name' = 'No Login One'), 'second', 'FR-PAY-007 the report shows which figure stands');
select is((select w -> 'second' ->> 'decided_by_name' from jsonb_array_elements(attendance_report_day_hours('17000000-0000-0000-0000-0000000005a1') -> 'workers') w
            where w ->> 'name' = 'No Login One'), (select full_name from profiles where id = '17000000-0000-0000-0000-0000000000a4'), 'FR-PAY-004 the report names who decided');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a6');
select is(attendance_report_day_hours('17000000-0000-0000-0000-0000000005a1') -> 'detail', 'false'::jsonb,
  'FR-PAY-007 a role that records no time sees only the total');

-- AC-PAY-007 the organisation names the decider. Previous week, a third worker.
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a2');
select attendance_record('17000000-0000-0000-0000-000000000401', pg_temp.week() - 6, 'roster_tick',
  '[{"worker_id":"17000000-0000-0000-0000-000000000f03","status":"present","hours":8}]');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a3');
select attendance_second_record('17000000-0000-0000-0000-000000000401', pg_temp.week() - 6,
  '[{"worker_id":"17000000-0000-0000-0000-000000000f03","status":"present","hours":3}]');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a6');
select throws_ok($$ select set_attendance_time_roles(array['quantity_surveyor'], array['project_control_manager']) $$,
  '42501', 'not authorized', 'AC-PAY-007 only an Admin names the roles');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select set_attendance_time_roles(array['quantity_surveyor'], array['no_such_role']) $$,
  '22023', 'ATT_ROLE_UNKNOWN: choose roles from the built-in list', 'AC-PAY-007 roles come from the built-in list');
select lives_ok($$ select set_attendance_time_roles(array['quantity_surveyor'], array['project_control_manager']) $$,
  'AC-PAY-007 the Admin names the deciding role');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a4');
select throws_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f03', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() - 6, 'day', 'site report') $$, '42501', 'ATT_DECIDER_ROLE: your role does not decide which hours stand',
  'AC-PAY-007 a Project Manager who is not the named role is refused');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a8');
select lives_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f03', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() - 6, 'day', 'site report') $$, 'AC-PAY-007 the named role decides');
-- A decided day whose figure someone later changes is a new disagreement.
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a2');
select attendance_record('17000000-0000-0000-0000-000000000401', pg_temp.week() - 6, 'manual_correction',
  '[{"worker_id":"17000000-0000-0000-0000-000000000f03","status":"present","hours":6}]');
select is((select decided_at is null from attendance_second_records where worker_id = '17000000-0000-0000-0000-000000000f03'), true,
  'AC-PAY-003 a later change of the decided day withdraws the decision');
select is(pg_temp.und('17000000-0000-0000-0000-000000000f03', pg_temp.week() - 6), true, 'AC-PAY-003 and it waits for a decision again');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select set_attendance_time_roles(array['quantity_surveyor'], array[]::text[]) $$, 'AC-PAY-007 an empty list restores the default approvers');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a4');
select lives_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f03', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() - 6, 'day', 'site report again') $$, 'AC-PAY-007 with no role named a Project Manager decides again');

-- AC-PAY-006 the author of a second record that stands cannot approve the week. Week of two Mondays ago, one more worker each path.
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a2');
select attendance_record('17000000-0000-0000-0000-000000000401', pg_temp.week() - 13, 'roster_tick',
  '[{"worker_id":"17000000-0000-0000-0000-000000000f04","status":"present","hours":8},
    {"worker_id":"17000000-0000-0000-0000-000000000f05","status":"present","hours":8}]');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a4');
select attendance_second_record('17000000-0000-0000-0000-000000000401', pg_temp.week() - 13,
  '[{"worker_id":"17000000-0000-0000-0000-000000000f04","status":"present","hours":10},
    {"worker_id":"17000000-0000-0000-0000-000000000f05","status":"present","hours":10}]');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a1');
select attendance_second_record_decide('17000000-0000-0000-0000-000000000f04', '17000000-0000-0000-0000-000000000401', pg_temp.week() - 13, 'second', 'survey sheet is signed');
select attendance_second_record_decide('17000000-0000-0000-0000-000000000f05', '17000000-0000-0000-0000-000000000401', pg_temp.week() - 13, 'second', 'survey sheet is signed');
select is((select hours from attendance_days where worker_id = '17000000-0000-0000-0000-000000000f04'), 10.00::numeric, 'AC-PAY-006 the second record stands: the day carries 10');
select is((select '17000000-0000-0000-0000-0000000000a4'::uuid = any (recorded_by_ids) from attendance_days where worker_id = '17000000-0000-0000-0000-000000000f04'), true,
  'AC-PAY-006 the second record''s author joins the day''s recorders');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a2');
select attendance_generate_timesheet('17000000-0000-0000-0000-000000000f04', pg_temp.week() - 14);
select attendance_generate_timesheet('17000000-0000-0000-0000-000000000f05', pg_temp.week() - 14);
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a4');
select throws_ok($$ select attendance_decide_week('17000000-0000-0000-0000-000000000f04', pg_temp.week() - 14, 'approve') $$,
  '42501', 'separation of duties: the attendance recorder cannot approve these hours',
  'AC-PAY-006 the manager who entered the standing second record cannot approve the no-login week');
select throws_ok($$ select transition_timesheet((select t.id from timesheets t where t.user_id = '17000000-0000-0000-0000-0000000000a9'
                                                  and t.week_start_date = pg_temp.week() - 14), 'Approved') $$,
  '42501', 'separation of duties: the attendance recorder cannot approve these hours',
  'AC-PAY-006 nor the login worker''s timesheet');

-- AC-PAY-009 (1932) nobody enters a second record for, or decides the hours of, their own working day.
reset role;
insert into people (id, org_id, kind, name, profile_id) values
  ('17000000-0000-0000-0000-000000000f06', '17000000-0000-0000-0000-00000000020a', 'own', 'Login Six PM2', '17000000-0000-0000-0000-0000000000a5');
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('17000000-0000-0000-0000-00000000020a', '17000000-0000-0000-0000-000000000c01', '17000000-0000-0000-0000-000000000f06', current_date - 50);
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, author_id) values
  ('17000000-0000-0000-0000-0000000005a2', '17000000-0000-0000-0000-00000000020a', '17000000-0000-0000-0000-0000000000d1',
   '17000000-0000-0000-0000-000000000401', (select d from pt where k = 'week') - 20, '17000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a2');
select attendance_record('17000000-0000-0000-0000-000000000401', pg_temp.week() - 20, 'roster_tick',
  '[{"worker_id":"17000000-0000-0000-0000-000000000f06","status":"present","hours":8}]');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a5');
select throws_ok($$ select attendance_second_record('17000000-0000-0000-0000-000000000401', pg_temp.week() - 20,
  '[{"worker_id":"17000000-0000-0000-0000-000000000f06","status":"present","hours":11}]') $$,
  '42501', 'ATT_SECOND_SELF: this is your own working day; a second record comes from someone else',
  'AC-PAY-009 nobody enters a second record for their own day');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a4');
select is(attendance_second_record('17000000-0000-0000-0000-000000000401', pg_temp.week() - 20,
  '[{"worker_id":"17000000-0000-0000-0000-000000000f06","status":"present","hours":11}]'), 1,
  'AC-PAY-009 another manager still enters the second record for that person');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a5');
select is((select (w ->> 'own')::boolean from jsonb_array_elements(attendance_report_day_hours('17000000-0000-0000-0000-0000000005a2') -> 'workers') w
            where w ->> 'worker_id' = '17000000-0000-0000-0000-000000000f06'), true, 'AC-PAY-009 the report marks the caller''s own day');
select throws_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f06', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() - 20, 'second', 'my own hours') $$, '42501', 'ATT_DECIDE_SELF: this is your own working day; someone else decides which hours stand',
  'AC-PAY-009 nobody decides the hours of their own day');
select pg_temp.act_as('17000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select attendance_second_record_decide('17000000-0000-0000-0000-000000000f06', '17000000-0000-0000-0000-000000000401',
  pg_temp.week() - 20, 'day', 'site report') $$, 'AC-PAY-009 a decider whose day it is not decides it');

select * from finish();
rollback;
