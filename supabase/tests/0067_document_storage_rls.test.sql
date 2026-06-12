-- 0067_document_storage_rls.test.sql — storage.objects RLS for project-documents bucket.
--   AC-DOC-010  cross-org user cannot read objects in org X's path
--   AC-DOC-022  upload to a non-Draft document's storage path is denied (server-enforced)
--   AC-DOC-070  storage write policy enforces Draft-only (core requirement)
begin;
select plan(6);

-- Fixtures
insert into organizations (id, name) values
  ('00670000-0000-0000-0000-000000000001','Storage Org A');
insert into organizations (id, name) values
  ('00670000-0000-0000-0000-000000000002','Storage Org B');

insert into auth.users (id, email) values
  ('00670000-0000-0000-0000-0000000000a1','stor-pm-a@example.com'),
  ('00670000-0000-0000-0000-0000000000a2','stor-eng-a@example.com'),
  ('00670000-0000-0000-0000-0000000000b1','stor-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00670000-0000-0000-0000-0000000000a1','00670000-0000-0000-0000-000000000001','Stor PM A','stor-pm-a@example.com','Project Manager'),
  ('00670000-0000-0000-0000-0000000000a2','00670000-0000-0000-0000-000000000001','Stor Eng A','stor-eng-a@example.com','Engineer'),
  ('00670000-0000-0000-0000-0000000000b1','00670000-0000-0000-0000-000000000002','Stor PM B','stor-pm-b@example.com','Project Manager');

insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00670000-0000-0000-0000-000000000020','00670000-0000-0000-0000-000000000001',
   'STOR-PRJ','Storage Project','Ongoing Project','00670000-0000-0000-0000-0000000000a1');

-- Draft document → write SHOULD succeed
insert into project_documents (id, org_id, project_id, code, category, title, status, author_id) values
  ('00670000-0000-0000-0000-000000000030','00670000-0000-0000-0000-000000000001',
   '00670000-0000-0000-0000-000000000020','STOR-D','Drawing','Draft Doc','Draft',
   '00670000-0000-0000-0000-0000000000a1');

-- Issued document → write SHOULD be denied
insert into project_documents (id, org_id, project_id, code, category, title, status, author_id) values
  ('00670000-0000-0000-0000-000000000031','00670000-0000-0000-0000-000000000001',
   '00670000-0000-0000-0000-000000000020','STOR-I','Drawing','Issued Doc','Issued',
   '00670000-0000-0000-0000-0000000000a1');

-- Seed a storage object on the Draft doc's path (as table owner, bypassing RLS)
insert into storage.objects (id, bucket_id, name, owner)
  values (gen_random_uuid(), 'project-documents',
    '00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/test.pdf',
    '00670000-0000-0000-0000-0000000000a1');

-- ── AC-DOC-010: in-org PM can read the object ──────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00670000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from storage.objects where bucket_id = 'project-documents' $$,
  $$ values (1) $$,
  'AC-DOC-010: in-org PM can read storage object');

-- ── AC-DOC-010: cross-org PM CANNOT read ────────────────────────────────────
set local request.jwt.claims = '{"sub":"00670000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from storage.objects where bucket_id = 'project-documents' $$,
  $$ values (0) $$,
  'AC-DOC-010: cross-org PM cannot read storage objects (0 rows)');

-- ── AC-DOC-070: write to Draft doc's path succeeds (in-org PM) ──────────────
set local request.jwt.claims = '{"sub":"00670000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into storage.objects (id, bucket_id, name, owner)
       values (gen_random_uuid(), 'project-documents',
         '00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/replace.pdf',
         '00670000-0000-0000-0000-0000000000a1') $$,
  'AC-DOC-070: in-org PM can write to Draft doc path');

-- ── AC-DOC-022: write to Issued doc's path is DENIED ────────────────────────
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name, owner)
       values (gen_random_uuid(), 'project-documents',
         '00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000031/file.pdf',
         '00670000-0000-0000-0000-0000000000a1') $$,
  '42501', null,
  'AC-DOC-022: upload to non-Draft document storage path denied (42501)');

-- ── AC-DOC-070: Engineer (non-write-role) cannot write to Draft doc's path ──
set local request.jwt.claims = '{"sub":"00670000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name, owner)
       values (gen_random_uuid(), 'project-documents',
         '00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/eng.pdf',
         '00670000-0000-0000-0000-0000000000a2') $$,
  '42501', null,
  'AC-DOC-070: Engineer cannot write to storage (role gate 42501)');

-- ── AC-DOC-010: unauthenticated/anon cannot read ────────────────────────────
reset role;
set local request.jwt.claims = '{}';
set local role anon;
select results_eq(
  $$ select count(*)::int from storage.objects where bucket_id = 'project-documents' $$,
  $$ values (0) $$,
  'AC-DOC-010: anon cannot read storage objects');

select finish();
rollback;
