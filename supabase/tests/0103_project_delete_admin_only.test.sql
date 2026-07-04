-- 0103_project_delete_admin_only.test.sql
-- RED-4 (HIGH, live prod) — non-admin project hard-delete (ADR-0019 violation).
-- Migration 0052_project_delete_admin_only.sql adds a restrictive Admin-only DELETE policy on projects.
--
-- Proofs:
--   1. A non-admin write role (Project Manager) DELETE is DENIED (restrictive policy => 0 rows affected).
--   2. An Admin DELETE of an unreferenced project is ALLOWED.
--   3. An Admin DELETE of a project referenced by a procurement FK-BLOCKS with 23503 ("in use").
begin;
select plan(4);

-- Fixtures (inserted as table owner).
insert into organizations (id, name) values
  ('01030000-0000-0000-0000-000000000001','Project Delete Org');

insert into auth.users (id, email) values
  ('01030000-0000-0000-0000-0000000000a1','pm-del@example.com'),      -- non-admin write role
  ('01030000-0000-0000-0000-0000000000a2','admin-del@example.com');   -- Admin

insert into profiles (id, org_id, full_name, email, role) values
  ('01030000-0000-0000-0000-0000000000a1','01030000-0000-0000-0000-000000000001','PM Del','pm-del@example.com','Project Manager'),
  ('01030000-0000-0000-0000-0000000000a2','01030000-0000-0000-0000-000000000001','Admin Del','admin-del@example.com','Admin');

-- Three projects: one the PM will try to delete, one the Admin deletes clean, one referenced (FK-block).
insert into projects (id, org_id, name, code, status) values
  ('01030000-0000-0000-0000-000000000010','01030000-0000-0000-0000-000000000001','PM-Target','PRJ-D1','Leads'),
  ('01030000-0000-0000-0000-000000000011','01030000-0000-0000-0000-000000000001','Admin-Clean','PRJ-D2','Leads'),
  ('01030000-0000-0000-0000-000000000012','01030000-0000-0000-0000-000000000001','Admin-Referenced','PRJ-D3','Leads');

-- A procurement referencing the third project (procurements.project_id => projects, FK RESTRICT/no-cascade).
insert into procurements (id, org_id, title, status, requested_by_id, project_id) values
  ('01030000-0000-0000-0000-000000000020','01030000-0000-0000-0000-000000000001','Ref PR','Draft',
   '01030000-0000-0000-0000-0000000000a1','01030000-0000-0000-0000-000000000012');

-- ── 1. Non-admin (PM) DELETE is DENIED by the restrictive policy => affects 0 rows (row stays). ──
--    Pre-fix (bypass) the PM DELETE SUCCEEDS (projects_write for-all covers DELETE for the 4 roles).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01030000-0000-0000-0000-0000000000a1","role":"authenticated"}';

delete from projects where id = '01030000-0000-0000-0000-000000000010';
select is(
  (select count(*)::int from projects where id = '01030000-0000-0000-0000-000000000010'),
  1,
  'RED-4: non-admin (PM) hard-delete of a project is denied (row survives)');

reset role;

-- ── 2. Admin DELETE of an unreferenced project is ALLOWED. ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01030000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ delete from projects where id = '01030000-0000-0000-0000-000000000011' $$,
  'RED-4: Admin hard-delete of an unreferenced project is allowed');
select is(
  (select count(*)::int from projects where id = '01030000-0000-0000-0000-000000000011'),
  0,
  'RED-4: the Admin-deleted project is gone');

-- ── 3. Admin DELETE of a referenced project FK-BLOCKS with 23503 ("in use"). ──
select throws_ok(
  $$ delete from projects where id = '01030000-0000-0000-0000-000000000012' $$,
  '23503', null,
  'RED-4: deleting a referenced project FK-blocks with 23503 (in use)');

reset role;
select * from finish();
rollback;
