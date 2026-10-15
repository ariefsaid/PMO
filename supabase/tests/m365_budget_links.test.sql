begin;
select no_plan();
insert into public.organizations (id,name) values
 ('10200000-0000-0000-0000-000000000001','Synthetic budget org'),
 ('10200000-0000-0000-0000-000000000002','Synthetic other budget org');
insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000102','m365-budget@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000102','10200000-0000-0000-0000-000000000001','Synthetic actor','m365-budget@example.invalid','Finance','active');
insert into public.projects (id,org_id,name,status) values
 ('10200000-0000-0000-0000-000000000201','10200000-0000-0000-0000-000000000001','Synthetic project','Ongoing Project');

insert into public.budget_versions (id,org_id,project_id,version,name,status) values
 ('10200000-0000-0000-0000-000000000203','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201',1,'Synthetic draft budget','Draft'),
 ('10200000-0000-0000-0000-000000000204','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201',2,'Synthetic active budget','Active');

select ok(to_regclass('public.budget_version_document_links') is not null,
 'AC-M365DOC-052 budget evidence has a dedicated typed relation');

select lives_ok($$insert into public.budget_version_document_links
 (id,org_id,budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 values ('10200000-0000-0000-0000-000000000303','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000203','drive-a','file-a','https://example.invalid/file',
 'Evidence file','file','10200000-0000-0000-0000-000000000102',now())$$,
 'AC-M365DOC-052 complete budget file evidence can be linked');
select lives_ok($$insert into public.budget_version_document_links
 (id,org_id,budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 values ('10200000-0000-0000-0000-000000000304','10200000-0000-0000-0000-000000000001',
 '10200000-0000-0000-0000-000000000203','drive-a','folder-a','https://example.invalid/folder',
 'Evidence folder','folder','10200000-0000-0000-0000-000000000102',now())$$,
 'AC-M365DOC-052 multiple file/folder links can belong to one version');
select is((select count(*)::integer from public.budget_version_document_links
 where budget_version_id='10200000-0000-0000-0000-000000000203'),2,
 'AC-M365DOC-052 budget version supports multiple references');
select is((select count(*)::integer from public.budget_version_document_links
 where budget_version_id='10200000-0000-0000-0000-000000000204'),0,
 'AC-M365DOC-052 budget versions may have no references');
select throws_ok($$insert into public.budget_version_document_links
 (org_id,budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 values ('10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000205',
 'drive-a','absent-parent','https://example.invalid/file','Evidence','file',
 '10200000-0000-0000-0000-000000000102',now())$$,
 '23503',null,'AC-M365DOC-052 budget evidence requires an existing typed version parent');
select throws_ok($$insert into public.budget_version_document_links
 (org_id,budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 values ('10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000203',
 'drive-a','incomplete','https://example.invalid/file','', 'file',
 '10200000-0000-0000-0000-000000000102',now())$$,
 '23514',null,'AC-M365DOC-052 incomplete budget references are rejected');
select ok(not exists(select 1 from information_schema.columns where table_schema='public'
 and table_name='budget_version_document_links' and column_name in ('source','project_id','status')),
 'AC-M365DOC-052 budget links are typed evidence, not cloned documents');

insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000106','m365-budget-inactive@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000106','10200000-0000-0000-0000-000000000001','Inactive actor',
 'm365-budget-inactive@example.invalid','Finance','disabled');
grant select,insert,update,delete on public.budget_version_document_links to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000102","role":"authenticated"}';
select lives_ok($$insert into public.budget_version_document_links
 (org_id,budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 values ('10200000-0000-0000-0000-000000000002','10200000-0000-0000-0000-000000000203',
 'drive-a','stamped-file','https://example.invalid/stamped','Stamped','file',
 '10200000-0000-0000-0000-000000000101','2000-01-01')$$,
 'AC-M365DOC-052 Draft Finance insert overwrites client org/actor/time with server stamps');
reset role;
select is((select org_id from public.budget_version_document_links where ms_item_id='stamped-file'),
 '10200000-0000-0000-0000-000000000001'::uuid,'AC-M365DOC-052 evidence org is parent/org stamped');
select is((select ms_linked_by from public.budget_version_document_links where ms_item_id='stamped-file'),
 '10200000-0000-0000-0000-000000000102'::uuid,'AC-M365DOC-052 evidence linker is server stamped');
select ok((select ms_linked_at>'2000-01-01'::timestamptz from public.budget_version_document_links
 where ms_item_id='stamped-file'),'AC-M365DOC-052 evidence link time is server stamped');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000102","role":"authenticated"}';
select throws_ok($$insert into public.budget_version_document_links
 (budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 values ('10200000-0000-0000-0000-000000000204','drive-a','active-version',
 'https://example.invalid/active','Active','file','10200000-0000-0000-0000-000000000102',now())$$,
 '42501',null,'AC-M365DOC-052 non-Draft budget evidence writes are refused');
select throws_ok($$update public.budget_version_document_links set budget_version_id='10200000-0000-0000-0000-000000000204'
 where ms_item_id='stamped-file'$$,'23514',null,
 'AC-M365DOC-052 budget evidence parent is immutable');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000106","role":"authenticated"}';
select throws_ok($$insert into public.budget_version_document_links
 (budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
 values ('10200000-0000-0000-0000-000000000203','drive-a','inactive-file',
 'https://example.invalid/inactive','Inactive','file','10200000-0000-0000-0000-000000000106',now())$$,
 '42501',null,'AC-M365DOC-052 inactive budget writer is refused');
reset role;

select * from finish();
rollback;
