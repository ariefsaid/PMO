begin;
select no_plan();
-- Synthetic fixtures: one org with a writer, a second writer, an engineer and a disabled member; a second org.
insert into public.organizations (id,name) values
 ('10200000-0000-0000-0000-000000000031','Synthetic shared org'),
 ('10200000-0000-0000-0000-000000000032','Synthetic foreign org');
insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000131','shared-pm@example.invalid'),
 ('10200000-0000-0000-0000-000000000132','shared-eng@example.invalid'),
 ('10200000-0000-0000-0000-000000000133','shared-off@example.invalid'),
 ('10200000-0000-0000-0000-000000000134','shared-foreign-pm@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000131','10200000-0000-0000-0000-000000000031','Synthetic writer','shared-pm@example.invalid','Project Manager','active'),
 ('10200000-0000-0000-0000-000000000132','10200000-0000-0000-0000-000000000031','Synthetic engineer','shared-eng@example.invalid','Engineer','active'),
 ('10200000-0000-0000-0000-000000000133','10200000-0000-0000-0000-000000000031','Synthetic disabled','shared-off@example.invalid','Project Manager','disabled'),
 ('10200000-0000-0000-0000-000000000134','10200000-0000-0000-0000-000000000032','Synthetic foreign writer','shared-foreign-pm@example.invalid','Project Manager','active');
insert into public.projects (id,org_id,code,name,status) values
 ('10200000-0000-0000-0000-000000000231','10200000-0000-0000-0000-000000000031','SHR-1','Synthetic first','Ongoing Project'),
 ('10200000-0000-0000-0000-000000000232','10200000-0000-0000-0000-000000000031','SHR-2','Synthetic second','Ongoing Project'),
 ('10200000-0000-0000-0000-000000000233','10200000-0000-0000-0000-000000000032','SHR-X','Synthetic foreign','Ongoing Project'),
 ('10200000-0000-0000-0000-000000000234','10200000-0000-0000-0000-000000000031','SHR-3','Synthetic third','Ongoing Project');
insert into public.procurements (id,org_id,title,project_id,status) values
 ('10200000-0000-0000-0000-000000000241','10200000-0000-0000-0000-000000000031','Synthetic case one',null,'Draft'),
 ('10200000-0000-0000-0000-000000000242','10200000-0000-0000-0000-000000000031','Synthetic case two',null,'Draft');
insert into public.org_m365_document_settings(org_id,default_site_id,default_site_name,default_drive_id,default_drive_name,updated_by)
 values ('10200000-0000-0000-0000-000000000031','synthetic-site','Synthetic site','synthetic-drive','Synthetic library','10200000-0000-0000-0000-000000000131'),
        ('10200000-0000-0000-0000-000000000032','synthetic-site','Synthetic site','synthetic-drive','Synthetic library','10200000-0000-0000-0000-000000000134');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000131","role":"authenticated"}';
select is((select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000231',
 '{"drive_id":"synthetic-drive","item_id":"shared-item","web_url":"https://example.invalid/shared","name":"SHR-1 Synthetic first","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))->>'state'),
 'linked','AC-M365DOC-069 the first project links the folder');
select is((select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000232',
 '{"drive_id":"synthetic-drive","item_id":"shared-item","web_url":"https://example.invalid/shared","name":"SHR-1 Synthetic first","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))->>'state'),
 'needs_choice','AC-M365DOC-069 a folder linked to another project is refused with a safe needs_choice state');
select is((select count(*)::integer from public.project_documents where ms_item_id='shared-item'),1,
 'AC-M365DOC-069 the refused shared link inserted nothing');
select is((select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000231',
 '{"drive_id":"synthetic-drive","item_id":"shared-item","web_url":"https://example.invalid/shared","name":"SHR-1 Synthetic first","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))->>'state'),
 'already_linked','AC-M365DOC-069 the owning project still gets already_linked');
select is((select public.m365_link_record_folder('procurement','10200000-0000-0000-0000-000000000241',
 '{"drive_id":"synthetic-drive","item_id":"shared-case-item","web_url":"https://example.invalid/case","name":"Synthetic case one","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))->>'state'),
 'linked','AC-M365DOC-069 the first case links the folder');
select is((select public.m365_link_record_folder('procurement','10200000-0000-0000-0000-000000000242',
 '{"drive_id":"synthetic-drive","item_id":"shared-case-item","web_url":"https://example.invalid/case","name":"Synthetic case one","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))->>'state'),
 'needs_choice','AC-M365DOC-069 a folder linked to another case is refused with needs_choice');
select is((select count(*)::integer from public.procurement_documents where ms_item_id='shared-case-item'),1,
 'AC-M365DOC-069 the refused shared case link inserted nothing');
-- A different drive with the same item id is a different folder.
select is((select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000232',
 '{"drive_id":"other-drive","item_id":"shared-item","web_url":"https://example.invalid/other","name":"SHR-2 Synthetic second","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))->>'state'),
 'linked','AC-M365DOC-069 the shared check is keyed by drive AND item');

-- Negatives (RF-15): cross-org record, non-writer role, inactive member.
select throws_ok($$select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000233',
 '{"drive_id":"synthetic-drive","item_id":"x-org-item","web_url":"https://example.invalid/x","name":"SHR-X Synthetic foreign","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))$$,'42501',null,
 'AC-M365DOC-069 a record in another org is refused');
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000132","role":"authenticated"}';
select throws_ok($$select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000231',
 '{"drive_id":"synthetic-drive","item_id":"eng-item","web_url":"https://example.invalid/e","name":"SHR-1 Synthetic first","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))$$,'42501',null,
 'AC-M365DOC-069 a non-writer role is refused');
select throws_ok($$select * from public.m365_record_folder_candidates('project',null)$$,'42501',null,
 'AC-M365DOC-072 candidates are Admin-only: a non-Admin is refused');
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000133","role":"authenticated"}';
select throws_ok($$select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000231',
 '{"drive_id":"synthetic-drive","item_id":"off-item","web_url":"https://example.invalid/o","name":"SHR-1 Synthetic first","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))$$,'42501',null,
 'AC-M365DOC-069 a disabled member is refused');
reset role;
select is((select count(*)::integer from public.project_documents where ms_item_id in ('x-org-item','eng-item','off-item')),0,
 'AC-M365DOC-069 refused links wrote nothing');
-- Helper contract (L2/L4): writer-only, org-scoped, not reachable by anon.
select ok(not has_function_privilege('anon','public.m365_folder_linked_elsewhere(text,uuid,text,text)','execute'),
 'AC-M365DOC-069 anon cannot execute the shared-folder helper');
select ok(has_function_privilege('authenticated','public.m365_folder_linked_elsewhere(text,uuid,text,text)','execute'),
 'AC-M365DOC-069 authenticated callers can execute the shared-folder helper (it answers false unless they are writers)');
-- The foreign org's writer links a folder that exists only in the foreign org.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000134","role":"authenticated"}';
select is((select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000233',
 '{"drive_id":"synthetic-drive","item_id":"foreign-only-item","web_url":"https://example.invalid/f","name":"SHR-X Synthetic foreign","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))->>'state'),
 'linked','AC-M365DOC-069 the foreign org writer links its own folder');
select is(public.m365_folder_linked_elsewhere('project','10200000-0000-0000-0000-000000000233','synthetic-drive','shared-item'),false,
 'AC-M365DOC-069 a writer in org B learns nothing about org A links (same drive and item ids)');
-- A writer in org A: the foreign link is invisible, the guard is org scoped, own-org links are still seen.
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000131","role":"authenticated"}';
select is(public.m365_folder_linked_elsewhere('project','10200000-0000-0000-0000-000000000232','synthetic-drive','shared-item'),true,
 'AC-M365DOC-069 a writer sees that a folder is linked to another record of their org');
select is(public.m365_folder_linked_elsewhere('project','10200000-0000-0000-0000-000000000232','synthetic-drive','foreign-only-item'),false,
 'AC-M365DOC-069 a folder linked only in another org does not count as linked elsewhere');
select is((select public.m365_link_record_folder('project','10200000-0000-0000-0000-000000000234',
 '{"drive_id":"synthetic-drive","item_id":"foreign-only-item","web_url":"https://example.invalid/f","name":"SHR-2 Synthetic second","item_kind":"folder"}',
 'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings))->>'state'),
 'linked','AC-M365DOC-069 the shared guard is org scoped: org A can link a folder id that org B also linked');
-- A non-writer role and an inactive member get false, never the real answer.
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000132","role":"authenticated"}';
select is(public.m365_folder_linked_elsewhere('project','10200000-0000-0000-0000-000000000232','synthetic-drive','shared-item'),false,
 'AC-M365DOC-069 a non-writer role gets false from the helper (reveals nothing)');
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000133","role":"authenticated"}';
select is(public.m365_folder_linked_elsewhere('project','10200000-0000-0000-0000-000000000232','synthetic-drive','shared-item'),false,
 'AC-M365DOC-069 a disabled member gets false from the helper');
reset role;
set local role anon;
select throws_ok($$select public.m365_folder_linked_elsewhere('project','10200000-0000-0000-0000-000000000232','synthetic-drive','shared-item')$$,'42501',null,
 'AC-M365DOC-069 anon calling the helper directly is refused');
reset role;
select * from finish();
rollback;
