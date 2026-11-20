-- dsr_report_hours.test.sql — #2619 (daily-site-report FR-DSR-006/007, crews-roster-attendance FR-CRW-016).
-- Migration under test: 1111_dsr_report_hours.sql. An Engineer opening a report sees the whole crew's hours for the
-- work order and date (timesheet lines + attendance not yet on a timesheet) and the equipment usage of others;
-- another organisation sees nothing.
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26190000-0000-0000-0000-0000000000a1', 'RH Org A', 'IDR', 'UTC'),
  ('26190000-0000-0000-0000-0000000000a2', 'RH Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26190000-0000-0000-0000-0000000000b1', 'rh-eng@example.com'),
  ('26190000-0000-0000-0000-0000000000b2', 'rh-crew@example.com'),
  ('26190000-0000-0000-0000-0000000000b5', 'rh-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26190000-0000-0000-0000-0000000000b1', '26190000-0000-0000-0000-0000000000a1', 'RH Engineer', 'rh-eng@example.com', 'Engineer', 'active'),
  ('26190000-0000-0000-0000-0000000000b2', '26190000-0000-0000-0000-0000000000a1', 'RH Crew', 'rh-crew@example.com', 'Engineer', 'active'),
  ('26190000-0000-0000-0000-0000000000b5', '26190000-0000-0000-0000-0000000000a2', 'RH Foreign', 'rh-foreign@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status) values
  ('26190000-0000-0000-0000-0000000000c1', '26190000-0000-0000-0000-0000000000a1', 'RH Site', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26190000-0000-0000-0000-0000000000e1', '26190000-0000-0000-0000-0000000000a1', '26190000-0000-0000-0000-0000000000c1', 'RH WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('26190000-0000-0000-0000-000000001c01', '26190000-0000-0000-0000-0000000000a1', 'RH-A', 'Crew', '26190000-0000-0000-0000-0000000000b1');
insert into people (id, org_id, kind, name, profile_id) values
  ('26190000-0000-0000-0000-000000001f01', '26190000-0000-0000-0000-0000000000a1', 'vendor', 'RH Vendor One', null),
  ('26190000-0000-0000-0000-000000001f02', '26190000-0000-0000-0000-0000000000a1', 'vendor', 'RH Vendor Two', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('26190000-0000-0000-0000-0000000000a1', '26190000-0000-0000-0000-000000001c01', '26190000-0000-0000-0000-000000001f01', current_date - 30),
  ('26190000-0000-0000-0000-0000000000a1', '26190000-0000-0000-0000-000000001c01', '26190000-0000-0000-0000-000000001f02', current_date - 30);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('26190000-0000-0000-0000-0000000000a1', '26190000-0000-0000-0000-0000000000e1', '26190000-0000-0000-0000-000000001c01', current_date - 30);
-- The crew colleague's own timesheet line (4 h) and the colleague's equipment usage: rows the Engineer's table rules hide.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('26190000-0000-0000-0000-000000002a01', '26190000-0000-0000-0000-0000000000a1', '26190000-0000-0000-0000-0000000000b2',
   date_trunc('week', current_date::timestamp)::date, 'Draft');
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours, work_order_id) values
  ('26190000-0000-0000-0000-0000000000a1', '26190000-0000-0000-0000-000000002a01', '26190000-0000-0000-0000-0000000000c1', current_date, 4,
   '26190000-0000-0000-0000-0000000000e1');
insert into equipment_assets (id, org_id, code, name) values
  ('26190000-0000-0000-0000-000000003a01', '26190000-0000-0000-0000-0000000000a1', 'RH-EX1', 'RH Excavator');
insert into equipment_usage_entries (org_id, asset_id, project_id, work_order_id, work_date, quantity, unit, author_id) values
  ('26190000-0000-0000-0000-0000000000a1', '26190000-0000-0000-0000-000000003a01', '26190000-0000-0000-0000-0000000000c1',
   '26190000-0000-0000-0000-0000000000e1', current_date, 6.5, 'hours', '26190000-0000-0000-0000-0000000000b2');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"26190000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- The field controller ticks vendor one present 6 h + 2 overtime and vendor two absent: attendance with no timesheet line.
select is(attendance_record('26190000-0000-0000-0000-0000000000e1', current_date, 'roster_tick',
  '[{"worker_id": "26190000-0000-0000-0000-000000001f01", "status": "present", "hours": 6, "overtime_hours": 2},
    {"worker_id": "26190000-0000-0000-0000-000000001f02", "status": "absent"}]'::jsonb), 2, 'two attendance records are written');
insert into ids select 'r1', public.dsr_save_draft(jsonb_build_object(
  'work_order_id', '26190000-0000-0000-0000-0000000000e1', 'work_date', current_date));

-- The Engineer cannot read the colleague's rows directly (the reason for the RPC) ...
select is((select count(*)::int from timesheet_entries), 0, 'the Engineer''s own table rules hide the colleague''s timesheet line');
-- ... yet the report shows the crew total: 4 (timesheet) + 6 + 2 (attendance); the absent person adds nothing.
select is((public.dsr_report_hours((select v from ids where k = 'r1'))->>'people_hours')::numeric, 12::numeric,
  'FR-DSR-007 people hours = timesheet lines + attendance not yet on a timesheet, whole crew');
select is(jsonb_array_length(public.dsr_report_hours((select v from ids where k = 'r1'))->'equipment'), 1,
  'FR-DSR-006 the colleague''s equipment usage is listed for the Engineer');
select is((public.dsr_report_hours((select v from ids where k = 'r1'))->'equipment'->0->>'asset_name'), 'RH Excavator',
  'FR-DSR-006 the entry names its machine');

-- Read-only: calling it creates no hours.
reset role;
select is((select count(*)::int from timesheet_entries) + (select count(*)::int from attendance_days where timesheet_entry_id is not null), 1,
  'reading the hours created no timesheet line');

-- Another organisation sees nothing; an unknown report reads as absent.
set local role authenticated;
set local request.jwt.claims = '{"sub":"26190000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($$ select public.dsr_report_hours((select v from ids where k = 'r1')) $$, 'P0002', 'report not found',
  'another organisation cannot read the hours of this report');
select throws_ok($$ select public.dsr_report_hours('26190000-0000-0000-0000-0000000000ff') $$, 'P0002', 'report not found',
  'an unknown report reads as absent');

select * from finish();
rollback;
