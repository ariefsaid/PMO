begin;
select plan(24);
insert into auth.users(id,email) values
('03480000-0000-0000-0000-000000000001','metadata-author@example.com'),
('03480000-0000-0000-0000-000000000002','metadata-finance@example.com'),
('03480000-0000-0000-0000-000000000003','metadata-executive@example.com'),
('03480000-0000-0000-0000-000000000004','metadata-admin@example.com'),
('03480000-0000-0000-0000-000000000005','metadata-engineer@example.com'),
('03480000-0000-0000-0000-000000000006','metadata-manager@example.com');
insert into profiles(id,org_id,full_name,email,role) values
('03480000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Author','metadata-author@example.com','Project Manager'),
('03480000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Finance','metadata-finance@example.com','Finance'),
('03480000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Executive','metadata-executive@example.com','Executive'),
('03480000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','Admin','metadata-admin@example.com','Admin'),
('03480000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','Engineer','metadata-engineer@example.com','Engineer'),
('03480000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','Manager','metadata-manager@example.com','Project Manager');
insert into projects(id,org_id,code,name,status,project_manager_id) values
('03480000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','0348','Metadata guard','Ongoing Project','03480000-0000-0000-0000-000000000001');
insert into project_documents(id,org_id,project_id,title,category,author_id) values
('03480000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','03480000-0000-0000-0000-000000000010','Original','Drawing','03480000-0000-0000-0000-000000000001');
insert into procurements(id,org_id,title,code,status,requested_by_id) values
('03480000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','Draft request','PR-DRAFT','Draft','03480000-0000-0000-0000-000000000001'),
('03480000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','Rejected request','PR-REJECTED','Rejected','03480000-0000-0000-0000-000000000001'),
('03480000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001','Approved request','PR-APPROVED','Approved','03480000-0000-0000-0000-000000000001'),
('03480000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000001','Admin draft request','PR-ADMIN-DRAFT','Draft','03480000-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03480000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$update project_documents set title='Author edit' where id='03480000-0000-0000-0000-000000000011'$$,'AC-SEC-201 document metadata edit requires author or Admin: author succeeds');
select throws_ok($$update project_documents set author_id='03480000-0000-0000-0000-000000000002' where id='03480000-0000-0000-0000-000000000011'$$,'42501',null,'AC-SEC-201 caller cannot change document author_id');
select lives_ok($$update procurements set title='Draft edited',code='PR-DRAFT-EDITED' where id='03480000-0000-0000-0000-000000000020'$$,'AC-SEC-202 procurement requester edits Draft header');
select lives_ok($$update procurements set title='Rejected edited',vendor_id=null where id='03480000-0000-0000-0000-000000000021'$$,'AC-SEC-202 procurement requester edits Rejected header');
select throws_ok($$update procurements set title='Changed approved' where id='03480000-0000-0000-0000-000000000022'$$,'42501',null,'AC-SEC-202 procurement requester cannot edit Approved header');
select lives_ok($$select public.transition_procurement('03480000-0000-0000-0000-000000000020','Requested')$$,'AC-SEC-202 procurement lifecycle transition remains available');
select lives_ok($$select public.transition_document_status('03480000-0000-0000-0000-000000000011','Issued')$$,'AC-SEC-201 document status RPC remains available');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03480000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$update project_documents set title='Finance edit' where id='03480000-0000-0000-0000-000000000011'$$,'42501',null,'AC-SEC-201 document metadata edit requires author or Admin: Finance denied');
select is((select title from project_documents where id='03480000-0000-0000-0000-000000000011'),'Author edit','AC-SEC-201 denied document metadata edit leaves row unchanged');
select throws_ok($$update procurements set title='Finance draft edit' where id='03480000-0000-0000-0000-000000000023'$$,'42501',null,'AC-SEC-202 Finance cannot edit another requester Draft header');
select throws_ok($$update procurements set title='Finance approved edit' where id='03480000-0000-0000-0000-000000000022'$$,'42501',null,'AC-SEC-202 Finance cannot edit Approved header');
select is((select title from procurements where id='03480000-0000-0000-0000-000000000022'),'Approved request','AC-SEC-202 denied Finance header edit leaves row unchanged');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03480000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$update project_documents set title='Executive edit' where id='03480000-0000-0000-0000-000000000011'$$,'42501',null,'AC-SEC-201 document metadata edit requires author or Admin: Executive denied');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03480000-0000-0000-0000-000000000006","role":"authenticated"}';
select throws_ok($$update procurements set code='PR-CHANGED' where id='03480000-0000-0000-0000-000000000022'$$,'42501',null,'AC-SEC-202 Project Manager cannot edit Approved procurement code');
select is((select code from procurements where id='03480000-0000-0000-0000-000000000022'),'PR-APPROVED','AC-SEC-202 denied Project Manager header edit leaves row unchanged');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03480000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok($$update project_documents set title='Admin edit' where id='03480000-0000-0000-0000-000000000011'$$,'AC-SEC-201 document metadata edit requires author or Admin: Admin succeeds');
select lives_ok($$update procurements set title='Admin draft edit' where id='03480000-0000-0000-0000-000000000023'$$,'AC-SEC-202 procurement Admin edits another requester Draft header');
select throws_ok($$update procurements set title='Admin changed approved' where id='03480000-0000-0000-0000-000000000022'$$,'42501',null,'AC-SEC-202 approved procurement header remains frozen for Admin');
select is((select title from procurements where id='03480000-0000-0000-0000-000000000022'),'Approved request','AC-SEC-202 Admin denial leaves Approved header unchanged');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03480000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from project_documents where id='03480000-0000-0000-0000-000000000011'),1,'AC-SEC-201 Engineer can read the document row');
select lives_ok($$update project_documents set title='Engineer edit' where id='03480000-0000-0000-0000-000000000011'$$,'AC-SEC-201 Engineer metadata update affects no row');
reset role;
select is((select title from project_documents where id='03480000-0000-0000-0000-000000000011'),'Admin edit','AC-SEC-201 Engineer update leaves metadata unchanged');
reset role;
select is((select count(*)::int from information_schema.column_privileges where table_schema='public' and table_name='project_documents' and grantee='authenticated' and column_name='author_id' and privilege_type='UPDATE'),0,'AC-SEC-201 author_id is not client-updatable');
select is((select count(*)::int from information_schema.column_privileges where table_schema='public' and table_name='procurements' and grantee='authenticated' and column_name in ('title','code','vendor_id') and privilege_type='UPDATE'),3,'AC-SEC-202 guarded procurement header grants are enumerated');
select * from finish();
rollback;
