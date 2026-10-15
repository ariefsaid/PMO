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

insert into public.budget_versions
 (id,org_id,project_id,version,name,status,created_by)
values ('10200000-0000-0000-0000-000000000207','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000201',7,'Synthetic linked evidence budget','Draft',
 '10200000-0000-0000-0000-000000000101');
insert into public.budget_line_items
 (id,org_id,budget_version_id,category,description,budgeted_amount,actual_amount)
values ('10200000-0000-0000-0000-000000000208','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000207','Labor','Synthetic budget line',123.45,12.34);
insert into public.budget_version_editors (org_id,budget_version_id,user_id)
values ('10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000207',
 '10200000-0000-0000-0000-000000000101') on conflict do nothing;
create temporary table m365_money_snapshot as
select v.status::text as status,
 (select coalesce(sum(budgeted_amount),0) from public.budget_line_items where budget_version_id=v.id) as budgeted,
 (select coalesce(sum(actual_amount),0) from public.budget_line_items where budget_version_id=v.id) as actual,
 (select count(*)::integer from public.budget_version_editors where budget_version_id=v.id) as editors,
 (select count(*)::integer from public.external_command_outbox where org_id=v.org_id) as outbox,
 (v.status='Draft' and v.created_by is distinct from '10200000-0000-0000-0000-000000000102'::uuid
  and not exists(select 1 from public.budget_version_editors e where e.budget_version_id=v.id
    and e.user_id='10200000-0000-0000-0000-000000000102')) as activation_eligible
from public.budget_versions v where v.id='10200000-0000-0000-0000-000000000207';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000102","role":"authenticated"}';
insert into public.budget_version_document_links
 (budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
values ('10200000-0000-0000-0000-000000000207','synthetic-drive','synthetic-budget-item',
 'https://example.invalid/budget-evidence','Synthetic evidence','file');
delete from public.budget_version_document_links where ms_item_id='synthetic-budget-item';
reset role;
create temporary table m365_money_snapshot_after as
select v.status::text as status,
 (select coalesce(sum(budgeted_amount),0) from public.budget_line_items where budget_version_id=v.id) as budgeted,
 (select coalesce(sum(actual_amount),0) from public.budget_line_items where budget_version_id=v.id) as actual,
 (select count(*)::integer from public.budget_version_editors where budget_version_id=v.id) as editors,
 (select count(*)::integer from public.external_command_outbox where org_id=v.org_id) as outbox,
 (v.status='Draft' and v.created_by is distinct from '10200000-0000-0000-0000-000000000102'::uuid
  and not exists(select 1 from public.budget_version_editors e where e.budget_version_id=v.id
    and e.user_id='10200000-0000-0000-0000-000000000102')) as activation_eligible
from public.budget_versions v where v.id='10200000-0000-0000-0000-000000000207';
select ok((select b.status=a.status and b.budgeted=a.budgeted and b.actual=a.actual
 and b.editors=a.editors and b.outbox=a.outbox
 and b.activation_eligible=a.activation_eligible
 from m365_money_snapshot b cross join m365_money_snapshot_after a),
 'AC-M365DOC-068 adding and removing evidence leaves budget status, amounts, editor set, outbox, and activation eligibility unchanged');

select * from finish();
rollback;
