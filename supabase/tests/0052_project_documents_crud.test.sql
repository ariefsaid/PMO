-- 0052_project_documents_crud.test.sql — the project_documents (Document register) write contract
-- (CRUD+RBAC program, Documents slice). NO new migration: this proves the EXISTING
-- `project_documents_write` FOR ALL policy (0002_rls.sql) + the parent-org guard (audit HIGH-2):
--   project_documents_write USING/WITH CHECK:
--     org_id = auth_org_id()
--     AND auth_role() IN ('Admin','Executive','Project Manager','Finance')   (the 4 master-data write-roles)
--     AND EXISTS (a project p where p.id = project_documents.project_id AND p.org_id = auth_org_id())
--
-- AC ownership (this is the OWNING layer for the RLS write contract):
--   AC-DOC-101  a master-data write-role (PM) can INSERT a register entry (org_id defaulted, never sent).
--   AC-DOC-102  a write-role (PM) can UPDATE a document's metadata in its own org.
--   AC-DOC-103  a write-role (PM) can move a document's status (Draft → Issued) — the workflow write.
--   AC-DOC-104  an Engineer (non-write-role) CANNOT INSERT a document (WITH CHECK denies → 42501).
--   AC-DOC-105  an Engineer (non-write-role) CANNOT UPDATE/transition a document (USING hides it → 0-row no-op).
--   AC-DOC-106  cross-org write is denied: an org-B PM cannot INSERT into an org-A project (WITH CHECK → 42501),
--               and an org-B PM UPDATE of an org-A document is a silent 0-row no-op (USING hides the row).
--   AC-DOC-107  the parent-org guard: a write-role cannot create a document against a project in ANOTHER org
--               (the EXISTS(project in caller's org) clause fails → 42501).
--   AC-DOC-108  Admin can hard-delete a document (FE gates delete to Admin; RLS permits the 4 write-roles —
--               RLS is the authority, the FE is the clarity projection).
--
-- NOTE (status workflow — RPC-only as of migration 0017): project_documents.status is no longer a
-- direct-UPDATE column. Migration 0017 removed `status` from the authenticated UPDATE column grant and
-- routes all status changes through the SECURITY DEFINER transition_document_status RPC, which re-asserts
-- org + role + the legal status map + the approver≠author SoD. So a status transition is exercised here
-- through that RPC (AC-DOC-103); a direct `update … set status` now fails 42501 for everyone (proven in
-- 0053). The metadata write contract (this file's other ACs) is unchanged — project_documents_write
-- still gates org + the 4 write-roles + parent-org on the remaining columns. The full SoD (author cannot
-- self-approve) is OWNED by 0053_document_transition_sod.test.sql.
begin;
select plan(16);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
-- Org-A is the DEFAULT org ('00000000-…-0001') so a write-role in it satisfies the WITH CHECK
-- (org_id = auth_org_id()) WITHOUT sending org_id — exactly the production createProjectDocument() path.
-- Org-B is the cross-org attacker. The 00520000-… id namespace is unique to this test.
insert into organizations (id, name) values
  ('00520000-0000-0000-0000-000000000002','Documents CRUD Org B');

insert into auth.users (id, email) values
  ('00520000-0000-0000-0000-0000000000a1','doc-pm@example.com'),
  ('00520000-0000-0000-0000-0000000000a2','doc-eng@example.com'),
  ('00520000-0000-0000-0000-0000000000a3','doc-admin@example.com'),
  ('00520000-0000-0000-0000-0000000000b1','doc-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00520000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','DOC PM','doc-pm@example.com','Project Manager'),
  ('00520000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','DOC Eng','doc-eng@example.com','Engineer'),
  ('00520000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','DOC Admin','doc-admin@example.com','Admin'),
  ('00520000-0000-0000-0000-0000000000b1','00520000-0000-0000-0000-000000000002','DOC PM B','doc-pm-b@example.com','Project Manager');

-- An org-A project (the register's parent) and an org-B project (the cross-org parent).
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00520000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'DOC-PRJ-A','Doc Register Project A','Ongoing Project','00520000-0000-0000-0000-0000000000a1'),
  ('00520000-0000-0000-0000-000000000021','00520000-0000-0000-0000-000000000002',
   'DOC-PRJ-B','Doc Register Project B','Ongoing Project','00520000-0000-0000-0000-0000000000b1');

-- An existing org-A document the Engineer / cross-org user will try (and fail) to UPDATE/transition.
insert into project_documents (id, org_id, project_id, code, category, title, status, author_id) values
  ('00520000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001',
   '00520000-0000-0000-0000-000000000020','DOC-001','Drawing','Locked Drawing','Draft',
   '00520000-0000-0000-0000-0000000000a1');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-104/105: Engineer (non-write-role) — run FIRST so baselines are untouched.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- AC-DOC-104: Engineer INSERT denied by the project_documents_write WITH CHECK (role not in the 4 write-roles) → 42501.
select throws_ok(
  $$ insert into project_documents (project_id, category, title)
       values ('00520000-0000-0000-0000-000000000020','Drawing','Eng Doc') $$,
  '42501', null,
  'AC-DOC-104: Engineer cannot INSERT a document (project_documents_write WITH CHECK role gate → 42501)');

-- AC-DOC-105: Engineer UPDATE runs without error but USING hides the row → 0-row no-op.
select lives_ok(
  $$ update project_documents set title = 'Eng Renamed'
       where id = '00520000-0000-0000-0000-000000000030' $$,
  'AC-DOC-105: Engineer UPDATE project_documents runs without error (USING hides the row → RLS no-op)');

-- AC-DOC-105: a direct status UPDATE is now RPC-only (migration 0017 dropped status from the column
-- grant), so even the metadata-blocked Engineer's direct status write fails with a column-privilege 42501.
select throws_ok(
  $$ update project_documents set status = 'Issued'
       where id = '00520000-0000-0000-0000-000000000030' $$,
  '42501', null,
  'AC-DOC-105: a direct status UPDATE is denied — status is RPC-only (column privilege → 42501)');

reset role;

-- Confirm the Engineer changed nothing: title + status unchanged.
select is(
  (select title from project_documents where id = '00520000-0000-0000-0000-000000000030'),
  'Locked Drawing',
  'AC-DOC-105: Engineer UPDATE affected 0 rows (title unchanged)');
select is(
  (select status::text from project_documents where id = '00520000-0000-0000-0000-000000000030'),
  'Draft',
  'AC-DOC-105: Engineer transition affected 0 rows (status still Draft)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-106/107: cross-org + parent-org guard — org-B PM, before org-A mutations.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- AC-DOC-106: org-B PM INSERT explicitly stamped with org-A's org_id (and org-A's project) violates WITH CHECK → 42501.
select throws_ok(
  $$ insert into project_documents (org_id, project_id, category, title)
       values ('00000000-0000-0000-0000-000000000001','00520000-0000-0000-0000-000000000020','Drawing','Cross Org Doc') $$,
  '42501', null,
  'AC-DOC-106: cross-org INSERT (org-A org_id by an org-B PM) is denied by WITH CHECK → 42501');

-- AC-DOC-107: org-B PM INSERT into an org-A project, defaulting org_id to org-B (their own), still fails the
-- parent-org guard: the project_id belongs to org-A, so EXISTS(project in caller's org) is false → 42501.
-- (The default org_id would be org-B; that mismatches the org-A project the row points at.)
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ insert into project_documents (org_id, project_id, category, title)
       values ('00520000-0000-0000-0000-000000000002','00520000-0000-0000-0000-000000000020','Drawing','Wrong Parent') $$,
  '42501', null,
  'AC-DOC-107: parent-org guard — org-B PM cannot attach a document to an org-A project (EXISTS fails → 42501)');

-- AC-DOC-106: org-B PM UPDATE of an org-A document runs without error but USING hides it → 0-row no-op.
select lives_ok(
  $$ update project_documents set title = 'Cross Renamed'
       where id = '00520000-0000-0000-0000-000000000030' $$,
  'AC-DOC-106: cross-org UPDATE of an org-A document runs without error (USING hides it → RLS no-op)');

reset role;

select is(
  (select title from project_documents where id = '00520000-0000-0000-0000-000000000030'),
  'Locked Drawing',
  'AC-DOC-106: cross-org UPDATE affected 0 rows (title unchanged)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-101/102/103: the in-org PM (a write-role) does the real CRUD + workflow.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-DOC-101: PM can INSERT a document. org_id is NOT sent — the column default + auth_org_id() stamp org-A.
select lives_ok(
  $$ insert into project_documents (project_id, category, title, code)
       values ('00520000-0000-0000-0000-000000000020','Specification','PM Created Spec','DOC-009') $$,
  'AC-DOC-101: a write-role (PM) can INSERT a document (org_id defaulted, never sent)');

-- AC-DOC-102: PM can UPDATE the metadata of an own-org document.
select lives_ok(
  $$ update project_documents set title = 'Locked Drawing (Rev B)', revision = 'B'
       where id = '00520000-0000-0000-0000-000000000030' $$,
  'AC-DOC-102: a write-role (PM) can UPDATE a document''s metadata in its own org');

-- AC-DOC-103: PM moves the status (Draft → Issued) via the transition_document_status RPC (the sole
-- writer of status as of 0017). The PM is the document's author here, but Draft→Issued is NOT an
-- approve/reject, so the approver≠author SoD does not apply — only Approved/Rejected are SoD-gated.
select lives_ok(
  $$ select transition_document_status('00520000-0000-0000-0000-000000000030','Issued') $$,
  'AC-DOC-103: a write-role (PM) can transition a document''s status via the RPC (Draft → Issued)');

reset role;

-- AC-DOC-101: confirm the PM's INSERT landed in the caller's (default) org (org_id was defaulted, not spoofable).
select is(
  (select org_id::text from project_documents where title = 'PM Created Spec'),
  '00000000-0000-0000-0000-000000000001',
  'AC-DOC-101: the PM-inserted document is stamped with the caller''s org (org_id column default)');

-- AC-DOC-103: confirm the transition persisted (no silent RLS no-op for the write-role).
select is(
  (select status::text from project_documents where id = '00520000-0000-0000-0000-000000000030'),
  'Issued',
  'AC-DOC-103: the status transition persisted (the workflow write took effect)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-108: Admin (a write-role) can hard-delete a document (FE gates this to Admin; RLS is the authority).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ delete from project_documents where id = '00520000-0000-0000-0000-000000000030' $$,
  'AC-DOC-108: Admin can hard-delete a document (project_documents_write permits the write-roles for DELETE)');

reset role;

select is(
  (select count(*)::int from project_documents where id = '00520000-0000-0000-0000-000000000030'),
  0,
  'AC-DOC-108: the document is gone after the Admin hard-delete');

select * from finish();
rollback;
