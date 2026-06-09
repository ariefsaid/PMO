-- 0055_authz_hardening.test.sql — AC-AUTHZ-001..010: procurement SoD applies to Admin
-- + GR-creation role tightening + Finance timesheet-entry RLS role gate (migration 0018).
--
-- AC-AUTHZ-001  Admin who IS the requester → transition to Approved raises 42501 (SoD-a applies to Admin).
-- AC-AUTHZ-002  Admin who IS the requester → transition to Rejected raises 42501 (SoD-a applies to Admin).
-- AC-AUTHZ-003  Admin who IS the approver → transition to Paid raises 42501 (SoD-b applies to Admin).
-- AC-AUTHZ-004  Admin who is NOT requester/approver → Approve succeeds (break-glass role override intact).
-- AC-AUTHZ-005  Finance → create_procurement_receipt raises 42501 (GR grant tightened — no longer in set).
-- AC-AUTHZ-006  PM → create_procurement_receipt ok (PM is in the new grant set).
-- AC-AUTHZ-007  Engineer who IS the requester → create_procurement_receipt ok (requester allowed).
-- AC-AUTHZ-008  Engineer who is NOT the requester → create_procurement_receipt raises 42501.
-- AC-AUTHZ-009  Finance → INSERT own-Draft timesheet_entries raises 42501 (Finance excluded from role gate).
-- AC-AUTHZ-010  Engineer → INSERT own-Draft timesheet_entries ok (Engineering is in the role gate).
begin;
select plan(10);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures (inserted as table owner, bypassing RLS)
-- All IDs under the 00550000-… namespace to avoid collisions with other suites.
-- ════════════════════════════════════════════════════════════════════════════

insert into organizations (id, name) values
  ('00550000-0000-0000-0000-000000000001', 'Authz Hardening Org');

insert into auth.users (id, email) values
  ('00550000-0000-0000-0000-0000000000a1', 'authz-admin@example.com'),    -- Admin (requester in proc-1)
  ('00550000-0000-0000-0000-0000000000a2', 'authz-admin2@example.com'),   -- Admin (approver in proc-2, 3rd-party in proc-3)
  ('00550000-0000-0000-0000-0000000000a3', 'authz-pm@example.com'),       -- PM
  ('00550000-0000-0000-0000-0000000000a4', 'authz-fin@example.com'),      -- Finance
  ('00550000-0000-0000-0000-0000000000a5', 'authz-eng-req@example.com'),  -- Engineer who IS the requester
  ('00550000-0000-0000-0000-0000000000a6', 'authz-eng-noreq@example.com'),-- Engineer who is NOT the requester
  ('00550000-0000-0000-0000-0000000000a7', 'authz-eng-ts@example.com');   -- Engineer for timesheet test

insert into profiles (id, org_id, full_name, email, role) values
  ('00550000-0000-0000-0000-0000000000a1', '00550000-0000-0000-0000-000000000001', 'Authz Admin',     'authz-admin@example.com',     'Admin'),
  ('00550000-0000-0000-0000-0000000000a2', '00550000-0000-0000-0000-000000000001', 'Authz Admin2',    'authz-admin2@example.com',    'Admin'),
  ('00550000-0000-0000-0000-0000000000a3', '00550000-0000-0000-0000-000000000001', 'Authz PM',        'authz-pm@example.com',        'Project Manager'),
  ('00550000-0000-0000-0000-0000000000a4', '00550000-0000-0000-0000-000000000001', 'Authz Finance',   'authz-fin@example.com',       'Finance'),
  ('00550000-0000-0000-0000-0000000000a5', '00550000-0000-0000-0000-000000000001', 'Authz Eng Req',   'authz-eng-req@example.com',   'Engineer'),
  ('00550000-0000-0000-0000-0000000000a6', '00550000-0000-0000-0000-000000000001', 'Authz Eng NoReq', 'authz-eng-noreq@example.com', 'Engineer'),
  ('00550000-0000-0000-0000-0000000000a7', '00550000-0000-0000-0000-000000000001', 'Authz Eng TS',    'authz-eng-ts@example.com',    'Engineer');

-- proc-1: Requested, requested_by = Admin (a1) → SoD-a test (a1 may not Approve/Reject self)
insert into procurements (id, org_id, title, status, total_value, requested_by_id) values
  ('00550000-0000-0000-0000-000000000010', '00550000-0000-0000-0000-000000000001',
   'Authz Proc SoD-a', 'Requested', 1000, '00550000-0000-0000-0000-0000000000a1');

-- proc-2: Vendor Invoiced, requested_by = a3 (PM), approved_by = Admin (a2) → SoD-b test (a2 may not Pay)
insert into procurements (id, org_id, title, status, total_value, requested_by_id, approved_by_id) values
  ('00550000-0000-0000-0000-000000000011', '00550000-0000-0000-0000-000000000001',
   'Authz Proc SoD-b', 'Vendor Invoiced', 2000,
   '00550000-0000-0000-0000-0000000000a3', '00550000-0000-0000-0000-0000000000a2');

-- proc-3: Requested, requested_by = a4 (Finance) → break-glass test (Admin a2 may Approve)
insert into procurements (id, org_id, title, status, total_value, requested_by_id) values
  ('00550000-0000-0000-0000-000000000012', '00550000-0000-0000-0000-000000000001',
   'Authz Proc Break-glass', 'Requested', 3000, '00550000-0000-0000-0000-0000000000a4');

-- proc-4: Ordered, requested_by = Engineer a5 → GR tests (PM ok, Fin denied, eng-req ok, eng-noreq denied)
insert into procurements (id, org_id, title, status, total_value, requested_by_id) values
  ('00550000-0000-0000-0000-000000000013', '00550000-0000-0000-0000-000000000001',
   'Authz Proc GR', 'Ordered', 500, '00550000-0000-0000-0000-0000000000a5');

-- timesheet + project for the Finance/Engineer entry tests
insert into projects (id, org_id, name, status) values
  ('00550000-0000-0000-0000-000000000020', '00550000-0000-0000-0000-000000000001',
   'Authz TS Project', 'Ongoing Project');

insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00550000-0000-0000-0000-0000000000f1', '00550000-0000-0000-0000-000000000001',
   '00550000-0000-0000-0000-0000000000a4', '2026-06-08', 'Draft'),   -- Finance Draft sheet
  ('00550000-0000-0000-0000-0000000000e1', '00550000-0000-0000-0000-000000000001',
   '00550000-0000-0000-0000-0000000000a7', '2026-06-08', 'Draft');   -- Engineer Draft sheet

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUTHZ-001 / AC-AUTHZ-002: Admin who IS the requester cannot Approve or Reject
-- (SoD-a checks run OUTSIDE the if-not-admin block in migration 0018).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00550000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select transition_procurement('00550000-0000-0000-0000-000000000010','Approved') $$,
  '42501', null,
  'AC-AUTHZ-001: Admin who is the requester cannot Approve their own procurement (SoD-a → 42501)');

select throws_ok(
  $$ select transition_procurement('00550000-0000-0000-0000-000000000010','Rejected') $$,
  '42501', null,
  'AC-AUTHZ-002: Admin who is the requester cannot Reject their own procurement (SoD-a → 42501)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUTHZ-003: Admin who IS the approver cannot mark the request Paid
-- (SoD-b checks run OUTSIDE the if-not-admin block in migration 0018).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00550000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ select transition_procurement('00550000-0000-0000-0000-000000000011','Paid') $$,
  '42501', null,
  'AC-AUTHZ-003: Admin who approved the request cannot mark it Paid (SoD-b → 42501)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUTHZ-004: Admin who is NOT the requester and NOT the approver CAN Approve
-- (break-glass role override is intact — the role×transition matrix Admin-skip still applies).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00550000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select transition_procurement('00550000-0000-0000-0000-000000000012','Approved') $$,
  'AC-AUTHZ-004: Admin who is NOT the requester/approver can Approve (break-glass override intact)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUTHZ-005: Finance cannot create a GR (no longer in the allowed role set).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00550000-0000-0000-0000-0000000000a4","role":"authenticated"}';

select throws_ok(
  $$ select create_procurement_receipt('00550000-0000-0000-0000-000000000013','Complete','2026-06-09') $$,
  '42501', null,
  'AC-AUTHZ-005: Finance cannot create a GR (tightened grant → 42501)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUTHZ-006: PM can create a GR (still in the allowed role set).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00550000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ select create_procurement_receipt('00550000-0000-0000-0000-000000000013','Partial','2026-06-09') $$,
  'AC-AUTHZ-006: PM can create a GR (still in the allowed role set)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUTHZ-007: Engineer who IS the requester can create a GR.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00550000-0000-0000-0000-0000000000a5","role":"authenticated"}';

select lives_ok(
  $$ select create_procurement_receipt('00550000-0000-0000-0000-000000000013','Complete','2026-06-10') $$,
  'AC-AUTHZ-007: Engineer who IS the requester can create a GR (requester allowed)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUTHZ-008: Engineer who is NOT the requester cannot create a GR.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00550000-0000-0000-0000-0000000000a6","role":"authenticated"}';

select throws_ok(
  $$ select create_procurement_receipt('00550000-0000-0000-0000-000000000013','Complete','2026-06-09') $$,
  '42501', null,
  'AC-AUTHZ-008: Engineer who is NOT the requester cannot create a GR (→ 42501)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUTHZ-009: Finance cannot insert an entry on their own Draft timesheet
-- (Finance excluded from the role gate in migration 0018; server-enforces the FE gate).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00550000-0000-0000-0000-0000000000a4","role":"authenticated"}';

select throws_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
       values ('00550000-0000-0000-0000-000000000001',
               '00550000-0000-0000-0000-0000000000f1',
               '00550000-0000-0000-0000-000000000020',
               '2026-06-09', 8) $$,
  '42501', null,
  'AC-AUTHZ-009: Finance cannot insert an entry on their own Draft timesheet (role gate → 42501)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUTHZ-010: Engineer can insert an entry on their own Draft timesheet (no over-restrict).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00550000-0000-0000-0000-0000000000a7","role":"authenticated"}';

select lives_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
       values ('00550000-0000-0000-0000-000000000001',
               '00550000-0000-0000-0000-0000000000e1',
               '00550000-0000-0000-0000-000000000020',
               '2026-06-09', 8) $$,
  'AC-AUTHZ-010: Engineer can insert an entry on their own Draft timesheet (no over-restrict)');

reset role;

select * from finish();
rollback;
