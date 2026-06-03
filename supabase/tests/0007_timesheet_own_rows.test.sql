begin;
select plan(4);

insert into organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Org A');

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a1','pm@example.com'),
  ('a0000000-0000-0000-0000-0000000000e1','eng@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','PM A','pm@example.com','Project Manager'),
  ('a0000000-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-000000000001','Eng A','eng@example.com','Engineer');

insert into projects (id, org_id, name, status) values
  ('a1111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Project A1','Ongoing Project');

-- PM timesheet (10.0h across 2 entries) + Engineer timesheet (16.0h across 2 entries).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('a6666666-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a1','2026-06-01','Submitted'),
  ('a6666666-0000-0000-0000-00000000000e','aaaaaaaa-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000e1','2026-06-01','Draft');

insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('a7777777-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','a6666666-0000-0000-0000-00000000000a','a1111111-0000-0000-0000-000000000001','2026-06-01',6),
  ('a7777777-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000001','a6666666-0000-0000-0000-00000000000a','a1111111-0000-0000-0000-000000000001','2026-06-02',4),
  ('a7777777-0000-0000-0000-00000000000e','aaaaaaaa-0000-0000-0000-000000000001','a6666666-0000-0000-0000-00000000000e','a1111111-0000-0000-0000-000000000001','2026-06-01',8),
  ('a7777777-0000-0000-0000-00000000000f','aaaaaaaa-0000-0000-0000-000000000001','a6666666-0000-0000-0000-00000000000e','a1111111-0000-0000-0000-000000000001','2026-06-02',8);

-- Become the Engineer.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- AC-603: Engineer sees only their own timesheet (not the PM's).
select is(
  (select count(*)::int from timesheets), 1,
  'AC-603: Engineer sees only their own timesheet row');
-- AC-603: and only their own entries (sum = 16.0, never the PM total 10.0).
select is(
  (select coalesce(sum(hours),0)::numeric from timesheet_entries), 16.0,
  'AC-603: Engineer sees only their own 16.0h of entries');

reset role;
-- Become the PM (a manager role): timesheets_select grants managers read of others'' rows.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Manager sees both timesheets (own + Engineer's).
select is(
  (select count(*)::int from timesheets), 2,
  'AC-603: a manager (PM) reads both own and the Engineer timesheet');
-- Manager sees all entries (26.0h total).
select is(
  (select coalesce(sum(hours),0)::numeric from timesheet_entries), 26.0,
  'AC-603: a manager (PM) reads all org timesheet entries');

reset role;
select * from finish();
rollback;
