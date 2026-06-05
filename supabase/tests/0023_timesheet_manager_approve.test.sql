-- 0023_timesheet_manager_approve.test.sql
-- AC-907: Line-manager approval — the assigned manager (even Engineer-role) can approve a report's
-- Submitted sheet; a non-manager non-privileged user is blocked (42501).
-- Also verifies approved_by + approved_at are stamped atomically (NFR-TS-ATOM-001).
begin;
select plan(4);

-- Fixtures: one org, three users.
-- X (Engineer, the report), M (Engineer-role manager — proves the path does NOT require a
-- privileged role), N (different Engineer who manages no one).
insert into organizations (id, name) values
  ('00230000-0000-0000-0000-000000000001','TS Manager Approve Org');

insert into auth.users (id, email) values
  ('00230000-0000-0000-0000-0000000000a1','ts-report-x@example.com'),
  ('00230000-0000-0000-0000-0000000000a2','ts-eng-mgr-m@example.com'),
  ('00230000-0000-0000-0000-0000000000a3','ts-eng-n@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00230000-0000-0000-0000-0000000000a1','00230000-0000-0000-0000-000000000001','Report X','ts-report-x@example.com','Engineer'),
  ('00230000-0000-0000-0000-0000000000a2','00230000-0000-0000-0000-000000000001','Eng Manager M','ts-eng-mgr-m@example.com','Engineer'),
  ('00230000-0000-0000-0000-0000000000a3','00230000-0000-0000-0000-000000000001','Engineer N','ts-eng-n@example.com','Engineer');

-- X's manager_id = M (an Engineer-role manager — tests manager path without privileged role).
-- N has no manager_id assignment (manages no one, also not managed by M here).
update profiles set manager_id = '00230000-0000-0000-0000-0000000000a2'
  where id = '00230000-0000-0000-0000-0000000000a1';

-- X's Submitted timesheet.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00230000-0000-0000-0000-000000000010','00230000-0000-0000-0000-000000000001',
   '00230000-0000-0000-0000-0000000000a1','2026-06-01','Submitted');

-- ── Test 1: Engineer-role manager M approves X's Submitted sheet → lives_ok ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"00230000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select transition_timesheet('00230000-0000-0000-0000-000000000010','Approved') $$,
  'AC-907: line manager (Engineer-role) approves report''s timesheet');

-- ── Test 2: approved_by = M after approval (NFR-TS-ATOM-001 + FR-TS-005) ───
select is(
  (select approved_by from timesheets where id = '00230000-0000-0000-0000-000000000010'),
  '00230000-0000-0000-0000-0000000000a2'::uuid,
  'AC-907: approved_by = manager M after Approved transition');

-- ── Test 3: approved_at is stamped atomically ───────────────────────────────
select is(
  (select approved_at is not null from timesheets where id = '00230000-0000-0000-0000-000000000010'),
  true,
  'AC-907: approved_at stamped atomically on Approved transition');

reset role;

-- Reset to Submitted for the non-manager test.
update timesheets set status = 'Submitted', approved_by = null, approved_at = null
  where id = '00230000-0000-0000-0000-000000000010';

-- ── Test 4: non-manager Engineer N (manages no one) cannot approve → 42501 ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"00230000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select throws_ok(
  $$ select transition_timesheet('00230000-0000-0000-0000-000000000010','Approved') $$,
  '42501', null,
  'AC-907: non-manager Engineer cannot Approve (42501)');

reset role;
select * from finish();
rollback;
