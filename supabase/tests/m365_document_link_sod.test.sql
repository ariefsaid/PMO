begin;
select no_plan();

insert into public.organizations (id,name) values
 ('10200000-0000-0000-0000-000000000001','Synthetic lifecycle org');
insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000101','m365-author@example.invalid'),
 ('10200000-0000-0000-0000-000000000102','m365-approver@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000101','10200000-0000-0000-0000-000000000001','Synthetic author','m365-author@example.invalid','Project Manager','active'),
 ('10200000-0000-0000-0000-000000000102','10200000-0000-0000-0000-000000000001','Synthetic approver','m365-approver@example.invalid','Finance','active');
insert into public.projects (id,org_id,name,status) values
 ('10200000-0000-0000-0000-000000000201','10200000-0000-0000-0000-000000000001','Synthetic project','Ongoing Project');
insert into public.project_documents
 (id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,
  ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at,ms_content_tag_at_issue,ms_version_id_at_issue,ms_drift_state)
values ('10200000-0000-0000-0000-000000000301','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000201','Specification','Controlled evidence','Issued',
 '10200000-0000-0000-0000-000000000101','onedrive','drive-a','controlled-file','https://example.invalid/file',
 'Controlled file','file','10200000-0000-0000-0000-000000000101',now(),'tag-at-issue','version-a','clean');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000101","role":"authenticated"}';
select throws_ok($$select public.transition_document_status('10200000-0000-0000-0000-000000000301','Approved')$$,
 '42501',null,'AC-M365DOC-063 linked document author cannot approve their own evidence');
reset role;
select is((select status::text from public.project_documents where id='10200000-0000-0000-0000-000000000301'),
 'Issued','AC-M365DOC-063 refused self-approval preserves linked Issued evidence');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000102","role":"authenticated"}';
select lives_ok($$select public.transition_document_status('10200000-0000-0000-0000-000000000301','Approved')$$,
 'AC-M365DOC-063 a different permitted actor can approve linked evidence');
reset role;
select ok((select status='Approved' and source='onedrive' and ms_content_tag_at_issue='tag-at-issue'
 and ms_version_id_at_issue='version-a' and ms_drift_state='clean'
 from public.project_documents where id='10200000-0000-0000-0000-000000000301'),
 'AC-M365DOC-063 approval preserves the Microsoft reference and frozen evidence');
select is((select count(*)::integer from public.audit_events where action='project_document.transition'
 and entity_id='10200000-0000-0000-0000-000000000301'),1,
 'AC-M365DOC-063 only successful lifecycle transition is audited');

select * from finish();
rollback;
