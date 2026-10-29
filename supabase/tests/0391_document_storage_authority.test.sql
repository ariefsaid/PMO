begin;
select plan(17);
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


insert into auth.users (id,email) values
 ('00670000-0000-0000-0000-0000000000a3','storage-finance@example.com'),
 ('00670000-0000-0000-0000-0000000000a4','storage-admin@example.com'),
 ('00670000-0000-0000-0000-0000000000a5','storage-inactive@example.com');
insert into profiles (id,org_id,full_name,email,role,status) values
 ('00670000-0000-0000-0000-0000000000a3','00670000-0000-0000-0000-000000000001','Finance','storage-finance@example.com','Finance','active'),
 ('00670000-0000-0000-0000-0000000000a4','00670000-0000-0000-0000-000000000001','Admin','storage-admin@example.com','Admin','active'),
 ('00670000-0000-0000-0000-0000000000a5','00670000-0000-0000-0000-000000000001','Inactive','storage-inactive@example.com','Admin','disabled');
insert into project_documents (id,org_id,project_id,category,title,status,author_id) values
 ('00670000-0000-0000-0000-000000000032','00670000-0000-0000-0000-000000000001','00670000-0000-0000-0000-000000000020','Drawing','Other Draft','Draft','00670000-0000-0000-0000-0000000000a3'),
 ('00670000-0000-0000-0000-000000000033','00670000-0000-0000-0000-000000000001','00670000-0000-0000-0000-000000000020','Drawing','Engineer Draft','Draft','00670000-0000-0000-0000-0000000000a2');
set local storage.allow_delete_query = 'true';
set local role authenticated;

set local request.jwt.claims = '{"sub":"00670000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/finance.pdf')$$, '42501', null, 'finance insert authorization');
with changed as (update storage.objects set metadata = '{"changed":true}'::jsonb where bucket_id='project-documents' and name='00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/test.pdf' returning 1) select is((select count(*)::int from changed), 0, 'finance update authorization');
with changed as (delete from storage.objects where bucket_id='project-documents' and name='00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/test.pdf' returning 1) select is((select count(*)::int from changed), 0, 'finance delete authorization');
reset role; insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/test.pdf') on conflict (bucket_id,name) do nothing; set local role authenticated;
set local request.jwt.claims = '{"sub":"00670000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/author.pdf')$$, 'author insert authorization');
select throws_ok($$insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000099/00670000-0000-0000-0000-000000000030/wrong-project.pdf')$$,'42501',null,'author upload requires matching project');
select throws_ok($$insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/nested/file.pdf')$$,'42501',null,'author upload requires canonical path shape');
select throws_ok($$update storage.objects set name='00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000032/moved.pdf' where name='00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/test.pdf'$$,'42501',null,'author update requires authority over destination');

with changed as (update storage.objects set metadata = '{"changed":true}'::jsonb where bucket_id='project-documents' and name='00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/test.pdf' returning 1) select is((select count(*)::int from changed), 1, 'author update authorization');
with changed as (delete from storage.objects where bucket_id='project-documents' and name='00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/test.pdf' returning 1) select is((select count(*)::int from changed), 1, 'author delete authorization');
reset role; insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/test.pdf'); set local role authenticated;
set local request.jwt.claims = '{"sub":"00670000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/admin.pdf')$$, 'admin insert authorization');
with changed as (update storage.objects set metadata = '{"changed":true}'::jsonb where bucket_id='project-documents' and name='00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/test.pdf' returning 1) select is((select count(*)::int from changed), 1, 'admin update authorization');
with changed as (delete from storage.objects where bucket_id='project-documents' and name='00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/test.pdf' returning 1) select is((select count(*)::int from changed), 1, 'admin delete authorization');
set local request.jwt.claims = '{"sub":"00670000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/inactive.pdf')$$, '42501', null, 'inactive insert authorization');
set local request.jwt.claims = '{"sub":"00670000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/engineer.pdf')$$, '42501', null, 'engineer insert authorization');
select throws_ok($$insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000033/engineer-own.pdf')$$, '42501', null, 'author upload requires a writer role');
set local request.jwt.claims = '{"sub":"00670000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000030/foreign.pdf')$$, '42501', null, 'foreign insert authorization');
set local request.jwt.claims = '{"sub":"00670000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$insert into storage.objects (bucket_id,name) values ('project-documents','00670000-0000-0000-0000-000000000001/00670000-0000-0000-0000-000000000020/00670000-0000-0000-0000-000000000031/issued.pdf')$$,'42501',null,'issued document insert authorization');
select * from finish();
rollback;
