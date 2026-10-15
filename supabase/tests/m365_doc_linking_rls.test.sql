begin;
select no_plan();

insert into public.organizations (id,name) values
 ('10200000-0000-0000-0000-000000000001','Synthetic RLS org'),
 ('10200000-0000-0000-0000-000000000002','Synthetic other org');
insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000102','m365-rls-writer@example.invalid'),
 ('10200000-0000-0000-0000-000000000105','m365-rls-reader@example.invalid'),
 ('10200000-0000-0000-0000-000000000106','m365-rls-inactive@example.invalid'),
 ('10200000-0000-0000-0000-000000000107','m365-rls-other@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000102','10200000-0000-0000-0000-000000000001','Writer','m365-rls-writer@example.invalid','Project Manager','active'),
 ('10200000-0000-0000-0000-000000000105','10200000-0000-0000-0000-000000000001','Reader','m365-rls-reader@example.invalid','Engineer','active'),
 ('10200000-0000-0000-0000-000000000106','10200000-0000-0000-0000-000000000001','Inactive','m365-rls-inactive@example.invalid','Project Manager','disabled'),
 ('10200000-0000-0000-0000-000000000107','10200000-0000-0000-0000-000000000002','Other org','m365-rls-other@example.invalid','Project Manager','active');
insert into public.projects (id,org_id,name,status) values
 ('10200000-0000-0000-0000-000000000201','10200000-0000-0000-0000-000000000001','Synthetic project','Ongoing Project'),
 ('10200000-0000-0000-0000-000000000202','10200000-0000-0000-0000-000000000002','Other project','Ongoing Project');
insert into public.project_documents (id,org_id,project_id,category,title,status,author_id) values
 ('10200000-0000-0000-0000-000000000301','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','Writer row','Draft','10200000-0000-0000-0000-000000000102'),
 ('10200000-0000-0000-0000-000000000302','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','Reader row','Draft','10200000-0000-0000-0000-000000000102');
insert into public.procurements (id,org_id,title,project_id,status) values
 ('10200000-0000-0000-0000-000000000203','10200000-0000-0000-0000-000000000001','Synthetic overhead',null,'Draft');
insert into public.procurement_documents (id,org_id,procurement_id,type,link) values
 ('10200000-0000-0000-0000-000000000303','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000203','Reference',null);

select ok(has_column_privilege('authenticated','public.project_documents','source','UPDATE'),
 'AC-M365DOC-003 authenticated role receives project source UPDATE column privilege');
select ok(has_column_privilege('authenticated','public.project_documents','ms_item_kind','INSERT'),
 'AC-M365DOC-003 authenticated role can INSERT reference fields');
select ok(not has_table_privilege('authenticated','public.project_documents','INSERT'),
 'AC-M365DOC-003 project INSERT remains column-scoped');
select ok(has_column_privilege('authenticated','public.procurement_documents','source','UPDATE'),
 'AC-M365DOC-051 authenticated role receives procurement source UPDATE column privilege');
select ok(not has_table_privilege('authenticated','public.procurement_documents','INSERT'),
 'AC-M365DOC-051 procurement INSERT remains column-scoped');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000102","role":"authenticated"}';
select lives_ok($$update public.project_documents set source='onedrive',ms_drive_id='drive-a',ms_item_id='writer-file',
 ms_web_url='https://example.invalid/writer',ms_item_name='Writer evidence',ms_item_kind='file'
 where id='10200000-0000-0000-0000-000000000301'$$,
 'AC-M365DOC-003 active same-org author can link a Draft project document');
select lives_ok($$update public.procurement_documents set source='onedrive',link='https://example.invalid/proc',
 ms_drive_id='drive-a',ms_item_id='procurement-file',ms_item_name='Case evidence',ms_item_kind='folder'
 where id='10200000-0000-0000-0000-000000000303'$$,
 'AC-M365DOC-051 active same-org procurement writer can link an overhead case reference');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000105","role":"authenticated"}';
select lives_ok($$update public.project_documents set source='onedrive',ms_drive_id='drive-a',ms_item_id='reader-file',
 ms_web_url='https://example.invalid/reader',ms_item_name='Reader evidence',ms_item_kind='file'
 where id='10200000-0000-0000-0000-000000000302'$$,
 'AC-M365DOC-003 read-only same-org actor can attempt a source update');
reset role;
select ok((select source is null from public.project_documents
 where id='10200000-0000-0000-0000-000000000302'),
 'AC-M365DOC-003 read-only actor source update is denied by effective RLS');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000106","role":"authenticated"}';
select lives_ok($$update public.project_documents set source='onedrive',ms_drive_id='drive-a',ms_item_id='inactive-file',
 ms_web_url='https://example.invalid/inactive',ms_item_name='Inactive',ms_item_kind='file'
 where id='10200000-0000-0000-0000-000000000301'$$,
 'AC-M365DOC-003 inactive actor cannot persist a source update');
reset role;
select is((select ms_item_id from public.project_documents where id='10200000-0000-0000-0000-000000000301'),
 'writer-file','AC-M365DOC-003 inactive actor leaves the committed project reference unchanged');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000107","role":"authenticated"}';
select lives_ok($$update public.project_documents set title='Cross-org attempt'
 where id='10200000-0000-0000-0000-000000000301'$$,
 'AC-M365DOC-003 cross-org actor cannot mutate another organization row');
select throws_ok($$insert into public.project_documents
 (id,org_id,project_id,category,title,status,author_id)
 values ('10200000-0000-0000-0000-000000000304','10200000-0000-0000-0000-000000000002',
 '10200000-0000-0000-0000-000000000201','Specification','Wrong parent','Draft',
 '10200000-0000-0000-0000-000000000107')$$,'42501',null,
 'AC-M365DOC-003 cross-org parent INSERT is rejected by effective policy');
reset role;
select ok(not exists(select 1 from public.project_documents where id='10200000-0000-0000-0000-000000000304'),
 'AC-M365DOC-003 wrong-org parent row was not committed');
select ok((select title='Writer row' from public.project_documents
 where id='10200000-0000-0000-0000-000000000301'),
 'AC-M365DOC-003 cross-org write leaves the original row unchanged');

select * from finish();
rollback;
