begin;
-- 0004_rls_remediation.test.sql — security-audit remediation regression tests (Issue #2 audit).
-- HIGH-1: self role-escalation blocked (profiles_update_self cannot change role/org_id; Admin still can).
-- HIGH-2: child-row cross-org parent pollution blocked for all 7 child write policies (SQLSTATE 42501).
-- LOW-1: auth_role() reads profiles.role (no unsigned JWT claim fast-path) — exercised via the role gate.
select plan(17);

-- ── Fixtures (inserted as table owner, bypassing RLS) ──────────────────────────────────────────────
insert into organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Org B');

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a1','a@example.com'),  -- Org A, Project Manager (can write)
  ('a0000000-0000-0000-0000-0000000000a2','a2@example.com'), -- Org A, Engineer (escalation target)
  ('d0000000-0000-0000-0000-0000000000d1','z@example.com');  -- Org A, Admin

insert into profiles (id, org_id, full_name, email, role) values
  ('a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','User A','a@example.com','Project Manager'),
  ('a0000000-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-000000000001','User A2','a2@example.com','Engineer'),
  ('d0000000-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-000000000001','Admin A','z@example.com','Admin');

-- A project in each org (parent aggregate roots).
insert into projects (id, org_id, name, status) values
  ('a1111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Project A','Ongoing Project'),
  ('b1111111-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','Project B','Ongoing Project');

-- Procurement in each org.
insert into procurements (id, org_id, title, status) values
  ('a2222222-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Proc A','Draft'),
  ('b2222222-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','Proc B','Draft');

-- Budget version in each org (child of project, parent of line items).
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('a3333333-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','a1111111-0000-0000-0000-000000000001',1,'BV A','Draft'),
  ('b3333333-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','b1111111-0000-0000-0000-000000000002',1,'BV B','Draft');

-- A task in each org (parent for task_dependencies).
insert into tasks (id, org_id, project_id, name, status) values
  ('a4444444-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','a1111111-0000-0000-0000-000000000001','Task A1','To Do'),
  ('a4444444-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','a1111111-0000-0000-0000-000000000001','Task A2','To Do'),
  ('b4444444-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','b1111111-0000-0000-0000-000000000002','Task B1','To Do');

-- An org-A vendor (so procurement_quotations FK to companies resolves within org A).
insert into companies (id, org_id, name, type) values
  ('a5555555-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Vendor A','Vendor');

-- ── HIGH-1: self role-escalation is BLOCKED ────────────────────────────────────────────────────────
-- A non-Admin self-update that changes role is rejected by the with check (SQLSTATE 42501).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ update profiles set role = 'Admin' where id = auth.uid() $$,
  '42501', null,
  'HIGH-1: a non-Admin self-update cannot escalate role');

-- A non-Admin self-update that changes org_id is rejected by the with check.
select throws_ok(
  $$ update profiles set org_id = 'bbbbbbbb-0000-0000-0000-000000000002' where id = auth.uid() $$,
  '42501', null,
  'HIGH-1: a non-Admin self-update cannot change org_id');

-- A self-update that does NOT touch role/org_id still succeeds (regression: legitimate self-edits work).
update profiles set full_name = 'Renamed A2' where id = auth.uid();
reset role;  -- read back the ground truth as owner, bypassing RLS
select is(
  (select full_name from profiles where id = 'a0000000-0000-0000-0000-0000000000a2'), 'Renamed A2',
  'HIGH-1: a non-Admin self-update of non-role fields still succeeds');
-- The earlier escalation attempts left the role untouched.
select is(
  (select role::text from profiles where id = 'a0000000-0000-0000-0000-0000000000a2'), 'Engineer',
  'HIGH-1: role is unchanged after the rejected escalation attempts');

-- An Admin CAN change another user''s role (profiles_admin_write authority preserved).
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
update profiles set role = 'Finance' where id = 'a0000000-0000-0000-0000-0000000000a2';
reset role;
select is(
  (select role::text from profiles where id = 'a0000000-0000-0000-0000-0000000000a2'), 'Finance',
  'HIGH-1: an Admin can change a role via profiles_admin_write');

-- ── HIGH-2: child-row cross-org parent pollution is BLOCKED (SQLSTATE 42501) ────────────────────────
-- Become org-A's writer (Project Manager).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- budget_line_items: stamped org A, parent budget_version belongs to org B.
select throws_ok(
  $$ insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount)
     values ('aaaaaaaa-0000-0000-0000-000000000001','b3333333-0000-0000-0000-000000000002','Labor',10) $$,
  '42501', null,
  'HIGH-2: budget_line_items cannot reference a cross-org budget_version');

-- tasks: stamped org A, parent project belongs to org B.
select throws_ok(
  $$ insert into tasks (org_id, project_id, name, status)
     values ('aaaaaaaa-0000-0000-0000-000000000001','b1111111-0000-0000-0000-000000000002','X-org task','To Do') $$,
  '42501', null,
  'HIGH-2: tasks cannot reference a cross-org project');

-- task_dependencies: stamped org A, depends_on parent task belongs to org B.
select throws_ok(
  $$ insert into task_dependencies (org_id, task_id, depends_on_id)
     values ('aaaaaaaa-0000-0000-0000-000000000001','a4444444-0000-0000-0000-000000000001','b4444444-0000-0000-0000-000000000002') $$,
  '42501', null,
  'HIGH-2: task_dependencies cannot reference a cross-org depends_on task');

-- project_documents: stamped org A, parent project belongs to org B.
select throws_ok(
  $$ insert into project_documents (org_id, project_id, category, title)
     values ('aaaaaaaa-0000-0000-0000-000000000001','b1111111-0000-0000-0000-000000000002','Spec','X-org doc') $$,
  '42501', null,
  'HIGH-2: project_documents cannot reference a cross-org project');

-- procurement_items: stamped org A, parent procurement belongs to org B.
select throws_ok(
  $$ insert into procurement_items (org_id, procurement_id, name, quantity, rate)
     values ('aaaaaaaa-0000-0000-0000-000000000001','b2222222-0000-0000-0000-000000000002','X-org item',1,1) $$,
  '42501', null,
  'HIGH-2: procurement_items cannot reference a cross-org procurement');

-- procurement_quotations: stamped org A (org-A vendor), parent procurement belongs to org B.
select throws_ok(
  $$ insert into procurement_quotations (org_id, procurement_id, vendor_id, reference, total_amount)
     values ('aaaaaaaa-0000-0000-0000-000000000001','b2222222-0000-0000-0000-000000000002','a5555555-0000-0000-0000-000000000001','Q',1) $$,
  '42501', null,
  'HIGH-2: procurement_quotations cannot reference a cross-org procurement');

-- procurement_documents: stamped org A, parent procurement belongs to org B.
select throws_ok(
  $$ insert into procurement_documents (org_id, procurement_id, type, status)
     values ('aaaaaaaa-0000-0000-0000-000000000001','b2222222-0000-0000-0000-000000000002','PO','Draft') $$,
  '42501', null,
  'HIGH-2: procurement_documents cannot reference a cross-org procurement');

-- ── MEDIUM-1: coarse role gate is enforced on INSERT (WITH CHECK), not only UPDATE/DELETE (USING) ─────
-- Postgres applies USING to UPDATE/DELETE but NOT to INSERT — only WITH CHECK gates INSERT. Without the
-- role predicate in WITH CHECK, an in-org Engineer could INSERT despite failing the write-role gate.
-- These rows are stamped with the Engineer's OWN org (org A), so org-isolation is satisfied: any rejection
-- (42501) is the role gate alone. Become org-A's Engineer (a2 — restored to Engineer? no: a2 was promoted
-- to Finance above by the Admin test, which WOULD be a writer — so reset a2 back to Engineer first).
reset role;
update profiles set role = 'Engineer' where id = 'a0000000-0000-0000-0000-0000000000a2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- projects: Engineer INSERT into own org is rejected by the role gate.
select throws_ok(
  $$ insert into projects (org_id, name, status)
     values ('aaaaaaaa-0000-0000-0000-000000000001','Eng project','Leads') $$,
  '42501', null,
  'MEDIUM-1: Engineer cannot INSERT projects in own org (role gate on WITH CHECK)');

-- tasks (child): Engineer INSERT into own org, valid org-A parent project, rejected by the role gate.
select throws_ok(
  $$ insert into tasks (org_id, project_id, name, status)
     values ('aaaaaaaa-0000-0000-0000-000000000001','a1111111-0000-0000-0000-000000000001','Eng task','To Do') $$,
  '42501', null,
  'MEDIUM-1: Engineer cannot INSERT tasks in own org (role gate on WITH CHECK)');

-- procurement_items (child): Engineer INSERT into own org, valid org-A parent procurement, rejected.
select throws_ok(
  $$ insert into procurement_items (org_id, procurement_id, name, quantity, rate)
     values ('aaaaaaaa-0000-0000-0000-000000000001','a2222222-0000-0000-0000-000000000001','Eng item',1,1) $$,
  '42501', null,
  'MEDIUM-1: Engineer cannot INSERT procurement_items in own org (role gate on WITH CHECK)');

-- ── MEDIUM-1 (no over-blocking): writer roles can still INSERT into their own org ────────────────────
-- Become org-A's Project Manager (a1 — a writer).
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into projects (id, org_id, name, status)
  values ('a1111111-0000-0000-0000-0000000000aa','aaaaaaaa-0000-0000-0000-000000000001','PM project','Leads');
reset role;
select is(
  (select count(*)::int from projects where id = 'a1111111-0000-0000-0000-0000000000aa'), 1,
  'MEDIUM-1: a Project Manager CAN INSERT projects in own org (no over-blocking)');

-- Become org-A's Admin (d1 — a writer); insert a child task under the org-A project.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
insert into tasks (id, org_id, project_id, name, status)
  values ('a4444444-0000-0000-0000-0000000000aa','aaaaaaaa-0000-0000-0000-000000000001','a1111111-0000-0000-0000-000000000001','Admin task','To Do');
reset role;
select is(
  (select count(*)::int from tasks where id = 'a4444444-0000-0000-0000-0000000000aa'), 1,
  'MEDIUM-1: an Admin CAN INSERT tasks in own org (no over-blocking)');

reset role;
select * from finish();
rollback;
