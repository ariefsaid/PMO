begin;
select no_plan();

insert into public.organizations (id,name) values
 ('10200000-0000-0000-0000-000000000001','Synthetic procurement org');
insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000102','m365-procurement@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000102','10200000-0000-0000-0000-000000000001','Synthetic actor','m365-procurement@example.invalid','Project Manager','active');
insert into public.procurements (id,org_id,title,project_id,status) values
 ('10200000-0000-0000-0000-000000000203','10200000-0000-0000-0000-000000000001','Synthetic overhead',null,'Draft');
insert into public.procurement_documents (id,org_id,procurement_id,type,link) values
 ('10200000-0000-0000-0000-000000000301','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000203','Legacy link','https://example.invalid/legacy');

select ok(not exists(select 1 from information_schema.columns where table_schema='public'
 and table_name='procurement_documents' and column_name='ms_web_url'),
 'AC-M365DOC-051 procurement reuses link instead of duplicating the URL');
select ok((select source is null from public.procurement_documents
 where id='10200000-0000-0000-0000-000000000301'),
 'AC-M365DOC-051 legacy plain URL stays unclassified');
select is((select link from public.procurement_documents where id='10200000-0000-0000-0000-000000000301'),
 'https://example.invalid/legacy','AC-M365DOC-051 legacy URL bytes are unchanged');
select is((select status::text from public.procurements where id='10200000-0000-0000-0000-000000000203'),
 'Draft','AC-M365DOC-051 evidence does not transition the procurement case');

select lives_ok($$insert into public.procurement_documents
 (id,org_id,procurement_id,type,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 values ('10200000-0000-0000-0000-000000000302','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000203','Microsoft reference','https://example.invalid/file',
 'onedrive','drive-a','file-a','Evidence file','file','10200000-0000-0000-0000-000000000102',now())$$,
 'AC-M365DOC-051 complete file reference can belong to an overhead case');
select lives_ok($$insert into public.procurement_documents
 (id,org_id,procurement_id,type,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 values ('10200000-0000-0000-0000-000000000303','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000203','Microsoft reference','https://example.invalid/folder',
 'onedrive','drive-a','folder-a','Evidence folder','folder','10200000-0000-0000-0000-000000000102',now())$$,
 'AC-M365DOC-051 multiple file and folder refs coexist on a case');
select throws_ok($$insert into public.procurement_documents
 (id,org_id,procurement_id,type,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000203','Microsoft reference','https://example.invalid/bad',
 'upload','drive-b','file-b','Bad source','file','10200000-0000-0000-0000-000000000102',now())$$,
 '23514',null,'AC-M365DOC-051 procurement rejects upload source');

select * from finish();
rollback;
