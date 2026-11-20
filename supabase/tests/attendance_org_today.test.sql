-- attendance_org_today.test.sql — #2617 (docs/specs/crews-roster-attendance.spec.md FR-CRW-013).
-- Migration under test: 1110_field_org_today.sql. "Today" for the future and back-date checks is the organisation's
-- local date. The two zones below are 26 hours apart, so at any instant at least one of them has a local date that
-- differs from the database date: code that compares against the database date fails one of the two blocks.
begin;
create extension if not exists pgtap;
select plan(12);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26170000-0000-0000-0000-00000000010a', 'OT Org', 'IDR', 'Pacific/Kiritimati');
insert into auth.users (id, email) values ('26170000-0000-0000-0000-0000000001a4', 'ot-fc@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26170000-0000-0000-0000-0000000001a4', '26170000-0000-0000-0000-00000000010a', 'OT FC', 'ot-fc@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status) values
  ('26170000-0000-0000-0000-0000000001d1', '26170000-0000-0000-0000-00000000010a', 'OT Site', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26170000-0000-0000-0000-000000001401', '26170000-0000-0000-0000-00000000010a', '26170000-0000-0000-0000-0000000001d1', 'OT WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('26170000-0000-0000-0000-000000001c01', '26170000-0000-0000-0000-00000000010a', 'OT-A', 'Crew', '26170000-0000-0000-0000-0000000001a4');
insert into people (id, org_id, kind, name, profile_id) values
  ('26170000-0000-0000-0000-000000001f01', '26170000-0000-0000-0000-00000000010a', 'vendor', 'OT Vendor', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('26170000-0000-0000-0000-00000000010a', '26170000-0000-0000-0000-000000001c01', '26170000-0000-0000-0000-000000001f01', current_date - 60);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('26170000-0000-0000-0000-00000000010a', '26170000-0000-0000-0000-000000001401', '26170000-0000-0000-0000-000000001c01', current_date - 60);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create temp table ot_args (k text primary key, d date);
grant select on ot_args to authenticated;
create or replace function pg_temp.d(p text) returns date language sql stable as $$ select d from ot_args where k = p $$;
create or replace function pg_temp.rec(p_date date) returns integer language sql as $$
  select attendance_record('26170000-0000-0000-0000-000000001401', p_date, 'roster_tick',
    '[{"worker_id": "26170000-0000-0000-0000-000000001f01", "status": "present", "hours": 8}]'::jsonb)
$$;
grant execute on function pg_temp.rec(date) to authenticated;
-- Set the zone and the local dates for the next block (run as the table owner).
create or replace function pg_temp.use_zone(p_tz text) returns void language plpgsql as $$
begin
  update organizations set default_timezone = p_tz where id = '26170000-0000-0000-0000-00000000010a';
  delete from ot_args;
  insert into ot_args select 'today', public.equipment_org_today('26170000-0000-0000-0000-00000000010a');
  insert into ot_args select 'future', d + 1 from ot_args where k = 'today';
  insert into ot_args select 'earliest', d - 7 from ot_args where k = 'today';
  insert into ot_args select 'too_old', d - 8 from ot_args where k = 'today';
end $$;

-- Zone A: far ahead of UTC.
select pg_temp.use_zone('Pacific/Kiritimati');
set local role authenticated;
select pg_temp.act_as('26170000-0000-0000-0000-0000000001a4');
select is(pg_temp.rec(pg_temp.d('today')), 1, '#2617 the organisation''s local today is accepted (zone ahead of the database date)');
select throws_ok($$ select pg_temp.rec(pg_temp.d('future')) $$, '23514', 'ATT_DATE_FUTURE: attendance cannot be recorded for a future date',
  '#2617 the organisation''s local tomorrow is refused (zone ahead)');
select is(pg_temp.rec(pg_temp.d('earliest')), 1, '#2617 the back-date window edge (7 days before local today) is accepted (zone ahead)');
select throws_ok($$ select pg_temp.rec(pg_temp.d('too_old')) $$, '23514', null,
  '#2617 one day beyond the window is refused (zone ahead)');

-- Zone B: far behind UTC.
reset role;
select pg_temp.use_zone('Etc/GMT+12');
set local role authenticated;
select pg_temp.act_as('26170000-0000-0000-0000-0000000001a4');
select is(pg_temp.rec(pg_temp.d('today')), 1, '#2617 the organisation''s local today is accepted (zone behind the database date)');
select throws_ok($$ select pg_temp.rec(pg_temp.d('future')) $$, '23514', 'ATT_DATE_FUTURE: attendance cannot be recorded for a future date',
  '#2617 the organisation''s local tomorrow is refused (zone behind)');
select is(pg_temp.rec(pg_temp.d('earliest')), 1, '#2617 the back-date window edge is accepted (zone behind)');
select throws_ok($$ select pg_temp.rec(pg_temp.d('too_old')) $$, '23514', null,
  '#2617 one day beyond the window is refused (zone behind)');
reset role;

-- The validation queue age is measured from the organisation's local date too.
select is(pg_get_functiondef('public.dsr_validation_queue()'::regprocedure) ~* 'current_date', false,
  '#2617 the validation queue age does not read the database date');
select is(pg_get_functiondef('public.dsr_validation_queue()'::regprocedure) ~ 'equipment_org_today', true,
  '#2617 the validation queue age reads the organisation''s local date');
select is(pg_get_functiondef('public.attendance_record(uuid,date,text,jsonb)'::regprocedure) ~* 'current_date', false,
  '#2617 attendance recording does not read the database date');

select * from finish();
rollback;
