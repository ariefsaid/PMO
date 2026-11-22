-- 1090_document_category_visibility.test.sql — #2579 document categories with per-role visibility.
-- Spec docs/specs/document-category-visibility.spec.md. Migrations under test: 1164..1168 (+ rollbacks).
-- Fixture: org A with categories Commercial approval (Admin, Executive, Finance), Invoice (Admin, Finance), Drawing (all roles);
-- one document in each with an uploaded file object; one user per role; a second organisation.
begin;
select plan(73);

insert into organizations (id, name) values
  ('02579000-0000-0000-0000-00000000000a', 'DCV Org A'),
  ('02579000-0000-0000-0000-00000000000b', 'DCV Org B');

insert into auth.users (id, email) values
  ('02579000-0000-0000-0000-0000000000a1', 'dcv-admin@example.com'),
  ('02579000-0000-0000-0000-0000000000a2', 'dcv-exec@example.com'),
  ('02579000-0000-0000-0000-0000000000a3', 'dcv-pm@example.com'),
  ('02579000-0000-0000-0000-0000000000a4', 'dcv-fin@example.com'),
  ('02579000-0000-0000-0000-0000000000a5', 'dcv-eng@example.com'),
  ('02579000-0000-0000-0000-0000000000b1', 'dcv-admin-b@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('02579000-0000-0000-0000-0000000000a1', '02579000-0000-0000-0000-00000000000a', 'Admin A', 'dcv-admin@example.com', 'Admin'),
  ('02579000-0000-0000-0000-0000000000a2', '02579000-0000-0000-0000-00000000000a', 'Exec A', 'dcv-exec@example.com', 'Executive'),
  ('02579000-0000-0000-0000-0000000000a3', '02579000-0000-0000-0000-00000000000a', 'PM A', 'dcv-pm@example.com', 'Project Manager'),
  ('02579000-0000-0000-0000-0000000000a4', '02579000-0000-0000-0000-00000000000a', 'Fin A', 'dcv-fin@example.com', 'Finance'),
  ('02579000-0000-0000-0000-0000000000a5', '02579000-0000-0000-0000-00000000000a', 'Eng A', 'dcv-eng@example.com', 'Engineer'),
  ('02579000-0000-0000-0000-0000000000b1', '02579000-0000-0000-0000-00000000000b', 'Admin B', 'dcv-admin-b@example.com', 'Admin');
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('02579000-0000-0000-0000-000000000020', '02579000-0000-0000-0000-00000000000a', 'DCV-PRJ', 'DCV Project', 'Ongoing Project', '02579000-0000-0000-0000-0000000000a3');

-- ── seed (FR-DCV-001/002, AC-DCV-001) ───────────────────────────────────────────────────────────────
select is((select count(*)::int from document_categories where org_id = '02579000-0000-0000-0000-00000000000a' and is_system), 9,
  'AC-DCV-001 a new organisation is seeded with the nine system categories');
select is((select count(*)::int from document_category_roles r join document_categories c on c.id = r.category_id
            where c.org_id = '02579000-0000-0000-0000-00000000000a' and c.is_system), 45,
  'AC-DCV-001 every system category lists all five roles (no one''s access changes at ship)');
select is((select string_agg(name, ',' order by sort_order) from document_categories where org_id = '02579000-0000-0000-0000-00000000000a'),
  'Drawing,Specification,Report,Transmittal,Submittal,Certificate,Other,Reference,Delivery record',
  'AC-DCV-001 the seeded set is the seven register names plus Reference and Delivery record (the BAST category)');
select is((select count(*)::int from public.project_documents where category_id is null), 0,
  'AC-DCV-001 no document is without a category after the migration');

-- ── management as Admin: create (FR-DCV-003) ────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select create_document_category('Commercial approval', array['Executive','Finance']::user_role[])$$,
  'AC-DCV-008 an Admin creates a category');
select lives_ok($$select create_document_category('Invoice', array['Finance']::user_role[])$$, 'an Admin creates Invoice');
select lives_ok($$select create_document_category('Admin only', array['Admin']::user_role[])$$, 'the smallest create names Admin alone');
select throws_ok($$select create_document_category('Nobody', array[]::user_role[])$$, '22023', null,
  'FR-DCV-003 a create that names no role is refused, not defaulted');
select throws_ok($$select create_document_category('invoice', array['Finance']::user_role[])$$, '23505', null,
  'a duplicate live name (case-insensitive) is refused');
select is((select array_agg(role::text order by role::text) from document_category_roles r join document_categories c on c.id = r.category_id
            where c.name = 'Invoice' and c.org_id = '02579000-0000-0000-0000-00000000000a'), array['Admin', 'Finance']::text[],
  'AC-DCV-008 Admin is always included in a created category');
select is((select org_id from document_categories where name = 'Invoice' and org_id = '02579000-0000-0000-0000-00000000000a'),
  '02579000-0000-0000-0000-00000000000a'::uuid, 'AC-DCV-010 the category org is the caller''s');
select throws_ok($$insert into document_categories (name) values ('Direct')$$, '42501', null,
  'no client write grant on document_categories');

-- ── fixture documents + files (as the table owner) ──────────────────────────────────────────────────
reset role;
insert into project_documents (id, org_id, project_id, category, title, status, author_id) values
  ('02579000-0000-0000-0000-000000000031', '02579000-0000-0000-0000-00000000000a', '02579000-0000-0000-0000-000000000020', 'Commercial approval', 'Commercial doc', 'Draft', '02579000-0000-0000-0000-0000000000a4'),
  ('02579000-0000-0000-0000-000000000032', '02579000-0000-0000-0000-00000000000a', '02579000-0000-0000-0000-000000000020', 'invoice', 'Invoice doc', 'Draft', '02579000-0000-0000-0000-0000000000a4'),
  ('02579000-0000-0000-0000-000000000033', '02579000-0000-0000-0000-00000000000a', '02579000-0000-0000-0000-000000000020', 'Drawing', 'Drawing doc', 'Draft', '02579000-0000-0000-0000-0000000000a4'),
  ('02579000-0000-0000-0000-000000000034', '02579000-0000-0000-0000-00000000000a', '02579000-0000-0000-0000-000000000020', 'Something unknown', 'Unknown doc', 'Draft', '02579000-0000-0000-0000-0000000000a4');
select is((select category from project_documents where id = '02579000-0000-0000-0000-000000000032'), 'Invoice',
  'AC-DCV-002 a text name resolves case-insensitively and the stored text is the category''s name');
select is((select c.name from project_documents d join document_categories c on c.id = d.category_id where d.id = '02579000-0000-0000-0000-000000000033'), 'Drawing',
  'AC-DCV-002 the text Drawing references the Drawing category');
select is((select category from project_documents where id = '02579000-0000-0000-0000-000000000034'), 'Other',
  'AC-DCV-002 an unknown text falls back to Other');
create temp table dcv_foreign as select id from document_categories where org_id = '02579000-0000-0000-0000-00000000000b' and name = 'Drawing';
grant select on dcv_foreign to authenticated;
insert into storage.objects (bucket_id, name, owner) values
  ('project-documents', '02579000-0000-0000-0000-00000000000a/02579000-0000-0000-0000-000000000020/02579000-0000-0000-0000-000000000031/c.pdf', '02579000-0000-0000-0000-0000000000a4'),
  ('project-documents', '02579000-0000-0000-0000-00000000000a/02579000-0000-0000-0000-000000000020/02579000-0000-0000-0000-000000000032/i.pdf', '02579000-0000-0000-0000-0000000000a4'),
  ('project-documents', '02579000-0000-0000-0000-00000000000a/02579000-0000-0000-0000-000000000020/02579000-0000-0000-0000-000000000033/d.pdf', '02579000-0000-0000-0000-0000000000a4');

-- ── AC-DCV-003 rows, AC-DCV-014 operator/assistant read path (the caller's JWT; no privilege skips RLS) ───
set local role authenticated;
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is((select array_agg(title order by title) from project_documents where project_id = '02579000-0000-0000-0000-000000000020' and id::text like '02579000-0000-0000-0000-00000000003_' and id <> '02579000-0000-0000-0000-000000000034'),
  array['Drawing doc'], 'AC-DCV-003 an Engineer sees only the Drawing document');
select is((select count(*)::int from project_documents where id = '02579000-0000-0000-0000-000000000032'), 0,
  'AC-DCV-003 the Invoice document by id returns no row for an Engineer');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from project_documents where id in ('02579000-0000-0000-0000-000000000031','02579000-0000-0000-0000-000000000032','02579000-0000-0000-0000-000000000033')), 3,
  'AC-DCV-003 Finance sees all three');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from project_documents where id in ('02579000-0000-0000-0000-000000000031','02579000-0000-0000-0000-000000000032')), 0,
  'AC-DCV-014 a Project Manager (an operator-tier role) gets neither the Invoice nor the Commercial approval document');
select is((select count(*)::int from project_documents where id = '02579000-0000-0000-0000-000000000033'), 1,
  'AC-DCV-014 a Project Manager still gets the Drawing document');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from project_documents where id in ('02579000-0000-0000-0000-000000000031','02579000-0000-0000-0000-000000000033')), 2,
  'AC-DCV-003 an Executive sees the Commercial approval and Drawing documents');
select is((select count(*)::int from project_documents where id = '02579000-0000-0000-0000-000000000032'), 0,
  'AC-DCV-003 an Executive is not an Invoice viewer (no implicit see-everything role)');

-- ── AC-DCV-004 / 005 storage ───────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'project-documents' and name like '%/02579000-0000-0000-0000-000000000032/%'), 0,
  'AC-DCV-004 an Engineer gets no object row for the Invoice file (so no signed link)');
select is((select count(*)::int from storage.objects where bucket_id = 'project-documents' and name like '%/02579000-0000-0000-0000-000000000033/%'), 1,
  'AC-DCV-004 an Engineer still gets the Drawing file');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'project-documents' and name like '%/02579000-0000-0000-0000-000000000032/%'), 1,
  'AC-DCV-004 Finance gets the Invoice file object');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'project-documents' and name like '%/02579000-0000-0000-0000-000000000031/%'), 0,
  'AC-DCV-004 a Project Manager gets no Commercial approval file');
set local storage.allow_delete_query = 'true';
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a5","role":"authenticated"}';
with changed as (update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id = 'project-documents' and name like '%/02579000-0000-0000-0000-000000000032/%' returning 1)
  select is((select count(*)::int from changed), 0, 'AC-DCV-005 an Engineer cannot overwrite the Invoice file');
with changed as (delete from storage.objects where bucket_id = 'project-documents' and name like '%/02579000-0000-0000-0000-000000000032/%' returning 1)
  select is((select count(*)::int from changed), 0, 'AC-DCV-005 an Engineer cannot delete the Invoice file');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'project-documents' and name like '%/02579000-0000-0000-0000-000000000032/%' and metadata is null), 1,
  'AC-DCV-005 the Invoice object is unchanged on read-back by Finance');

-- ── AC-DCV-006 filing and hidden writes ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$update project_documents set category_id = (select id from document_categories where name = 'Admin only') where id = '02579000-0000-0000-0000-000000000033'$$, '42501', null,
  'AC-DCV-006 a caller cannot file a document into a category their role cannot see');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select create_document_category('Old stuff', array['Finance']::user_role[])$$, 'setup: a custom category to archive');
reset role;
update project_documents set category_id = (select id from document_categories where name = 'Old stuff' and org_id = '02579000-0000-0000-0000-00000000000a') where id = '02579000-0000-0000-0000-000000000034';
select is((select category from project_documents where id = '02579000-0000-0000-0000-000000000034'), 'Old stuff',
  'setup: a document sits in a custom category before it is archived');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select archive_document_category((select id from document_categories where name = 'Old stuff'))$$, 'AC-DCV-011 an Admin archives a custom category');
select throws_ok($$update project_documents set category_id = (select id from document_categories where name = 'Old stuff') where id = '02579000-0000-0000-0000-000000000033'$$, '23514', null,
  'AC-DCV-006 filing into an archived category is refused');
select throws_ok($$update project_documents set category_id = (select id from dcv_foreign) where id = '02579000-0000-0000-0000-000000000033'$$, '23514', null,
  'AC-DCV-006 / AC-DCV-010 a category of another organisation cannot be referenced');
select throws_ok($$insert into project_documents (org_id, project_id, category_id, category, title) values ('02579000-0000-0000-0000-00000000000b', '02579000-0000-0000-0000-000000000020', (select id from dcv_foreign), 'Drawing', 'Foreign')$$, '23514', null,
  'AC-DCV-010 a client-supplied foreign org_id with a foreign category is refused');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a5","role":"authenticated"}';
with changed as (update project_documents set title = 'hijack' where id = '02579000-0000-0000-0000-000000000032' returning 1)
  select is((select count(*)::int from changed), 0, 'AC-DCV-006 an update of a hidden document affects zero rows');
with changed as (delete from project_documents where id = '02579000-0000-0000-0000-000000000032' returning 1)
  select is((select count(*)::int from changed), 0, 'AC-DCV-006 a delete of a hidden document affects zero rows');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select title from project_documents where id = '02579000-0000-0000-0000-000000000032'), 'Invoice doc',
  'AC-DCV-006 read-back by Admin shows the hidden document unchanged');
select is((select count(*)::int from project_documents where id in ('02579000-0000-0000-0000-000000000031','02579000-0000-0000-0000-000000000032','02579000-0000-0000-0000-000000000033')), 3,
  'AC-DCV-008 an Admin sees every fixture document regardless of rules');

-- ── AC-DCV-007 transition ──────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select transition_document_status('02579000-0000-0000-0000-000000000032', 'Issued')$$, 'P0002', 'document not found',
  'AC-DCV-007 a hidden document gives the not-found result');
select throws_ok($$select transition_document_status('02579000-0000-0000-0000-0000000000ff', 'Issued')$$, 'P0002', 'document not found',
  'AC-DCV-007 a nonexistent id gives the identical result');

-- ── AC-DCV-008 management rules ────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select set_document_category_roles((select id from document_categories where name = 'Invoice' and org_id = '02579000-0000-0000-0000-00000000000a'), array['Finance']::user_role[])$$, '23514', null,
  'AC-DCV-008 removing Admin from a category is refused');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select set_document_category_roles((select id from document_categories where name = 'Invoice' and org_id = '02579000-0000-0000-0000-00000000000a'), array['Admin','Project Manager']::user_role[])$$, '42501', null,
  'AC-DCV-008 a non-Admin cannot set viewer roles');
select throws_ok($$select create_document_category('PM made', array['Project Manager']::user_role[])$$, '42501', null,
  'AC-DCV-008 a non-Admin cannot create a category');

-- ── AC-DCV-009 atomic replace, effective on the next query ─────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select set_document_category_roles((select id from document_categories where name = 'Invoice' and org_id = '02579000-0000-0000-0000-00000000000a'), array['Admin','Executive']::user_role[])$$,
  'AC-DCV-009 an Admin replaces the viewer roles');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from project_documents where id = '02579000-0000-0000-0000-000000000032'), 0,
  'AC-DCV-009 Finance loses the Invoice document on the next query, no re-sign-in');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from project_documents where id = '02579000-0000-0000-0000-000000000032'), 1,
  'AC-DCV-009 an Executive now sees it');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select (detail -> 'from_roles') || (detail -> 'to_roles') from audit_events where action = 'document_category.roles' and org_id = '02579000-0000-0000-0000-00000000000a'),
  '["Finance","Admin","Executive","Admin"]'::jsonb, 'AC-DCV-009 the audit trail holds the old and new roles');
select is((select actor_id from audit_events where action = 'document_category.roles' and org_id = '02579000-0000-0000-0000-00000000000a'),
  '02579000-0000-0000-0000-0000000000a1'::uuid, 'AC-DCV-009 and the actor');
select set_document_category_roles((select id from document_categories where name = 'Invoice' and org_id = '02579000-0000-0000-0000-00000000000a'), array['Admin','Finance']::user_role[]);

-- ── AC-DCV-011 system categories ───────────────────────────────────────────────────────────────────
select throws_ok($$select rename_document_category((select id from document_categories where name = 'Drawing' and org_id = '02579000-0000-0000-0000-00000000000a'), 'Plans')$$, '42501', null,
  'AC-DCV-011 a system category cannot be renamed');
select throws_ok($$select archive_document_category((select id from document_categories where name = 'Reference' and org_id = '02579000-0000-0000-0000-00000000000a'))$$, '42501', null,
  'AC-DCV-011 a system category cannot be archived');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from document_categories where org_id = '02579000-0000-0000-0000-00000000000b'), 0,
  'AC-DCV-010 the category list of another organisation is not readable');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from project_documents where id = '02579000-0000-0000-0000-000000000034'), 1,
  'AC-DCV-011 an archived category keeps its rules for existing documents (Finance is a viewer)');
select throws_ok($$insert into project_documents (project_id, category_id, title) values ('02579000-0000-0000-0000-000000000020', (select id from document_categories where name = 'Old stuff' and org_id = '02579000-0000-0000-0000-00000000000a'), 'New in archived')$$, '23514', null,
  'AC-DCV-011 no new document can be filed in an archived category');

-- ── AC-DCV-013 revisions inherit; AC-DCV-012 lineage ───────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$insert into project_documents (id, project_id, title, parent_document_id) values ('02579000-0000-0000-0000-000000000041', '02579000-0000-0000-0000-000000000020', 'Invoice rev B', '02579000-0000-0000-0000-000000000032')$$,
  'AC-DCV-013 a revision with no category supplied is accepted');
select is((select category from project_documents where id = '02579000-0000-0000-0000-000000000041'), 'Invoice',
  'AC-DCV-013 and takes the parent''s category');
select throws_ok($$insert into project_documents (project_id, title, category, parent_document_id) values ('02579000-0000-0000-0000-000000000020', 'Sneaky', 'Drawing', '02579000-0000-0000-0000-000000000032')$$, '23514', null,
  'AC-DCV-013 a revision naming another category is refused with a field error');
select is((select count(*)::int from project_documents where title = 'Sneaky'), 0, 'AC-DCV-013 and no row is written');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$insert into project_documents (project_id, title, parent_document_id) values ('02579000-0000-0000-0000-000000000020', 'Peek', '02579000-0000-0000-0000-000000000032')$$, '23503', null,
  'FR-DCV-009 a revision of a document the caller cannot see is refused as a missing parent');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$insert into project_documents (project_id, title, parent_document_id) values ('02579000-0000-0000-0000-000000000020', 'Peek', '02579000-0000-0000-0000-000000000032')$$, '23503', null,
  'FR-DCV-009 a Project Manager cannot raise a revision of a document hidden from them');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$insert into project_documents (id, project_id, title, parent_document_id) values ('02579000-0000-0000-0000-000000000042', '02579000-0000-0000-0000-000000000020', 'Invoice rev C', '02579000-0000-0000-0000-000000000041')$$,
  'a third revision in the lineage');
-- Finance cannot see the target 'Admin only' category: nothing moves
select throws_ok($$select refile_document_lineage('02579000-0000-0000-0000-000000000042', (select id from document_categories where name = 'Admin only'))$$, '23514', null,
  'AC-DCV-012 a caller who cannot see the target category moves nothing');
select is((select count(*)::int from project_documents where category = 'Invoice' and id in ('02579000-0000-0000-0000-000000000032','02579000-0000-0000-0000-000000000041','02579000-0000-0000-0000-000000000042')), 3,
  'AC-DCV-012 and the lineage is where it was');
-- Finance edits every revision (all three authored by Finance); target Commercial approval is visible to Finance
select lives_ok($$select refile_document_lineage('02579000-0000-0000-0000-000000000042', (select id from document_categories where name = 'Commercial approval'))$$,
  'AC-DCV-012 an authorised caller re-files a lineage from any revision');
select is((select count(*)::int from project_documents where category = 'Commercial approval' and id in ('02579000-0000-0000-0000-000000000032','02579000-0000-0000-0000-000000000041','02579000-0000-0000-0000-000000000042')), 3,
  'AC-DCV-012 all three revisions moved');
-- a revision authored by someone else blocks a non-Admin re-file
reset role;
update project_documents set author_id = '02579000-0000-0000-0000-0000000000a3' where id = '02579000-0000-0000-0000-000000000041';
set local role authenticated;
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select refile_document_lineage('02579000-0000-0000-0000-000000000042', (select id from document_categories where name = 'Drawing' and org_id = '02579000-0000-0000-0000-00000000000a'))$$, 'P0002', null,
  'AC-DCV-012 a caller who cannot edit every revision moves nothing');
set local request.jwt.claims = '{"sub":"02579000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select refile_document_lineage('02579000-0000-0000-0000-000000000042', (select id from document_categories where name = 'Drawing' and org_id = '02579000-0000-0000-0000-00000000000a'))), 3,
  'AC-DCV-012 an Admin may edit every revision and re-files all three');

-- ── AC-DCV-023 rename propagates ───────────────────────────────────────────────────────────────────
select lives_ok($$select rename_document_category((select id from document_categories where name = 'Commercial approval' and org_id = '02579000-0000-0000-0000-00000000000a'), 'Commercial')$$,
  'AC-DCV-023 an Admin renames a custom category');
select is((select category from project_documents where id = '02579000-0000-0000-0000-000000000031'), 'Commercial',
  'AC-DCV-023 every document of the category stores the new text');
select is((select detail ->> 'from_name' || '>' || (detail ->> 'to_name') from audit_events where action = 'document_category.rename' and org_id = '02579000-0000-0000-0000-00000000000a'),
  'Commercial approval>Commercial', 'AC-DCV-023 the trail names the old and new name');

-- ── AC-DCV-015 notifications ───────────────────────────────────────────────────────────────────────
reset role;
select notify_workflow_user('02579000-0000-0000-0000-00000000000a', '02579000-0000-0000-0000-0000000000a5', 't', 'b', 'info', 'project_document', '02579000-0000-0000-0000-000000000031', 'Commercial doc');
select notify_workflow_user('02579000-0000-0000-0000-00000000000a', '02579000-0000-0000-0000-0000000000a4', 't', 'b', 'info', 'project_document', '02579000-0000-0000-0000-000000000031', 'Commercial doc');
select is((select count(*)::int from notifications where owner_id = '02579000-0000-0000-0000-0000000000a5'), 0,
  'AC-DCV-015 a recipient who cannot view the category gets no notification');
select is((select count(*)::int from notifications where owner_id = '02579000-0000-0000-0000-0000000000a4'), 1,
  'AC-DCV-015 a viewer gets one');

select * from finish();
rollback;
