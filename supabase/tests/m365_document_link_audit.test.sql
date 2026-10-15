begin;
select no_plan();

insert into public.organizations (id,name) values
 ('10200000-0000-0000-0000-000000000001','Synthetic audit org');
insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000101','m365-audit@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000101','10200000-0000-0000-0000-000000000001','Synthetic admin','m365-audit@example.invalid','Admin','active');
insert into public.projects (id,org_id,name,status) values
 ('10200000-0000-0000-0000-000000000201','10200000-0000-0000-0000-000000000001','Synthetic project','Ongoing Project');
insert into public.procurements (id,org_id,title,project_id,status) values
 ('10200000-0000-0000-0000-000000000202','10200000-0000-0000-0000-000000000001','Synthetic overhead',null,'Draft');
insert into public.budget_versions (id,org_id,project_id,version,name,status) values
 ('10200000-0000-0000-0000-000000000203','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201',1,'Synthetic budget','Draft');
insert into public.project_documents (id,org_id,project_id,category,title,status,author_id)
 values ('10200000-0000-0000-0000-000000000301','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000201','Specification','Synthetic title','Draft','10200000-0000-0000-0000-000000000101');
insert into public.procurement_documents (id,org_id,procurement_id,type,status)
 values ('10200000-0000-0000-0000-000000000302','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000202','Microsoft reference','Draft');

grant update(source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
 on public.project_documents to authenticated;
grant update(source,ms_drive_id,ms_item_id,link,ms_item_name,ms_item_kind)
 on public.procurement_documents to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000101","role":"authenticated"}';

select lives_ok($$update public.project_documents set source='onedrive',ms_drive_id='drive-a',ms_item_id='project-item',
 ms_web_url='https://example.invalid/project',ms_item_name='Private name',ms_item_kind='file'
 where id='10200000-0000-0000-0000-000000000301'$$,'AC-M365DOC-061 project link succeeds with audit');
select lives_ok($$update public.project_documents set source=null,ms_drive_id=null,ms_item_id=null,ms_web_url=null,
 ms_item_name=null,ms_item_kind=null where id='10200000-0000-0000-0000-000000000301'$$,
 'AC-M365DOC-061 project unlink succeeds with audit');
select lives_ok($$update public.procurement_documents set source='onedrive',link='https://example.invalid/proc',
 ms_drive_id='drive-a',ms_item_id='proc-item',ms_item_name='Private procurement name',ms_item_kind='folder'
 where id='10200000-0000-0000-0000-000000000302'$$,'AC-M365DOC-061 procurement link succeeds with audit');
select lives_ok($$update public.procurement_documents set source=null,link=null,ms_drive_id=null,ms_item_id=null,
 ms_item_name=null,ms_item_kind=null where id='10200000-0000-0000-0000-000000000302'$$,
 'AC-M365DOC-061 procurement unlink succeeds with audit');
select lives_ok($$insert into public.budget_version_document_links
 (budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
 values ('10200000-0000-0000-0000-000000000203','drive-a','budget-item',
 'https://example.invalid/budget','Private budget name','file')$$,'AC-M365DOC-061 budget link succeeds with audit');
select lives_ok($$delete from public.budget_version_document_links where ms_item_id='budget-item'$$,
 'AC-M365DOC-061 budget unlink succeeds with audit');
select lives_ok($$insert into public.org_m365_document_settings
 (default_site_id,default_site_name,default_drive_id,default_drive_name)
 values ('site-a','Private site','drive-a','Private library')$$,
 'AC-M365DOC-061 first default library set succeeds with audit');
select lives_ok($$update public.org_m365_document_settings set default_site_id='site-b',default_site_name='Private site B',
 default_drive_id='drive-b',default_drive_name='Private library B' where org_id='10200000-0000-0000-0000-000000000001'$$,
 'AC-M365DOC-061 changing the default library succeeds with audit');
select lives_ok($$update public.org_m365_document_settings set default_site_id=null,default_site_name=null,
 default_drive_id=null,default_drive_name=null where org_id='10200000-0000-0000-0000-000000000001'$$,
 'AC-M365DOC-061 setting clear succeeds with audit');
reset role;

select is((select count(*)::integer from public.audit_events where action='project_document.m365_linked'),1,
 'AC-M365DOC-061 project link emits one typed M365 audit event');
select is((select count(*)::integer from public.audit_events where action='project_document.m365_unlinked'),1,
 'AC-M365DOC-061 project unlink emits one typed M365 audit event');
select is((select count(*)::integer from public.audit_events where action='procurement_document.m365_linked'),1,
 'AC-M365DOC-061 procurement link emits one typed M365 audit event');
select is((select count(*)::integer from public.audit_events where action='procurement_document.m365_unlinked'),1,
 'AC-M365DOC-061 procurement unlink emits one typed M365 audit event');
select is((select count(*)::integer from public.audit_events where action='budget_version_document_link.m365_linked'),1,
 'AC-M365DOC-061 budget link emits one typed M365 audit event');
select is((select count(*)::integer from public.audit_events where action='budget_version_document_link.m365_unlinked'),1,
 'AC-M365DOC-061 budget unlink emits one typed M365 audit event');
select is((select count(*)::integer from public.audit_events where action='m365.default_library_changed'),3,
 'AC-M365DOC-061 first set/change/clear default each emits one typed audit event');
select ok(not exists(select 1 from public.audit_events where action='project_document.update'
 and entity_id='10200000-0000-0000-0000-000000000301'),
 'AC-M365DOC-061 reference-only project updates do not emit generic document snapshots');
select ok(not exists(select 1 from public.audit_events where detail::text ~* '(private name|example\\.invalid)'),
 'AC-M365DOC-061 typed audit details omit names and URLs');
select ok(not has_function_privilege('authenticated','public.log_audit(text,uuid,uuid,uuid,jsonb)','execute'),
 'AC-M365DOC-061 authenticated clients cannot invoke the raw audit writer');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000101","role":"authenticated"}';
select throws_ok($$select public.log_audit('forged','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000101',null,'{}'::jsonb)$$,'42501',null,
 'AC-M365DOC-061 authenticated clients cannot invoke the raw audit writer');
select throws_ok($$insert into public.audit_events(action,org_id,actor_id,entity_type,entity_id)
 values ('forged','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000101','x',null)$$,
 '42501',null,'AC-M365DOC-061 clients cannot write audit events directly');
reset role;

select * from finish();
rollback;
