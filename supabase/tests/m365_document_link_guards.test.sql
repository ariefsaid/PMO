begin;
select no_plan();

insert into public.organizations (id,name) values
 ('10200000-0000-0000-0000-000000000001','Synthetic guard org');
insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000102','m365-guard@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000102','10200000-0000-0000-0000-000000000001','Synthetic PM','m365-guard@example.invalid','Project Manager','active');
insert into public.projects (id,org_id,name,status) values
 ('10200000-0000-0000-0000-000000000201','10200000-0000-0000-0000-000000000001','Synthetic project','Ongoing Project'),
 ('10200000-0000-0000-0000-000000000202','10200000-0000-0000-0000-000000000001','Second project','Ongoing Project');
insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,file_path,source) values
 ('10200000-0000-0000-0000-000000000301','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','Upload','Draft','10200000-0000-0000-0000-000000000102','documents/upload.pdf','upload'),
 ('10200000-0000-0000-0000-000000000302','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','Metadata','Draft','10200000-0000-0000-0000-000000000102',null,null);
insert into public.procurements (id,org_id,title,project_id,status) values
 ('10200000-0000-0000-0000-000000000203','10200000-0000-0000-0000-000000000001','Synthetic overhead',null,'Draft');
insert into public.procurement_documents (id,org_id,procurement_id,type,link) values
 ('10200000-0000-0000-0000-000000000303','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000203','Legacy','https://example.invalid/legacy'),
 ('10200000-0000-0000-0000-000000000304','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000203','Microsoft reference',null);
insert into public.project_documents
 (id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,
  ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at,ms_content_tag_at_issue,ms_drift_state)
values ('10200000-0000-0000-0000-000000000305','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000201','Specification','Controlled','Approved',
 '10200000-0000-0000-0000-000000000102','onedrive','drive-a','controlled-file',
 'https://example.invalid/controlled','Controlled','file','10200000-0000-0000-0000-000000000102',now(),'tag-a','clean');
insert into public.project_documents (id,org_id,project_id,category,title,status,author_id)
values ('10200000-0000-0000-0000-000000000306','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000201','Specification','Raw upload seam','Draft',
 '10200000-0000-0000-0000-000000000102');

grant update(source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 on public.project_documents to authenticated;
grant update(source,ms_drive_id,ms_item_id,link,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 on public.procurement_documents to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000102","role":"authenticated"}';

select lives_ok($$update public.project_documents set file_path='documents/raw-upload.pdf'
 where id='10200000-0000-0000-0000-000000000306'$$,
 'AC-M365DOC-063 existing upload writer can still set file_path without sending source');
select lives_ok($$update public.project_documents set file_path=null
 where id='10200000-0000-0000-0000-000000000306'$$,
 'AC-M365DOC-063 clearing a raw upload path returns to a metadata-only source');
select lives_ok($$update public.project_documents set source='onedrive',ms_drive_id='drive-a',ms_item_id='file-a',
 ms_web_url='https://example.invalid/file',ms_item_name='Evidence',ms_item_kind='file',
 ms_linked_by='10200000-0000-0000-0000-000000000101',ms_linked_at='2000-01-01'
 where id='10200000-0000-0000-0000-000000000302'$$,
 'AC-M365DOC-063 an authorized author can link a complete reference to a Draft metadata row');
select throws_ok($$update public.project_documents set source='onedrive',ms_drive_id='drive-a',ms_item_id='file-b',
 ms_web_url='https://example.invalid/file-b',ms_item_name='Replacement',ms_item_kind='file'
 where id='10200000-0000-0000-0000-000000000302'$$,
 '23514',null,'AC-M365DOC-063 competing link cannot replace an existing source');
select throws_ok($$update public.project_documents set source='onedrive',ms_drive_id='drive-a',ms_item_id='file-upload',
 ms_web_url='https://example.invalid/file-upload',ms_item_name='Upload collision',ms_item_kind='file'
 where id='10200000-0000-0000-0000-000000000301'$$,
 '23514',null,'AC-M365DOC-063 upload source cannot be overwritten');
select lives_ok($$update public.procurement_documents set source='onedrive',link='https://example.invalid/proc',
 ms_drive_id='drive-a',ms_item_id='proc-a',ms_item_name='Proc evidence',ms_item_kind='folder',
 ms_linked_by='10200000-0000-0000-0000-000000000101',ms_linked_at='2000-01-01'
 where id='10200000-0000-0000-0000-000000000304'$$,
 'AC-M365DOC-063 procurement reference links without a project or purchase-stage check');
select throws_ok($$update public.procurement_documents set source='onedrive',link='https://example.invalid/new',
 ms_drive_id='drive-a',ms_item_id='legacy-overwrite',ms_item_name='Replacement',ms_item_kind='file'
 where id='10200000-0000-0000-0000-000000000303'$$,
 '23514',null,'AC-M365DOC-063 a legacy plain procurement URL cannot be overwritten');

reset role;
select is((select ms_linked_by from public.project_documents where id='10200000-0000-0000-0000-000000000302'),
 '10200000-0000-0000-0000-000000000102'::uuid,'AC-M365DOC-063 linker stamp is taken from the authenticated actor');
select ok((select ms_linked_at > '2000-01-01'::timestamptz from public.project_documents
 where id='10200000-0000-0000-0000-000000000302'),'AC-M365DOC-063 link time is server-stamped');
select is((select ms_linked_by from public.procurement_documents where id='10200000-0000-0000-0000-000000000304'),
 '10200000-0000-0000-0000-000000000102'::uuid,'AC-M365DOC-063 procurement linker stamp is server-side');
select is((select link from public.procurement_documents where id='10200000-0000-0000-0000-000000000303'),
 'https://example.invalid/legacy','AC-M365DOC-063 refused legacy overwrite leaves original URL unchanged');
select ok((select source is null and file_path is null from public.project_documents
 where id='10200000-0000-0000-0000-000000000306'),
 'AC-M365DOC-063 raw upload path clear returns to source-null state');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000102","role":"authenticated"}';
select throws_ok($$update public.project_documents set project_id='10200000-0000-0000-0000-000000000202'
 where id='10200000-0000-0000-0000-000000000302'$$,
 '23514',null,'AC-M365DOC-063 linked project parent is immutable');
select throws_ok($$update public.project_documents set source=null,ms_drive_id=null,ms_item_id=null,
 ms_web_url=null,ms_item_name=null,ms_item_kind=null where id='10200000-0000-0000-0000-000000000305'$$,
 '42501',null,'AC-M365DOC-063 non-Draft controlled file cannot be unlinked by ordinary writer');
select lives_ok($$update public.project_documents set source=null,ms_drive_id=null,ms_item_id=null,
 ms_web_url=null,ms_item_name=null,ms_item_kind=null where id='10200000-0000-0000-0000-000000000302'$$,
 'AC-M365DOC-063 explicit unlink clears the Draft Microsoft reference');
select lives_ok($$update public.procurement_documents set source=null,link=null,ms_drive_id=null,ms_item_id=null,
 ms_item_name=null,ms_item_kind=null where id='10200000-0000-0000-0000-000000000304'$$,
 'AC-M365DOC-063 explicit procurement unlink clears the reference and canonical URL');

reset role;
select ok((select source is null and num_nonnulls(ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,
 ms_linked_by,ms_linked_at,ms_last_verified_at,ms_content_tag_at_issue,ms_version_id_at_issue,ms_drift_state,
 ms_check_claim,ms_check_claimed_at)=0 from public.project_documents
 where id='10200000-0000-0000-0000-000000000302'),'AC-M365DOC-063 unlink clears the full protected project reference state');
select ok((select source='onedrive' and status='Approved' and ms_content_tag_at_issue='tag-a'
 from public.project_documents where id='10200000-0000-0000-0000-000000000305'),
 'AC-M365DOC-063 refused non-Draft unlink preserves controlled reference and lifecycle');
select ok((select source is null and link is null and num_nonnulls(ms_drive_id,ms_item_id,ms_item_name,ms_item_kind,
 ms_linked_by,ms_linked_at,ms_last_verified_at)=0 from public.procurement_documents
 where id='10200000-0000-0000-0000-000000000304'),'AC-M365DOC-063 procurement unlink clears all reference state');

select * from finish();
rollback;
