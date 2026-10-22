begin;
select plan(11);
insert into auth.users(id,email) values
('03480000-0000-0000-0000-000000000001','metadata-author@example.com'),
('03480000-0000-0000-0000-000000000002','metadata-finance@example.com'),
('03480000-0000-0000-0000-000000000003','metadata-executive@example.com'),
('03480000-0000-0000-0000-000000000004','metadata-admin@example.com'),
('03480000-0000-0000-0000-000000000005','metadata-engineer@example.com');
insert into profiles(id,org_id,full_name,email,role) values
('03480000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Author','metadata-author@example.com','Project Manager'),
('03480000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Finance','metadata-finance@example.com','Finance'),
('03480000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Executive','metadata-executive@example.com','Executive'),
('03480000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','Admin','metadata-admin@example.com','Admin'),
('03480000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','Engineer','metadata-engineer@example.com','Engineer');
insert into projects(id,org_id,code,name,status,project_manager_id) values
('03480000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','0348','Metadata guard','Ongoing Project','03480000-0000-0000-0000-000000000001');
insert into project_documents(id,org_id,project_id,title,category,author_id) values
('03480000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','03480000-0000-0000-0000-000000000010','Original','Drawing','03480000-0000-0000-0000-000000000001');
insert into procurements(id,org_id,title,status,requested_by_id) values
('03480000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','Draft request','Draft','03480000-0000-0000-0000-000000000001'),
('03480000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','Approved request','Approved','03480000-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03480000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$update project_documents set title='Author edit' where id='03480000-0000-0000-0000-000000000011'$$,'AC-SEC-201 document metadata edit requires author or Admin: author succeeds');
select lives_ok($$update procurements set title='Draft edited' where id='03480000-0000-0000-0000-000000000020'$$,'AC-SEC-202 procurement requester edits Draft header');
select throws_ok($$update procurements set title='Changed approved' where id='03480000-0000-0000-0000-000000000021'$$,'42501',null,'AC-SEC-202 procurement requester cannot edit Approved header');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03480000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$update project_documents set title='Finance edit' where id='03480000-0000-0000-0000-000000000011'$$,'42501',null,'AC-SEC-201 document metadata edit requires author or Admin: Finance denied');
select is((select title from project_documents where id='03480000-0000-0000-0000-000000000011'),'Author edit','AC-SEC-201 denied document metadata edit leaves row unchanged');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03480000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$update project_documents set title='Executive edit' where id='03480000-0000-0000-0000-000000000011'$$,'42501',null,'AC-SEC-201 document metadata edit requires author or Admin: Executive denied');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03480000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok($$update project_documents set title='Admin edit' where id='03480000-0000-0000-0000-000000000011'$$,'AC-SEC-201 document metadata edit requires author or Admin: Admin succeeds');
select throws_ok($$update procurements set title='Admin changed approved' where id='03480000-0000-0000-0000-000000000021'$$,'42501',null,'AC-SEC-202 approved procurement header remains frozen for Admin');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03480000-0000-0000-0000-000000000005","role":"authenticated"}';
select lives_ok($$update project_documents set title='Engineer edit' where id='03480000-0000-0000-0000-000000000011'$$,'AC-SEC-201 Engineer update remains hidden by row policy');
reset role;
select is((select title from procurements where id='03480000-0000-0000-0000-000000000021'),'Approved request','AC-SEC-202 denied approved header edit leaves row unchanged');
select is((select count(*)::int from information_schema.column_privileges where table_schema='public' and table_name='project_documents' and grantee='authenticated' and column_name='author_id' and privilege_type='UPDATE'),0,'AC-SEC-201 author_id is not client-updatable');
select * from finish();
rollback;
