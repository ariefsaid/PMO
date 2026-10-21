begin;
select no_plan();
insert into public.organizations(id,name) values ('10200000-0000-0000-0000-000000000011','Synthetic receipt org');
insert into auth.users(id,email) values ('10200000-0000-0000-0000-000000000111','receipt@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000111','10200000-0000-0000-0000-000000000011','Synthetic admin','receipt@example.invalid','Admin','active');
insert into public.projects(id,org_id,name,status) values
 ('10200000-0000-0000-0000-000000000211','10200000-0000-0000-0000-000000000011','Synthetic project','Ongoing Project');
insert into public.org_m365_document_settings(org_id,default_site_id,default_site_name,default_drive_id,default_drive_name,updated_by)
values ('10200000-0000-0000-0000-000000000011','synthetic-site','Synthetic site','synthetic-drive','Synthetic library','10200000-0000-0000-0000-000000000111');
select ok(not has_function_privilege('anon','public.m365_record_folder_created(uuid,text,uuid,text,text)','execute'),
 'AC-M365DOC-073 anon cannot issue creation receipts');
select ok(not has_function_privilege('authenticated','public.m365_record_folder_created(uuid,text,uuid,text,text)','execute'),
 'AC-M365DOC-073 authenticated Admin cannot issue creation receipts');
set local role service_role;
select lives_ok($$select public.m365_record_folder_created('10200000-0000-0000-0000-000000000111','project',
 '10200000-0000-0000-0000-000000000211','synthetic-drive','synthetic-item')$$,
 'AC-M365DOC-073 verified service receipt succeeds');
select lives_ok($$select public.m365_record_folder_created('10200000-0000-0000-0000-000000000111','project',
 '10200000-0000-0000-0000-000000000211','synthetic-drive','synthetic-item')$$,
 'AC-M365DOC-073 duplicate receipt is harmless');
reset role;
select is((select count(*)::integer from public.audit_events where action='m365.folder_created'),1,
 'AC-M365DOC-073 one receipt exists');
select is((select detail->>'record_kind' from public.audit_events where action='m365.folder_created'),'project',
 'AC-M365DOC-073 kind is server attributed');
select is((select detail->>'ms_item_id' from public.audit_events where action='m365.folder_created'),'synthetic-item',
 'AC-M365DOC-073 identity is recorded');
select is((select actor_id from public.audit_events where action='m365.folder_created'),
 '10200000-0000-0000-0000-000000000111'::uuid,'AC-M365DOC-073 actor is derived from verified active profile');
select is((select org_id from public.audit_events where action='m365.folder_created'),
 '10200000-0000-0000-0000-000000000011'::uuid,'AC-M365DOC-073 org is derived from typed parent');
select is((select entity_id from public.audit_events where action='m365.folder_created'),
 '10200000-0000-0000-0000-000000000211'::uuid,'AC-M365DOC-073 record identity is recorded');
select ok((select detail ?& array['record_kind','record_id','ms_drive_id','ms_item_id']
 and (select count(*) from jsonb_object_keys(detail))=4 from public.audit_events where action='m365.folder_created'),
 'AC-M365DOC-073 receipt contains only the approved identity fields');
select ok(not has_function_privilege('authenticated','public.log_audit(text,uuid,uuid,uuid,jsonb)','execute'),
 'AC-M365DOC-073 clients cannot write arbitrary audit events');
-- A folder Microsoft already created in a drive that is no longer the default is still audited exactly once.
reset role;
update public.org_m365_document_settings set default_drive_id='synthetic-drive-new' where org_id='10200000-0000-0000-0000-000000000011';
set local role service_role;
select lives_ok($$select public.m365_record_folder_created('10200000-0000-0000-0000-000000000111','project',
 '10200000-0000-0000-0000-000000000211','synthetic-drive','old-default-item')$$,
 'AC-M365DOC-073 receipt for a drive that is no longer the default still succeeds');
select lives_ok($$select public.m365_record_folder_created('10200000-0000-0000-0000-000000000111','project',
 '10200000-0000-0000-0000-000000000211','synthetic-drive','old-default-item')$$,
 'AC-M365DOC-073 repeat of that receipt is harmless');
reset role;
select is((select count(*)::integer from public.audit_events where action='m365.folder_created' and detail->>'ms_item_id'='old-default-item'),1,
 'AC-M365DOC-073 the old-default-drive receipt recorded exactly one event');
-- Still refused: non-writer, cross-org record, empty identities.
insert into public.organizations(id,name) values ('10200000-0000-0000-0000-000000000012','Synthetic other org');
insert into public.projects(id,org_id,name,status) values
 ('10200000-0000-0000-0000-000000000212','10200000-0000-0000-0000-000000000012','Synthetic other project','Ongoing Project');
insert into auth.users(id,email) values ('10200000-0000-0000-0000-000000000112','engineer@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000112','10200000-0000-0000-0000-000000000011','Synthetic engineer','engineer@example.invalid','Engineer','active');
set local role service_role;
select throws_ok($$select public.m365_record_folder_created('10200000-0000-0000-0000-000000000112','project',
 '10200000-0000-0000-0000-000000000211','synthetic-drive','nonwriter-item')$$,'42501',null,
 'AC-M365DOC-073 a non-writer role is refused');
select throws_ok($$select public.m365_record_folder_created('10200000-0000-0000-0000-000000000111','project',
 '10200000-0000-0000-0000-000000000212','synthetic-drive','cross-org-item')$$,'42501',null,
 'AC-M365DOC-073 a record in another org is refused');
select throws_ok($$select public.m365_record_folder_created('10200000-0000-0000-0000-000000000111','project',
 '10200000-0000-0000-0000-000000000211','','empty-drive-item')$$,'22023',null,
 'AC-M365DOC-073 an empty drive identity is refused');
select throws_ok($$select public.m365_record_folder_created('10200000-0000-0000-0000-000000000111','project',
 '10200000-0000-0000-0000-000000000211','synthetic-drive',' ')$$,'22023',null,
 'AC-M365DOC-073 an empty item identity is refused');
reset role;
select is((select count(*)::integer from public.audit_events where action='m365.folder_created'),2,
 'AC-M365DOC-073 refused receipts wrote nothing');
select * from finish();
rollback;
