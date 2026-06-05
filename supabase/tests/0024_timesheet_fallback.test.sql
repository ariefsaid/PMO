-- 0024_timesheet_fallback.test.sql
-- AC-908: Admin/Executive fallback when owner's manager_id is null; fallback is exclusive
-- (an Exec who is NOT the assigned manager is blocked when a non-null manager_id exists);
-- Admin break-glass always passes (SoD satisfied — Admin ≠ owner).
begin;
select plan(4);

-- Fixtures: one org, four users.
-- W (Engineer, no manager assigned — exercises Exec/Admin fallback path).
-- V (Engineer, manager = M — proves fallback is exclusive: Exec who is NOT M is blocked).
-- E (Executive — tests fallback approve on W; tests blocked on V).
-- A (Admin — break-glass; tests approve on W; SoD satisfied because A ≠ W/V).
insert into organizations (id, name) values
  ('00240000-0000-0000-0000-000000000001','TS Fallback Org');

-- X (Engineer — a NON-privileged bystander; not the owner, not the manager, not Admin/Exec).
insert into auth.users (id, email) values
  ('00240000-0000-0000-0000-0000000000a1','ts-owner-w@example.com'),
  ('00240000-0000-0000-0000-0000000000a2','ts-exec-e@example.com'),
  ('00240000-0000-0000-0000-0000000000a3','ts-admin-a@example.com'),
  ('00240000-0000-0000-0000-0000000000a4','ts-owner-v@example.com'),
  ('00240000-0000-0000-0000-0000000000a5','ts-mgr-m@example.com'),
  ('00240000-0000-0000-0000-0000000000a6','ts-eng-x@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00240000-0000-0000-0000-0000000000a1','00240000-0000-0000-0000-000000000001','Owner W (no mgr)','ts-owner-w@example.com','Engineer'),
  ('00240000-0000-0000-0000-0000000000a2','00240000-0000-0000-0000-000000000001','Exec E','ts-exec-e@example.com','Executive'),
  ('00240000-0000-0000-0000-0000000000a3','00240000-0000-0000-0000-000000000001','Admin A','ts-admin-a@example.com','Admin'),
  ('00240000-0000-0000-0000-0000000000a4','00240000-0000-0000-0000-000000000001','Owner V (has mgr)','ts-owner-v@example.com','Engineer'),
  ('00240000-0000-0000-0000-0000000000a5','00240000-0000-0000-0000-000000000001','Manager M','ts-mgr-m@example.com','Project Manager'),
  ('00240000-0000-0000-0000-0000000000a6','00240000-0000-0000-0000-000000000001','Engineer X','ts-eng-x@example.com','Engineer');

-- W: manager_id is null (fallback path applies).
-- V: manager_id = M (fallback exclusive — Exec E who is NOT M should be blocked).
update profiles set manager_id = '00240000-0000-0000-0000-0000000000a5'
  where id = '00240000-0000-0000-0000-0000000000a4';

-- W's Submitted timesheet.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00240000-0000-0000-0000-000000000010','00240000-0000-0000-0000-000000000001',
   '00240000-0000-0000-0000-0000000000a1','2026-06-01','Submitted');

-- V's Submitted timesheet.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00240000-0000-0000-0000-000000000011','00240000-0000-0000-0000-000000000001',
   '00240000-0000-0000-0000-0000000000a4','2026-06-08','Submitted');

-- ── Test 1: Executive E approves W's sheet (manager_id is null → fallback applies) ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"00240000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select transition_timesheet('00240000-0000-0000-0000-000000000010','Approved') $$,
  'AC-908: Exec fallback approves when manager_id is null');

reset role;

-- ── Test 2: Executive E (not M) cannot approve V's sheet (V has manager_id = M) ──
-- Fallback is exclusive: when manager_id is non-null, only that manager (or Admin) may approve.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00240000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ select transition_timesheet('00240000-0000-0000-0000-000000000011','Approved') $$,
  '42501', null,
  'AC-908: Exec cannot approve when an assigned manager exists (fallback exclusive)');

reset role;

-- Reset W's sheet to Submitted for the Admin break-glass test.
update timesheets set status = 'Submitted', approved_by = null, approved_at = null
  where id = '00240000-0000-0000-0000-000000000010';

-- ── Test 3: Admin A (break-glass, not the owner) approves W's sheet ────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00240000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ select transition_timesheet('00240000-0000-0000-0000-000000000010','Approved') $$,
  'AC-908: Admin break-glass approves (SoD satisfied: A ≠ W)');

reset role;

-- Reset W's sheet to Submitted for the HIGH-TS-1 null-fall-through guard test.
update timesheets set status = 'Submitted', approved_by = null, approved_at = null
  where id = '00240000-0000-0000-0000-000000000010';

-- ── Test 4 (HIGH-TS-1): a NON-privileged bystander (Engineer X, not owner/mgr/Admin/Exec) ──
-- cannot approve W's null-manager sheet. Before the null-safe fix, `v_uid = v_mgr` was NULL
-- and `not(NULL or false or false)` is NULL → the guard was skipped and ANY org member could
-- approve a null-manager owner's sheet. Must raise 42501.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00240000-0000-0000-0000-0000000000a6","role":"authenticated"}';

select throws_ok(
  $$ select transition_timesheet('00240000-0000-0000-0000-000000000010','Approved') $$,
  '42501', null,
  'HIGH-TS-1: a non-privileged bystander cannot approve a null-manager owner''s sheet');

reset role;
select * from finish();
rollback;
