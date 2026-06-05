-- 0022_timesheet_submit_gate.test.sql
-- AC-906: Submit gate — owner may submit their own Draft sheet; non-owner (even a manager) cannot.
-- Also verifies submitted_at is stamped atomically (NFR-TS-ATOM-001).
begin;
select plan(4);

-- Fixtures: one org, two users (owner X and manager M), one Draft timesheet owned by X.
insert into organizations (id, name) values
  ('00220000-0000-0000-0000-000000000001','TS Submit Gate Org');

insert into auth.users (id, email) values
  ('00220000-0000-0000-0000-0000000000a1','ts-owner-x@example.com'),
  ('00220000-0000-0000-0000-0000000000a2','ts-mgr-m@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00220000-0000-0000-0000-0000000000a1','00220000-0000-0000-0000-000000000001','Owner X','ts-owner-x@example.com','Engineer'),
  ('00220000-0000-0000-0000-0000000000a2','00220000-0000-0000-0000-000000000001','Manager M','ts-mgr-m@example.com','Project Manager');

-- X's manager_id = M (so M is a valid approver, but NOT a valid submitter).
update profiles set manager_id = '00220000-0000-0000-0000-0000000000a2'
  where id = '00220000-0000-0000-0000-0000000000a1';

-- X's Draft timesheet.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00220000-0000-0000-0000-000000000010','00220000-0000-0000-0000-000000000001',
   '00220000-0000-0000-0000-0000000000a1','2026-06-01','Draft');

-- ── Test 1: owner X can submit their own Draft sheet ────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00220000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select transition_timesheet('00220000-0000-0000-0000-000000000010','Submitted') $$,
  'AC-906: owner can Submit own Draft timesheet');

-- ── Test 2: submitted_at is stamped atomically (NFR-TS-ATOM-001) ───────────
select is(
  (select submitted_at is not null from timesheets where id = '00220000-0000-0000-0000-000000000010'),
  true,
  'AC-906: submitted_at stamped atomically on Submitted transition');

reset role;

-- Reset to Draft for the non-owner test (bypass RLS as table owner).
update timesheets set status = 'Draft', submitted_at = null
  where id = '00220000-0000-0000-0000-000000000010';

-- ── Test 3: manager M (non-owner) cannot submit X's Draft sheet → 42501 ────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00220000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ select transition_timesheet('00220000-0000-0000-0000-000000000010','Submitted') $$,
  '42501', null,
  'AC-906: non-owner cannot Submit (even if they are the assigned manager)');

reset role;

-- ── Test 4: verify sheet status is still Draft after the blocked attempt ───
select is(
  (select status::text from timesheets where id = '00220000-0000-0000-0000-000000000010'),
  'Draft',
  'AC-906: timesheet remains Draft after blocked non-owner submit attempt');

select * from finish();
rollback;
