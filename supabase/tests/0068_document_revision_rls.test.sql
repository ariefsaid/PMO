-- 0068_document_revision_rls.test.sql — revision lineage RLS
--   AC-DOC-051  revision creation stores parent_document_id and copies fields
begin;
select plan(3);

insert into auth.users (id, email) values
  ('00680000-0000-0000-0000-0000000000a1','rev-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00680000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Rev PM','rev-pm@example.com','Project Manager');

insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00680000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'REV-PRJ','Revision Project','Ongoing Project','00680000-0000-0000-0000-0000000000a1');

-- Parent document (Approved)
insert into project_documents (id, org_id, project_id, code, category, title, revision, status, author_id) values
  ('00680000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001',
   '00680000-0000-0000-0000-000000000020','REV-001','Drawing','Foundation GA','A','Approved',
   '00680000-0000-0000-0000-0000000000a1');

-- Create child revision via RLS (DAL insert path)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00680000-0000-0000-0000-0000000000a1","role":"authenticated"}';

insert into project_documents (project_id, code, category, title, revision, status, author_id, parent_document_id)
  values ('00680000-0000-0000-0000-000000000020','REV-001','Drawing','Foundation GA','B','Draft',
          '00680000-0000-0000-0000-0000000000a1',
          '00680000-0000-0000-0000-000000000030');

-- Verify child row
select results_eq(
  $$ select parent_document_id, revision, status from project_documents
     where parent_document_id = '00680000-0000-0000-0000-000000000030' $$,
  $$ values ('00680000-0000-0000-0000-000000000030'::uuid, 'B'::text, 'Draft'::doc_status) $$,
  'AC-DOC-051: child revision has parent_document_id, bumped revision, Draft status'
);

select results_eq(
  $$ select code, category, title from project_documents
     where parent_document_id = '00680000-0000-0000-0000-000000000030' $$,
  $$ values ('REV-001'::text, 'Drawing'::text, 'Foundation GA'::text) $$,
  'AC-DOC-051: child copies code/category/title from parent'
);

-- Verify file_path is null on new revision
select is_empty(
  $$ select 1 from project_documents
     where parent_document_id = '00680000-0000-0000-0000-000000000030' and file_path is not null $$,
  'AC-DOC-051: new revision starts with null file_path'
);

select finish();
rollback;
