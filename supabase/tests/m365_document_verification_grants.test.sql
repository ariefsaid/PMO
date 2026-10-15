begin;
select no_plan();

insert into public.organizations (id,name) values
 ('10200000-0000-0000-0000-000000000001','Synthetic verification org'),
 ('10200000-0000-0000-0000-000000000002','Synthetic other verification org');
insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000101','m365-verification@example.invalid'),
 ('10200000-0000-0000-0000-000000000102','m365-other-verification@example.invalid'),
 ('10200000-0000-0000-0000-000000000103','m365-engineer-verification@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000101','10200000-0000-0000-0000-000000000001','Synthetic Admin',
 'm365-verification@example.invalid','Admin','active'),
 ('10200000-0000-0000-0000-000000000102','10200000-0000-0000-0000-000000000002','Synthetic Other Admin',
 'm365-other-verification@example.invalid','Admin','active'),
 ('10200000-0000-0000-0000-000000000103','10200000-0000-0000-0000-000000000001','Synthetic Engineer',
 'm365-engineer-verification@example.invalid','Engineer','active');
insert into public.projects (id,org_id,name,status) values
 ('10200000-0000-0000-0000-000000000201','10200000-0000-0000-0000-000000000001','Synthetic project','Ongoing Project'),
 ('10200000-0000-0000-0000-000000000202','10200000-0000-0000-0000-000000000002','Synthetic other project','Ongoing Project');
insert into public.project_documents
 (id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,
  ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at,ms_content_tag_at_issue,ms_drift_state)
values
 ('10200000-0000-0000-0000-000000000301','10200000-0000-0000-0000-000000000001',
  '10200000-0000-0000-0000-000000000201','Specification','Controlled','Issued',
  '10200000-0000-0000-0000-000000000101','onedrive','drive-a','check-item','https://example.invalid/check',
  'Controlled','file','10200000-0000-0000-0000-000000000101',now(),'tag-a','clean'),
 ('10200000-0000-0000-0000-000000000302','10200000-0000-0000-0000-000000000001',
  '10200000-0000-0000-0000-000000000201','Specification','Draft','Draft',
  '10200000-0000-0000-0000-000000000101','onedrive','drive-a','issue-item','https://example.invalid/issue',
  'Draft evidence','file','10200000-0000-0000-0000-000000000101',now(),null,null),
 ('10200000-0000-0000-0000-000000000303','10200000-0000-0000-0000-000000000002',
  '10200000-0000-0000-0000-000000000202','Specification','Other org controlled','Issued',
  '10200000-0000-0000-0000-000000000102','onedrive','drive-b','foreign-item','https://example.invalid/foreign',
  'Foreign evidence','file','10200000-0000-0000-0000-000000000102',now(),'foreign-tag','clean'),
 ('10200000-0000-0000-0000-000000000304','10200000-0000-0000-0000-000000000001',
  '10200000-0000-0000-0000-000000000201','Specification','Demoted author draft','Draft',
  '10200000-0000-0000-0000-000000000101','onedrive','drive-a','demoted-item','https://example.invalid/demoted',
  'Demoted evidence','folder','10200000-0000-0000-0000-000000000101',now(),null,null);

select ok(to_regprocedure('public.m365_claim_document_checks(uuid,uuid[])') is not null,
 'AC-M365DOC-066 claim RPC exists with the fixed signature');
select ok(to_regprocedure('public.m365_commit_document_check(uuid,uuid,uuid,text,text,text,text,text,text,boolean)') is not null,
 'AC-M365DOC-066 commit RPC exists with the fixed signature');
select ok(to_regprocedure('public.m365_issue_document(uuid,uuid,text,text,text,text,text,text)') is not null,
 'AC-M365DOC-066 Issue RPC exists with the fixed signature');
select ok(to_regprocedure('public.m365_refresh_reference(uuid,uuid,uuid,uuid,text,text,text,text)') is not null,
 'AC-M365DOC-066 refresh RPC exists with the fixed signature');
select ok(not has_function_privilege('authenticated','public.m365_claim_document_checks(uuid,uuid[])','execute'),
 'AC-M365DOC-066 authenticated users cannot invoke internal verification RPCs');
select ok(not has_function_privilege('anon','public.m365_commit_document_check(uuid,uuid,uuid,text,text,text,text,text,text,boolean)','execute'),
 'AC-M365DOC-066 anonymous callers cannot invoke commit RPC');
select ok(has_function_privilege('service_role','public.m365_claim_document_checks(uuid,uuid[])','execute'),
 'AC-M365DOC-066 service runtime can invoke claim RPC');
select ok(not has_column_privilege('authenticated','public.project_documents','ms_content_tag_at_issue','UPDATE'),
 'AC-M365DOC-066 Admin cannot directly write a verification baseline');
select ok(not has_column_privilege('authenticated','public.project_documents','ms_check_claim','UPDATE'),
 'AC-M365DOC-066 clients cannot directly write a verification lease');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000101","role":"authenticated"}';
select throws_ok($$select * from public.m365_claim_document_checks('10200000-0000-0000-0000-000000000101',
 array['10200000-0000-0000-0000-000000000301'::uuid])$$,'42501',null,
 'AC-M365DOC-066 an Admin cannot invoke a service-only verification RPC');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select * from public.m365_claim_document_checks('10200000-0000-0000-0000-000000000103',
 array['10200000-0000-0000-0000-000000000301'::uuid])$$,'42501',null,
 'AC-M365DOC-066 service claim rejects an actor outside the write-role set');
select is((select count(*)::integer from public.m365_claim_document_checks('10200000-0000-0000-0000-000000000101',
 array['10200000-0000-0000-0000-000000000303'::uuid])),0,
 'AC-M365DOC-066 service claim does not return a linked document from another organization');
select is((select count(*)::integer from public.m365_claim_document_checks('10200000-0000-0000-0000-000000000101',
 array['10200000-0000-0000-0000-000000000301'::uuid])),1,
 'AC-M365DOC-066 service claim leases eligible controlled files for the supplied active actor');
create temporary table m365_claimed_document as
select id,ms_check_claim from public.project_documents where id='10200000-0000-0000-0000-000000000301';
select is(public.m365_commit_document_check('10200000-0000-0000-0000-000000000101',
 '10200000-0000-0000-0000-000000000301',gen_random_uuid(),'drive-a','check-item','tag-a','Wrong claim',
 'https://example.invalid/wrong-claim','tag-b',true),false,
 'AC-M365DOC-066 commit rejects a claim token that does not own the lease');
select ok((select ms_check_claim is not null from public.project_documents
 where id='10200000-0000-0000-0000-000000000301'),
 'AC-M365DOC-066 rejected claim token leaves the live lease unchanged');
select lives_ok($$select public.m365_commit_document_check('10200000-0000-0000-0000-000000000101',
 '10200000-0000-0000-0000-000000000301',c.ms_check_claim,'drive-a','check-item','tag-a','Renamed evidence',
 'https://example.invalid/renamed','tag-b',true) from m365_claimed_document c$$,
 'AC-M365DOC-066 matching lease can commit fresh metadata and a changed cTag');
select ok((select ms_drift_state='drifted' and ms_item_name='Renamed evidence'
 and ms_content_tag_at_issue='tag-a' and ms_last_verified_at is not null
 from public.project_documents where id='10200000-0000-0000-0000-000000000301'),
 'AC-M365DOC-066 commit records drift without changing the frozen baseline');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.m365_issue_document('10200000-0000-0000-0000-000000000103',
 '10200000-0000-0000-0000-000000000302','drive-a','issue-item',null,null,'Draft evidence',
 'https://example.invalid/issue')$$,'42501',null,
 'AC-M365DOC-066 Issue rejects an active actor without a write role');
select throws_ok($$select public.m365_issue_document('10200000-0000-0000-0000-000000000102',
 '10200000-0000-0000-0000-000000000302','drive-a','issue-item',null,null,'Draft evidence',
 'https://example.invalid/issue')$$,'23514',null,
 'AC-M365DOC-066 Issue rejects an actor from another organization');
select lives_ok($$select public.m365_issue_document('10200000-0000-0000-0000-000000000101',
 '10200000-0000-0000-0000-000000000302','drive-a','issue-item',null,null,'Draft evidence',
 'https://example.invalid/issue')$$,
 'AC-M365DOC-066 service Issue can freeze a matching Draft linked file');
update public.profiles set role='Engineer' where id='10200000-0000-0000-0000-000000000101';
select is(public.m365_refresh_reference('10200000-0000-0000-0000-000000000101',
 '10200000-0000-0000-0000-000000000304',null,null,'drive-a','demoted-item','Renamed evidence',
 'https://example.invalid/renamed'),false,
 'AC-M365DOC-066 demoted project document author cannot refresh as a non-writer');
reset role;
select ok((select status='Issued' and ms_drift_state='not_verified'
 and ms_content_tag_at_issue is null and ms_version_id_at_issue is null
 from public.project_documents where id='10200000-0000-0000-0000-000000000302'),
 'AC-M365DOC-066 Issue without a usable cTag remains explicitly unverified');

select * from finish();
rollback;
