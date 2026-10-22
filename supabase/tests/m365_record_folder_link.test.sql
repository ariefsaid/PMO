begin;
select no_plan();
insert into public.organizations (id,name) values ('10200000-0000-0000-0000-000000000001','Synthetic folder org');
insert into auth.users (id,email) values ('10200000-0000-0000-0000-000000000101','folder@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000101','10200000-0000-0000-0000-000000000001','Synthetic writer','folder@example.invalid','Project Manager','active');
insert into public.projects (id,org_id,code,name,status) values
 ('10200000-0000-0000-0000-000000000201','10200000-0000-0000-0000-000000000001','SYN-1','Synthetic project','Ongoing Project'),
 ('10200000-0000-0000-0000-000000000203','10200000-0000-0000-0000-000000000001','SYN-2','Synthetic stale project','Ongoing Project');
insert into public.procurements (id,org_id,title,project_id,status) values
 ('10200000-0000-0000-0000-000000000202','10200000-0000-0000-0000-000000000001','Synthetic case',null,'Draft');
insert into public.org_m365_document_settings(org_id,default_site_id,default_site_name,default_drive_id,default_drive_name,updated_by)
 values ('10200000-0000-0000-0000-000000000001','synthetic-site','Synthetic site','synthetic-drive','Synthetic library','10200000-0000-0000-0000-000000000101');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000101","role":"authenticated"}';
select lives_ok($$select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000201',
 '{"drive_id":"synthetic-drive","item_id":"synthetic-item","web_url":"https://example.invalid/folder","name":"SYN-1 Synthetic project","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))$$,
 'AC-M365DOC-069 caller writer can link a project folder');
select is((select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000201',
 '{"drive_id":"synthetic-drive","item_id":"synthetic-item","web_url":"https://example.invalid/folder","name":"SYN-1 Synthetic project","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))->>'state'),
 'already_linked','AC-M365DOC-069 repeat returns the pre-existing row without another insert');
select is((select count(*)::integer from public.project_documents where project_id='10200000-0000-0000-0000-000000000201' and ms_item_kind='folder'),1,
 'AC-M365DOC-069 repeated ensure has one typed folder row');
select is((select status from public.project_documents where project_id='10200000-0000-0000-0000-000000000201' and ms_item_kind='folder'),'Draft',
 'AC-M365DOC-069 folder reference remains Draft');
select lives_ok($$select public.m365_link_record_folder('procurement','10200000-0000-0000-0000-000000000202',
 '{"drive_id":"synthetic-drive","item_id":"synthetic-case-item","web_url":"https://example.invalid/case","name":"Synthetic case","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))$$,
 'AC-M365DOC-069 overhead procurement case folder links');
select is((select type from public.procurement_documents where procurement_id='10200000-0000-0000-0000-000000000202' and ms_item_kind='folder'),'Microsoft reference',
 'AC-M365DOC-069 procurement link uses canonical type');
select throws_ok($$select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000201',
 '{"drive_id":"synthetic-drive","item_id":"forged-item","web_url":"https://example.invalid/folder","name":"Synthetic","item_kind":"folder","org_id":"10200000-0000-0000-0000-000000000001"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))$$,'22023',null,
 'AC-M365DOC-070 extra reference claims are rejected');
select throws_ok($$select public.m365_link_record_folder('budget','10200000-0000-0000-0000-000000000201','{}'::jsonb,
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))$$,'22023',null,
 'AC-M365DOC-070 unsupported typed parent is rejected');
select throws_ok($$select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000203',
 '{"drive_id":"synthetic-drive","item_id":"stale-item","web_url":"https://example.invalid/stale","name":"Synthetic stale","item_kind":"folder"}',
 'synthetic-site','synthetic-drive','2000-01-01T00:00:00Z'::timestamptz)$$,'23514',null,
 'AC-M365DOC-069 stale settings snapshot is refused');
reset role;
select * from finish();
rollback;
