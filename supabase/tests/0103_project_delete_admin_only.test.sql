-- 0103_project_delete_admin_only.test.sql
-- RED-4 (HIGH, live prod) — non-admin project hard-delete (ADR-0019 violation).
-- Migration 0052_project_delete_admin_only.sql adds a restrictive Admin-only DELETE policy on projects.
--
-- Proofs:
--   1. A non-admin write role (Project Manager) DELETE is DENIED (restrictive policy => 0 rows affected).
--   2. An Admin DELETE of an unreferenced project is ALLOWED.
--   3. An Admin DELETE of a project referenced by a procurement FK-BLOCKS with 23503 ("in use").
--   4. Finance (a write-role, but not Admin) DELETE is DENIED (RED-4 re-confirm hardening).
--   5. Executive (a write-role, but not Admin) DELETE is DENIED (RED-4 re-confirm hardening).
--   6. A cross-org Admin (Admin of a DIFFERENT org) DELETE is DENIED (org guard rides on the
--      permissive projects_write USING clause, not the restrictive Admin-only policy itself).
begin;
select plan(7);

-- Fixtures (inserted as table owner).
insert into organizations (id, name) values
  ('01030000-0000-0000-0000-000000000001','Project Delete Org'),
  ('01030000-0000-0000-0000-000000000002','Project Delete Org B (cross-org)');

insert into auth.users (id, email) values
  ('01030000-0000-0000-0000-0000000000a1','pm-del@example.com'),      -- non-admin write role
  ('01030000-0000-0000-0000-0000000000a2','admin-del@example.com'),   -- Admin (org A)
  ('01030000-0000-0000-0000-0000000000a3','fin-del@example.com'),     -- Finance (org A, write-role, not Admin)
  ('01030000-0000-0000-0000-0000000000a4','exec-del@example.com'),    -- Executive (org A, write-role, not Admin)
  ('01030000-0000-0000-0000-0000000000b1','admin-del-b@example.com'); -- Admin of org B (cross-org)

insert into profiles (id, org_id, full_name, email, role) values
  ('01030000-0000-0000-0000-0000000000a1','01030000-0000-0000-0000-000000000001','PM Del','pm-del@example.com','Project Manager'),
  ('01030000-0000-0000-0000-0000000000a2','01030000-0000-0000-0000-000000000001','Admin Del','admin-del@example.com','Admin'),
  ('01030000-0000-0000-0000-0000000000a3','01030000-0000-0000-0000-000000000001','Finance Del','fin-del@example.com','Finance'),
  ('01030000-0000-0000-0000-0000000000a4','01030000-0000-0000-0000-000000000001','Exec Del','exec-del@example.com','Executive'),
  ('01030000-0000-0000-0000-0000000000b1','01030000-0000-0000-0000-000000000002','Admin Del B','admin-del-b@example.com','Admin');

-- Projects: PM/Finance/Executive targets, one the Admin deletes clean, one referenced (FK-block),
-- and one for the cross-org-Admin denial case.
insert into projects (id, org_id, name, code, status) values
  ('01030000-0000-0000-0000-000000000010','01030000-0000-0000-0000-000000000001','PM-Target','PRJ-D1','Leads'),
  ('01030000-0000-0000-0000-000000000011','01030000-0000-0000-0000-000000000001','Admin-Clean','PRJ-D2','Leads'),
  ('01030000-0000-0000-0000-000000000012','01030000-0000-0000-0000-000000000001','Admin-Referenced','PRJ-D3','Leads'),
  ('01030000-0000-0000-0000-000000000013','01030000-0000-0000-0000-000000000001','Finance-Target','PRJ-D4','Leads'),
  ('01030000-0000-0000-0000-000000000014','01030000-0000-0000-0000-000000000001','Executive-Target','PRJ-D5','Leads'),
  ('01030000-0000-0000-0000-000000000015','01030000-0000-0000-0000-000000000001','CrossOrg-Target','PRJ-D6','Leads');

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

-- ── 4. Finance (write-role, not Admin) DELETE is DENIED (restrictive policy => 0 rows affected). ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01030000-0000-0000-0000-0000000000a3","role":"authenticated"}';

delete from projects where id = '01030000-0000-0000-0000-000000000013';
select is(
  (select count(*)::int from projects where id = '01030000-0000-0000-0000-000000000013'),
  1,
  'RED-4: Finance hard-delete of a project is denied (row survives)');

reset role;

-- ── 5. Executive (write-role, not Admin) DELETE is DENIED (restrictive policy => 0 rows affected). ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01030000-0000-0000-0000-0000000000a4","role":"authenticated"}';

delete from projects where id = '01030000-0000-0000-0000-000000000014';
select is(
  (select count(*)::int from projects where id = '01030000-0000-0000-0000-000000000014'),
  1,
  'RED-4: Executive hard-delete of a project is denied (row survives)');

reset role;

-- ── 6. Cross-org Admin (Admin of a DIFFERENT org) DELETE is DENIED (org guard rides on the
--      permissive projects_write USING clause — Admin-ness alone is not enough across orgs). ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01030000-0000-0000-0000-0000000000b1","role":"authenticated"}';

delete from projects where id = '01030000-0000-0000-0000-000000000015';
-- Count as TABLE OWNER (reset role first): the cross-org admin cannot SELECT the org-A row
-- (projects_select org guard), so counting under their identity would return 0 whether or not the
-- DELETE was blocked — a false negative. The owner sees all rows, so this proves the row SURVIVED.
reset role;
select is(
  (select count(*)::int from projects where id = '01030000-0000-0000-0000-000000000015'),
  1,
  'RED-4: cross-org Admin hard-delete of another org''s project is denied (org guard, row survives)');

select * from finish();
rollback;
