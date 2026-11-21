-- attendance_rate.test.sql — #2706 (docs/specs/attendance-rate.spec.md).
-- Migration under test: 1437_attendance_rate_by_crew.sql (setting: 1436_attendance_target_rate.sql).
-- AC-ATR-001 the target is empty until an Admin sets it · AC-ATR-002 only an Admin may set it ·
-- AC-ATR-003 the member-day counts and the rate · AC-ATR-004 days follow the placement's crew ·
-- AC-ATR-005 a day with no roster is not expected · AC-ATR-006 the period is ordered and bounded ·
-- AC-ATR-007 the reading roles and organisation isolation.
begin;
create extension if not exists pgtap;
select plan(29);

insert into organizations (id, name, default_currency) values
  ('27060000-0000-0000-0000-00000000010a', 'ATR Org',       'IDR'),
  ('27060000-0000-0000-0000-00000000010b', 'ATR Other Org', 'IDR');
insert into auth.users (id, email) values
  ('27060000-0000-0000-0000-0000000001a1', 'atr-admin@example.com'),
  ('27060000-0000-0000-0000-0000000001a2', 'atr-pm@example.com'),
  ('27060000-0000-0000-0000-0000000001a3', 'atr-fin@example.com'),
  ('27060000-0000-0000-0000-0000000001a4', 'atr-eng@example.com'),
  ('27060000-0000-0000-0000-0000000001a5', 'atr-exec@example.com'),
  ('27060000-0000-0000-0000-0000000001b1', 'atr-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27060000-0000-0000-0000-0000000001a1', '27060000-0000-0000-0000-00000000010a', 'ATR Admin',   'atr-admin@example.com', 'Admin',           'active'),
  ('27060000-0000-0000-0000-0000000001a2', '27060000-0000-0000-0000-00000000010a', 'ATR PM',      'atr-pm@example.com',    'Project Manager', 'active'),
  ('27060000-0000-0000-0000-0000000001a3', '27060000-0000-0000-0000-00000000010a', 'ATR Finance', 'atr-fin@example.com',   'Finance',         'active'),
  ('27060000-0000-0000-0000-0000000001a4', '27060000-0000-0000-0000-00000000010a', 'ATR Engineer','atr-eng@example.com',   'Engineer',        'active'),
  ('27060000-0000-0000-0000-0000000001a5', '27060000-0000-0000-0000-00000000010a', 'ATR Exec',    'atr-exec@example.com',  'Executive',       'active'),
  ('27060000-0000-0000-0000-0000000001b1', '27060000-0000-0000-0000-00000000010b', 'ATR XAdmin',  'atr-xorg@example.com',  'Admin',           'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('27060000-0000-0000-0000-0000000001d1', '27060000-0000-0000-0000-00000000010a', 'ATR Site', 'Ongoing Project', '27060000-0000-0000-0000-0000000001a2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-0000000001d1', 'ATR WO one', 'Issued', 1000, 'exclusive', 0),
  ('27060000-0000-0000-0000-000000001402', '27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-0000000001d1', 'ATR WO two', 'Issued', 1000, 'exclusive', 0);

-- Crew A: three people on five rostered days. Crew B: placed, never rostered. Crew C: archived, no activity.
-- Crew D: one person placed from day three, proving a person's days follow the placement's crew.
insert into crews (id, org_id, code, name, archived_at) values
  ('27060000-0000-0000-0000-000000001c01', '27060000-0000-0000-0000-00000000010a', 'ATR-A', 'Crew A', null),
  ('27060000-0000-0000-0000-000000001c02', '27060000-0000-0000-0000-00000000010a', 'ATR-B', 'Crew B', null),
  ('27060000-0000-0000-0000-000000001c03', '27060000-0000-0000-0000-00000000010a', 'ATR-C', 'Crew C', '2026-01-01T00:00:00Z'),
  ('27060000-0000-0000-0000-000000001c04', '27060000-0000-0000-0000-00000000010a', 'ATR-D', 'Crew D', null),
  ('27060000-0000-0000-0000-000000002c01', '27060000-0000-0000-0000-00000000010b', 'ATR-X', 'Other crew', null);
insert into people (id, org_id, kind, name) values
  ('27060000-0000-0000-0000-000000001f01', '27060000-0000-0000-0000-00000000010a', 'vendor', 'ATR One'),
  ('27060000-0000-0000-0000-000000001f02', '27060000-0000-0000-0000-00000000010a', 'vendor', 'ATR Two'),
  ('27060000-0000-0000-0000-000000001f03', '27060000-0000-0000-0000-00000000010a', 'vendor', 'ATR Three'),
  ('27060000-0000-0000-0000-000000001f04', '27060000-0000-0000-0000-00000000010a', 'vendor', 'ATR Four'),
  ('27060000-0000-0000-0000-000000001f05', '27060000-0000-0000-0000-00000000010a', 'vendor', 'ATR Five'),
  ('27060000-0000-0000-0000-000000002f01', '27060000-0000-0000-0000-00000000010b', 'vendor', 'ATR Other person');
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001c01', '27060000-0000-0000-0000-000000001f01', '2026-03-01'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001c01', '27060000-0000-0000-0000-000000001f02', '2026-03-01'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001c01', '27060000-0000-0000-0000-000000001f03', '2026-03-01'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001c02', '27060000-0000-0000-0000-000000001f04', '2026-03-01'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001c04', '27060000-0000-0000-0000-000000001f05', '2026-03-04'),
  ('27060000-0000-0000-0000-00000000010b', '27060000-0000-0000-0000-000000002c01', '27060000-0000-0000-0000-000000002f01', '2026-03-01');
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-01'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001402', '27060000-0000-0000-0000-000000001c04', '2026-03-04');

-- The member-days of crew A over 2-6 March 2026: one person present all five, one present four and on leave one,
-- one absent two, off rotation one, and not recorded on two. Crew A's 15 member-days: 9 present, 2 absent, 1 leave,
-- 1 off rotation, 2 no record.
insert into attendance_days (org_id, worker_id, work_order_id, crew_id, work_date, status, hours, source) values
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f01', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-02', 'present', 8, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f01', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-03', 'present', 8, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f01', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-04', 'present', 8, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f01', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-05', 'present', 8, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f01', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-06', 'present', 8, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f02', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-02', 'present', 8, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f02', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-03', 'present', 8, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f02', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-04', 'present', 8, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f02', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-05', 'present', 8, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f02', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-06', 'leave', null, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f03', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-02', 'absent', null, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f03', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-03', 'absent', null, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f03', '27060000-0000-0000-0000-000000001401', '27060000-0000-0000-0000-000000001c01', '2026-03-04', 'off_rotation', null, 'roster_tick'),
  ('27060000-0000-0000-0000-00000000010a', '27060000-0000-0000-0000-000000001f05', '27060000-0000-0000-0000-000000001402', '27060000-0000-0000-0000-000000001c04', '2026-03-04', 'present', 8, 'roster_tick');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('27060000-0000-0000-0000-0000000001a1');

-- AC-ATR-001: the target is empty until an Admin sets it.
select is((select attendance_target_rate from organizations where id = '27060000-0000-0000-0000-00000000010a'),
  null::numeric, 'AC-ATR-001 the target is empty until an Admin sets it');

-- AC-ATR-003: crew A's member-days and rate; AC-ATR-001: no target yet, so no meets-target answer.
select is((select count(*)::int from attendance_rate_by_crew('2026-03-02', '2026-03-06')), 3,
  'AC-ATR-001 every live crew is listed (crew C is archived and absent)');
select is((select r.expected_days from attendance_rate_by_crew('2026-03-02', '2026-03-06') r where r.crew_code = 'ATR-A'), 15,
  'AC-ATR-003 five rostered days for three people are fifteen expected member-days');
select is((select r.present_days from attendance_rate_by_crew('2026-03-02', '2026-03-06') r where r.crew_code = 'ATR-A'), 9,
  'AC-ATR-003 nine member-days are present');
select is((select r.absent_days from attendance_rate_by_crew('2026-03-02', '2026-03-06') r where r.crew_code = 'ATR-A'), 2,
  'AC-ATR-003 two member-days are absent');
select is((select r.leave_days || '/' || r.off_rotation_days from attendance_rate_by_crew('2026-03-02', '2026-03-06') r
            where r.crew_code = 'ATR-A'), '1/1',
  'AC-ATR-003 leave and off rotation are counted apart');
select is((select r.no_record_days from attendance_rate_by_crew('2026-03-02', '2026-03-06') r where r.crew_code = 'ATR-A'), 2,
  'AC-ATR-003 two member-days have no record');
select is((select r.countable_days from attendance_rate_by_crew('2026-03-02', '2026-03-06') r where r.crew_code = 'ATR-A'), 13,
  'AC-ATR-003 excused days leave the denominator');
select is((select r.rate from attendance_rate_by_crew('2026-03-02', '2026-03-06') r where r.crew_code = 'ATR-A'), 69.23,
  'AC-ATR-003 the rate is present over countable days, to two decimals');
select is((select r.target_rate from attendance_rate_by_crew('2026-03-02', '2026-03-06') r
            where r.crew_code = 'ATR-A'), null::numeric,
  'AC-ATR-001 with no target the report says so');
select is((select r.meets_target from attendance_rate_by_crew('2026-03-02', '2026-03-06') r
            where r.crew_code = 'ATR-A'), null::boolean,
  'AC-ATR-001 with no target no crew is marked');

-- AC-ATR-004: a person's days follow the crew they were placed in; crew D starts on day three.
select is((select r.expected_days || '/' || r.present_days || '/' || r.no_record_days || '/' || r.rate
             from attendance_rate_by_crew('2026-03-02', '2026-03-06') r where r.crew_code = 'ATR-D'),
  '3/1/2/33.33',
  'AC-ATR-004 days are attributed to the crew the person was placed in that day');

-- AC-ATR-005: a crew with no roster in the period has nothing expected, and no rate (not 0 %).
select is((select r.expected_days || '/' || r.countable_days || '/' || coalesce(r.rate::text, '')
             from attendance_rate_by_crew('2026-03-02', '2026-03-06') r where r.crew_code = 'ATR-B'),
  '0/0/',
  'AC-ATR-005 a day with no roster is not expected, and an empty period has no rate');

-- AC-ATR-006: the period is ordered and bounded.
select throws_ok($$ select * from attendance_rate_by_crew('2026-03-06', '2026-03-02') $$,
  '22023', 'ATT_RATE_RANGE: the end date is before the start date',
  'AC-ATR-006 an end before the start is refused');
select throws_ok($$ select * from attendance_rate_by_crew('2025-01-01', '2026-03-02') $$,
  '22023', 'ATT_RATE_RANGE: a period holds at most 366 days',
  'AC-ATR-006 a period longer than 366 days is refused');

-- AC-ATR-002: only an Admin changes the target. The other roles update no row, and the saved value stands.
select is((with changed as (
             update organizations set attendance_target_rate = 75.5
              where id = '27060000-0000-0000-0000-00000000010a' returning id)
           select count(*)::int from changed), 1,
  'AC-ATR-002 an Admin sets the target');
select is((select attendance_target_rate from organizations where id = '27060000-0000-0000-0000-00000000010a'), 75.5,
  'AC-ATR-002 the Admin''s value is saved');
select pg_temp.act_as('27060000-0000-0000-0000-0000000001a2');
select is((with changed as (
             update organizations set attendance_target_rate = 10
              where id = '27060000-0000-0000-0000-00000000010a' returning id)
           select count(*)::int from changed), 0,
  'AC-ATR-002 a Project Manager changes no target row');
select pg_temp.act_as('27060000-0000-0000-0000-0000000001a3');
select is((with changed as (
             update organizations set attendance_target_rate = 10
              where id = '27060000-0000-0000-0000-00000000010a' returning id)
           select count(*)::int from changed), 0,
  'AC-ATR-002 a Finance user changes no target row');
select pg_temp.act_as('27060000-0000-0000-0000-0000000001a4');
select is((with changed as (
             update organizations set attendance_target_rate = 10
              where id = '27060000-0000-0000-0000-00000000010a' returning id)
           select count(*)::int from changed), 0,
  'AC-ATR-002 an Engineer changes no target row');

select pg_temp.act_as('27060000-0000-0000-0000-0000000001a1');
select is((select attendance_target_rate from organizations where id = '27060000-0000-0000-0000-00000000010a'), 75.5,
  'AC-ATR-002 the target is still the Admin''s value');
select is((select r.meets_target from attendance_rate_by_crew('2026-03-02', '2026-03-06') r where r.crew_code = 'ATR-A'),
  false, 'AC-ATR-002 a crew under the target is reported under it');
select is((with changed as (
             update organizations set attendance_target_rate = 60
              where id = '27060000-0000-0000-0000-00000000010a' returning id)
           select count(*)::int from changed), 1,
  'AC-ATR-002 the Admin lowers the target');
select is((select r.meets_target from attendance_rate_by_crew('2026-03-02', '2026-03-06') r where r.crew_code = 'ATR-A'),
  true, 'AC-ATR-002 a crew at or over the target is reported over it');

-- AC-ATR-007: the reading roles, and nothing across organisations.
select pg_temp.act_as('27060000-0000-0000-0000-0000000001a4');
select throws_ok($$ select * from attendance_rate_by_crew('2026-03-02', '2026-03-06') $$,
  '42501', null, 'AC-ATR-007 an Engineer who does not read the whole attendance is refused');
select pg_temp.act_as('27060000-0000-0000-0000-0000000001a5');
select is((select count(*)::int from attendance_rate_by_crew('2026-03-02', '2026-03-06')), 3,
  'AC-ATR-007 an Executive reads the report');
select pg_temp.act_as('27060000-0000-0000-0000-0000000001a2');
select is((select count(*)::int from attendance_rate_by_crew('2026-03-02', '2026-03-06')), 3,
  'AC-ATR-007 a Project Manager reads the report');
select pg_temp.act_as('27060000-0000-0000-0000-0000000001a3');
select is((select count(*)::int from attendance_rate_by_crew('2026-03-02', '2026-03-06')), 3,
  'AC-ATR-007 a Finance user reads the report');
select pg_temp.act_as('27060000-0000-0000-0000-0000000001b1');
select is((select array_agg(r.crew_code order by r.crew_code) from attendance_rate_by_crew('2026-03-02', '2026-03-06') r),
  array['ATR-X'], 'AC-ATR-007 another organisation reads only its own crew');

select * from finish();
rollback;
