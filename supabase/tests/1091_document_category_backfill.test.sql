-- 1091_document_category_backfill.test.sql — AC-DCV-001 parity at the upgrade: documents that exist BEFORE the change (free-text category,
-- no reference) get a category, keep their audience (every role), and keep the name they showed. The legacy shape is rebuilt inside this
-- transaction (reference column nullable, resolver off, text-only rows), then the backfill statements of 1165 run over it.
begin;
select plan(8);

insert into organizations (id, name) values ('02579000-0000-0000-0000-0000000000c1', 'DCV Backfill Org');
insert into auth.users (id, email) values ('02579000-0000-0000-0000-0000000000c2', 'dcv-backfill@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('02579000-0000-0000-0000-0000000000c2', '02579000-0000-0000-0000-0000000000c1', 'Backfill Admin', 'dcv-backfill@example.com', 'Admin');
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('02579000-0000-0000-0000-0000000000c3', '02579000-0000-0000-0000-0000000000c1', 'DCV-BF', 'Backfill project', 'Ongoing Project', '02579000-0000-0000-0000-0000000000c2');

-- the legacy shape
alter table project_documents alter column category_id drop not null;
alter table project_documents disable trigger project_documents_zc_category;
insert into project_documents (id, org_id, project_id, category, title, author_id) values
  ('02579000-0000-0000-0000-0000000000d1', '02579000-0000-0000-0000-0000000000c1', '02579000-0000-0000-0000-0000000000c3', 'Drawing', 'exact system name', '02579000-0000-0000-0000-0000000000c2'),
  ('02579000-0000-0000-0000-0000000000d2', '02579000-0000-0000-0000-0000000000c1', '02579000-0000-0000-0000-0000000000c3', ' report ', 'system name, other case and spaces', '02579000-0000-0000-0000-0000000000c2'),
  ('02579000-0000-0000-0000-0000000000d3', '02579000-0000-0000-0000-0000000000c1', '02579000-0000-0000-0000-0000000000c3', 'Legacy Spec Pack', 'a name only the register ever used', '02579000-0000-0000-0000-0000000000c2'),
  ('02579000-0000-0000-0000-0000000000d4', '02579000-0000-0000-0000-0000000000c1', '02579000-0000-0000-0000-0000000000c3', 'legacy spec pack', 'the same custom name in another case', '02579000-0000-0000-0000-0000000000c2'),
  ('02579000-0000-0000-0000-0000000000d5', '02579000-0000-0000-0000-0000000000c1', '02579000-0000-0000-0000-0000000000c3', '', 'a blank name', '02579000-0000-0000-0000-0000000000c2'),
  ('02579000-0000-0000-0000-0000000000d6', '02579000-0000-0000-0000-0000000000c1', '02579000-0000-0000-0000-0000000000c3', 'Reference', 'a folder reference label', '02579000-0000-0000-0000-0000000000c2');
update project_documents set category_id = null where org_id = '02579000-0000-0000-0000-0000000000c1';

-- the backfill statements of 1165, verbatim
insert into public.document_categories (org_id, name, sort_order)
select d.org_id, min(btrim(d.category)), 1000 + (row_number() over (partition by d.org_id order by lower(btrim(d.category))))::int * 10
  from public.project_documents d
 where btrim(d.category) <> ''
   and not exists (select 1 from public.document_categories c
                    where c.org_id = d.org_id and lower(c.name) = lower(btrim(d.category)) and c.archived_at is null)
 group by d.org_id, lower(btrim(d.category));
insert into public.document_category_roles (category_id, org_id, role)
select c.id, c.org_id, r from public.document_categories c cross join unnest(enum_range(null::public.user_role)) r
 where not exists (select 1 from public.document_category_roles x where x.category_id = c.id)
on conflict do nothing;
update public.project_documents d
   set category_id = c.id, category = c.name
  from public.document_categories c
 where c.org_id = d.org_id and c.archived_at is null
   and lower(c.name) = case when btrim(d.category) = '' then 'other' else lower(btrim(d.category)) end;

select is((select count(*)::int from project_documents where org_id = '02579000-0000-0000-0000-0000000000c1' and category_id is null), 0,
  'AC-DCV-001 every pre-existing document has a category after the backfill');
select is((select category from project_documents where id = '02579000-0000-0000-0000-0000000000d1'), 'Drawing', 'AC-DCV-001 an exact system name stays');
select is((select category from project_documents where id = '02579000-0000-0000-0000-0000000000d2'), 'Report', 'AC-DCV-001 a system name in another case or with spaces resolves to the system category');
select is((select count(distinct category_id)::int from project_documents where id in ('02579000-0000-0000-0000-0000000000d3', '02579000-0000-0000-0000-0000000000d4')), 1,
  'AC-DCV-001 a free-text name used in two cases becomes ONE custom category');
select is((select c.is_system from project_documents d join document_categories c on c.id = d.category_id where d.id = '02579000-0000-0000-0000-0000000000d3'), false,
  'AC-DCV-001 a name the register alone used is a custom category, not a system one');
select is((select category from project_documents where id = '02579000-0000-0000-0000-0000000000d5'), 'Other', 'AC-DCV-001 a blank name falls back to Other');
select is((select c.is_system from project_documents d join document_categories c on c.id = d.category_id where d.id = '02579000-0000-0000-0000-0000000000d6'), true,
  'OD-DCV-11 Reference is the system category, not a discovered custom one');
select is((select count(*)::int from document_categories c where c.org_id = '02579000-0000-0000-0000-0000000000c1'
            and (select count(*) from document_category_roles r where r.category_id = c.id) <> 5), 0,
  'AC-DCV-001 every category, discovered ones included, lists all five roles so no one''s access changes');

select * from finish();
rollback;
