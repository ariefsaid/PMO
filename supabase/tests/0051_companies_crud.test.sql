-- 0051_companies_crud.test.sql — the Companies CRUD write contract (CRUD+RBAC program, Companies slice).
-- Proves the RLS write contract for master-data companies on top of the EXISTING companies_write
-- FOR ALL policy (org_id = auth_org_id() AND auth_role() IN the 4 write-roles) + the 0012 archived_at
-- column + the company FK references (profiles/projects/procurements → companies):
--   AC-CO-101  a write-role (PM) can INSERT a company (org_id defaulted from auth_org_id(), never sent).
--   AC-CO-102  a write-role (PM) can UPDATE a company (name/type) in its own org.
--   AC-CO-103  a write-role (PM) can archive a company (set archived_at) — and it persists.
--   AC-CO-104  an Engineer (non-write-role) CANNOT INSERT a company (WITH CHECK denies → 42501).
--   AC-CO-105  an Engineer (non-write-role) CANNOT UPDATE/archive a company (USING hides it → 0-row no-op).
--   AC-CO-106  hard-delete of a company REFERENCED by a project is REJECTED by the FK guard (23503) — by Admin.
--   AC-CO-107  hard-delete of an UNREFERENCED company SUCCEEDS by Admin (the row is gone).
--   AC-CO-108  cross-org write is denied: org-B PM cannot INSERT into org-A (WITH CHECK → 42501) and an
--              org-B PM UPDATE of an org-A company is a silent 0-row no-op (USING hides the row).
--   AC-CO-109  a write-role PM CANNOT hard-delete a company (restrictive Admin-only DELETE policy → 42501).
--   AC-CO-110  an Engineer CANNOT hard-delete a company (denied → 42501).
-- RLS is the enforcement authority; the FE gating is only a clarity projection (rbac-visibility.md §D).
-- Migration 0013 narrows company hard-DELETE to Admin via a RESTRICTIVE delete-only policy
-- (auth_role() = 'Admin'); companies_write stays FOR ALL the 4 write-roles for INSERT/UPDATE/archive;
-- archived_at exists (0012); the company FK references reject a delete of a referenced row (23503).
-- ADR-0018: archive (UPDATE archived_at) stays open to all four write-roles server-side; the
-- "archive = Admin/Exec" split in §D is an FE-only convention.
begin;
select plan(20);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
-- "Org-A" is the DEFAULT org ('00000000-…-0001'): the org_id column default is that literal (0001 schema),
-- so a write-role in the default org satisfies the companies_write WITH CHECK (org_id = auth_org_id())
-- WITHOUT sending org_id — exactly the production createCompany() path. Org-B is a separate org used only
-- as the cross-org attacker. The default org + its row IDs are unique to this test (00510000-… namespace),
-- so the referenced-company FK check sees only this test's project.
insert into organizations (id, name) values
  ('00510000-0000-0000-0000-000000000002','Companies CRUD Org B');

insert into auth.users (id, email) values
  ('00510000-0000-0000-0000-0000000000a1','co-pm@example.com'),
  ('00510000-0000-0000-0000-0000000000a2','co-eng@example.com'),
  ('00510000-0000-0000-0000-0000000000a3','co-admin@example.com'),
  ('00510000-0000-0000-0000-0000000000b1','co-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00510000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','CO PM','co-pm@example.com','Project Manager'),
  ('00510000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','CO Eng','co-eng@example.com','Engineer'),
  ('00510000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','CO Admin','co-admin@example.com','Admin'),
  ('00510000-0000-0000-0000-0000000000b1','00510000-0000-0000-0000-000000000002','CO PM B','co-pm-b@example.com','Project Manager');

-- A client company that IS referenced by a project (so its hard-delete must be FK-rejected).
insert into companies (id, org_id, name, type) values
  ('00510000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Referenced Client','Client');
-- An unreferenced vendor company (deletable).
insert into companies (id, org_id, name, type) values
  ('00510000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','Unreferenced Vendor','Vendor');
-- A company the Engineer / cross-org user will try (and fail) to UPDATE.
insert into companies (id, org_id, name, type) values
  ('00510000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','Locked Company','Client');

-- The project that references the first company (projects.client_id → companies.id).
insert into projects (id, org_id, code, name, status, client_id, project_manager_id) values
  ('00510000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'CO-001','Referencing Project','Ongoing Project','00510000-0000-0000-0000-000000000010',
   '00510000-0000-0000-0000-0000000000a1');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-CO-104/105: Engineer (non-write-role) — run FIRST so baselines are untouched.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00510000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- AC-CO-104: Engineer INSERT is denied by the companies_write WITH CHECK (role not in the 4 write-roles) → 42501.
select throws_ok(
  $$ insert into companies (name, type) values ('Eng Co','Vendor') $$,
  '42501', null,
  'AC-CO-104: Engineer cannot INSERT a company (companies_write WITH CHECK role gate → 42501)');

-- AC-CO-105: Engineer UPDATE runs without error but the USING clause hides the row → 0-row no-op (RLS silences it).
select lives_ok(
  $$ update companies set name = 'Eng Renamed'
       where id = '00510000-0000-0000-0000-000000000012' $$,
  'AC-CO-105: Engineer UPDATE companies runs without error (USING hides the row → RLS no-op)');

-- AC-CO-105: Engineer archive attempt is also a silent no-op.
select lives_ok(
  $$ update companies set archived_at = now()
       where id = '00510000-0000-0000-0000-000000000012' $$,
  'AC-CO-105: Engineer archive companies runs without error (USING hides the row → RLS no-op)');

-- AC-CO-110: Engineer cannot hard-delete. The permissive companies_write USING already excludes the
-- Engineer role, so the DELETE matches no rows AND the restrictive Admin-only policy also fails → no-op.
-- A delete the Engineer is not permitted to perform is silently a 0-row no-op (USING hides the row).
select lives_ok(
  $$ delete from companies where id = '00510000-0000-0000-0000-000000000012' $$,
  'AC-CO-110: Engineer DELETE companies runs without error (no permissive policy grants it → RLS no-op)');

reset role;

-- Confirm the Engineer deleted nothing: the row still exists.
select ok(
  (select exists (select 1 from companies where id = '00510000-0000-0000-0000-000000000012')),
  'AC-CO-110: Engineer DELETE affected 0 rows (Locked Company still present)');

-- Confirm the Engineer changed nothing: name unchanged, still live (archived_at NULL).
select is(
  (select name from companies where id = '00510000-0000-0000-0000-000000000012'),
  'Locked Company',
  'AC-CO-105: Engineer UPDATE affected 0 rows (name unchanged)');
select ok(
  (select archived_at is null from companies where id = '00510000-0000-0000-0000-000000000012'),
  'AC-CO-105: Engineer archive affected 0 rows (archived_at still NULL)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-CO-108: cross-org write denied — org-B PM, also before org-A mutations.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00510000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- AC-CO-108: org-B PM INSERT explicitly stamped with org-A's (default) org_id violates the WITH CHECK → 42501.
select throws_ok(
  $$ insert into companies (org_id, name, type)
       values ('00000000-0000-0000-0000-000000000001','Cross Org Co','Vendor') $$,
  '42501', null,
  'AC-CO-108: cross-org INSERT (org-A org_id by an org-B PM) is denied by WITH CHECK → 42501');

-- AC-CO-108: org-B PM UPDATE of an org-A company runs without error but the USING clause hides it → 0-row no-op.
select lives_ok(
  $$ update companies set name = 'Cross Renamed'
       where id = '00510000-0000-0000-0000-000000000012' $$,
  'AC-CO-108: cross-org UPDATE of an org-A company runs without error (USING hides it → RLS no-op)');

reset role;

-- Confirm the cross-org UPDATE changed nothing.
select is(
  (select name from companies where id = '00510000-0000-0000-0000-000000000012'),
  'Locked Company',
  'AC-CO-108: cross-org UPDATE affected 0 rows (name unchanged)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-CO-101/102/103/106/107: the in-org PM (a write-role) does the real CRUD.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00510000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-CO-101: PM can INSERT a company. org_id is NOT sent — the column default + auth_org_id() stamp org-A.
select lives_ok(
  $$ insert into companies (name, type) values ('PM Created Co','Vendor') $$,
  'AC-CO-101: a write-role (PM) can INSERT a company (org_id defaulted, never sent)');

-- AC-CO-102: PM can UPDATE name + type of an own-org company.
select lives_ok(
  $$ update companies set name = 'Referenced Client (Renamed)', type = 'Client'
       where id = '00510000-0000-0000-0000-000000000010' $$,
  'AC-CO-102: a write-role (PM) can UPDATE a company in its own org');

-- AC-CO-103: PM can archive a company (set archived_at).
select lives_ok(
  $$ update companies set archived_at = now()
       where id = '00510000-0000-0000-0000-000000000011' $$,
  'AC-CO-103: a write-role (PM) can archive a company (set archived_at)');

-- AC-CO-109: a write-role PM CANNOT hard-delete. Migration 0013's RESTRICTIVE Admin-only DELETE policy
-- fails for a PM, so the row is invisible to the DELETE → silent 0-row no-op (DELETE has no WITH CHECK,
-- so RLS denial is a no-op, not 42501). The PM keeps INSERT/UPDATE/archive (above) — only DELETE narrows.
select lives_ok(
  $$ delete from companies where id = '00510000-0000-0000-0000-000000000011' $$,
  'AC-CO-109: PM DELETE companies runs without error (restrictive Admin-only DELETE policy → RLS no-op)');

reset role;

-- Confirm the PM deleted nothing: the (now-archived) unreferenced vendor still exists.
select ok(
  (select exists (select 1 from companies where id = '00510000-0000-0000-0000-000000000011')),
  'AC-CO-109: PM DELETE affected 0 rows (the company still exists; only Admin may hard-delete)');

-- AC-CO-101: confirm the PM's INSERT landed in the caller's (default) org (org_id was defaulted, not spoofable).
select is(
  (select org_id::text from companies where name = 'PM Created Co'),
  '00000000-0000-0000-0000-000000000001',
  'AC-CO-101: the PM-inserted company is stamped with the caller''s org (org_id column default)');

-- AC-CO-103: confirm the archive persisted (no silent RLS no-op for the write-role).
select ok(
  (select archived_at is not null from companies where id = '00510000-0000-0000-0000-000000000011'),
  'AC-CO-103: companies.archived_at persisted (the archive write took effect)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-CO-106/107: ADMIN is the only role that may hard-delete (migration 0013).
-- ════════════════════════════════════════════════════════════════════════════
-- A fresh unreferenced vendor for the successful Admin delete (keep the archive assertion above stable).
insert into companies (id, org_id, name, type) values
  ('00510000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','Deletable Co','Vendor');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00510000-0000-0000-0000-0000000000a3","role":"authenticated"}';

-- AC-CO-106: Admin DELETE of the company REFERENCED by the project passes RLS (Admin) but is rejected by
-- the FK guard → 23503. (Under 0013 only an Admin even reaches the FK check; a PM is a silent no-op.)
select throws_ok(
  $$ delete from companies where id = '00510000-0000-0000-0000-000000000010' $$,
  '23503', null,
  'AC-CO-106: Admin hard-delete of a company referenced by a project is rejected (foreign_key_violation 23503)');

-- AC-CO-107: Admin hard-delete of an UNREFERENCED company succeeds (RLS Admin + no FK guard).
select lives_ok(
  $$ delete from companies where id = '00510000-0000-0000-0000-000000000013' $$,
  'AC-CO-107: Admin hard-delete of an unreferenced company succeeds (no FK guard, no RLS denial)');

reset role;

select is(
  (select count(*)::int from companies where id = '00510000-0000-0000-0000-000000000013'),
  0,
  'AC-CO-107: the unreferenced company is gone after the Admin hard-delete');

select * from finish();
rollback;
