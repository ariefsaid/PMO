-- 0026_timesheet_manager_read_anon.test.sql
-- AC-910: Manager read path (FR-TS-008 RLS-select fix) + anon-revoke (FR-TS-009).
-- Engineer-role manager M can SELECT their report's timesheet (manager-of clause in timesheets_select).
-- Non-manager Engineer N cannot see another user's timesheet (own-row only).
-- Anon role cannot execute transition_timesheet (anon-revoke).
begin;
select plan(3);

-- Fixtures: one org, three users.
-- X (Engineer, report — owner of the Submitted timesheet).
-- M (Engineer-role manager — manager_id of X; NOT in the privileged-read set).
-- N (Engineer — manages no one, not in privileged set; should see own rows only).
insert into organizations (id, name) values
  ('00260000-0000-0000-0000-000000000001','TS Manager Read Org');

insert into auth.users (id, email) values
  ('00260000-0000-0000-0000-0000000000a1','ts-report-x2@example.com'),
  ('00260000-0000-0000-0000-0000000000a2','ts-eng-mgr-m2@example.com'),
  ('00260000-0000-0000-0000-0000000000a3','ts-eng-n2@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00260000-0000-0000-0000-0000000000a1','00260000-0000-0000-0000-000000000001','Report X2','ts-report-x2@example.com','Engineer'),
  ('00260000-0000-0000-0000-0000000000a2','00260000-0000-0000-0000-000000000001','Eng Mgr M2','ts-eng-mgr-m2@example.com','Engineer'),
  ('00260000-0000-0000-0000-0000000000a3','00260000-0000-0000-0000-000000000001','Engineer N2','ts-eng-n2@example.com','Engineer');

-- X's manager_id = M (Engineer-role manager).
update profiles set manager_id = '00260000-0000-0000-0000-0000000000a2'
  where id = '00260000-0000-0000-0000-0000000000a1';

-- X's Submitted timesheet.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00260000-0000-0000-0000-000000000010','00260000-0000-0000-0000-000000000001',
   '00260000-0000-0000-0000-0000000000a1','2026-06-01','Submitted');

-- ── Test 1: Engineer-role manager M can SELECT X's timesheet (FR-TS-008 manager-of clause) ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"00260000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select count(*)::int from timesheets where user_id = '00260000-0000-0000-0000-0000000000a1'),
  1,
  'AC-910: Engineer-role manager can SELECT report''s timesheet (FR-TS-008 manager read path)');

reset role;

-- ── Test 2: non-manager Engineer N cannot see X's timesheet (own-row only) ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"00260000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select is(
  (select count(*)::int from timesheets where user_id = '00260000-0000-0000-0000-0000000000a1'),
  0,
  'AC-910: non-manager Engineer cannot see another user''s timesheet (own-row only)');

reset role;

-- ── Test 3: anon role cannot execute transition_timesheet (anon-revoke, FR-TS-009) ─
set local role anon;

select throws_ok(
  $$ select transition_timesheet('00260000-0000-0000-0000-000000000010','Approved') $$,
  '42501', null,
  'AC-910: anon cannot execute transition_timesheet (anon-revoke)');

reset role;
select * from finish();
rollback;
