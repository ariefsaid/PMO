begin;
select no_plan();

insert into public.organizations(id,name) values
 ('11200000-0000-0000-0000-000000000001','Synthetic query-plan org');
insert into auth.users(id,email) values
 ('11200000-0000-0000-0000-000000000101','query-plan@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('11200000-0000-0000-0000-000000000101','11200000-0000-0000-0000-000000000001',
  'Synthetic query-plan member','query-plan@example.invalid','Finance','active');
insert into public.projects(id,org_id,name,status) values
 ('11200000-0000-0000-0000-000000000201','11200000-0000-0000-0000-000000000001',
  'Synthetic query-plan project','Ongoing Project');
insert into public.procurements(id,org_id,title,project_id,requested_by_id,status,total_value) values
 ('11200000-0000-0000-0000-000000000202','11200000-0000-0000-0000-000000000001',
  'Synthetic query-plan procurement','11200000-0000-0000-0000-000000000201',
  '11200000-0000-0000-0000-000000000101','Draft',0);
insert into public.budget_versions(id,org_id,project_id,version,name,status,created_by) values
 ('11200000-0000-0000-0000-000000000203','11200000-0000-0000-0000-000000000001',
  '11200000-0000-0000-0000-000000000201',77,'Synthetic query-plan budget','Draft',
  '11200000-0000-0000-0000-000000000101');

insert into public.project_documents
 (org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,
  ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
select '11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000201',
 'Specification','Synthetic project ref '||g,'Draft','11200000-0000-0000-0000-000000000101',
 'onedrive','plan-drive','project-item-'||g,'https://example.invalid/project/'||g,
 'Synthetic project file '||g,'file','11200000-0000-0000-0000-000000000101',now()
from generate_series(1,1000) g;
insert into public.procurement_documents
 (org_id,procurement_id,type,reference_number,status,link,source,ms_drive_id,ms_item_id,
  ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
select '11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000202',
 'evidence','plan-ref-'||g,'Draft','https://example.invalid/procurement/'||g,'onedrive',
 'plan-drive','procurement-item-'||g,'Synthetic procurement file '||g,'file',
 '11200000-0000-0000-0000-000000000101',now()
from generate_series(1,1000) g;
insert into public.budget_version_document_links
 (org_id,budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
select '11200000-0000-0000-0000-000000000001','11200000-0000-0000-0000-000000000203',
 'plan-drive','budget-item-'||g,'https://example.invalid/budget/'||g,
 'Synthetic budget file '||g,'file','11200000-0000-0000-0000-000000000101',now()
from generate_series(1,1000) g;

analyze public.project_documents;
analyze public.procurement_documents;
analyze public.budget_version_document_links;

select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='project_documents_project_idx'),
 'AC-M365DOC-066 project parent lookup has an indexed key');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='project_documents_ms_identity_idx'),
 'AC-M365DOC-066 project identity lookup has an indexed key');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='procurement_documents_procurement_idx'),
 'AC-M365DOC-066 procurement parent lookup has an indexed key');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='procurement_documents_ms_identity_idx'),
 'AC-M365DOC-066 procurement identity lookup has an indexed key');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='m365_budget_parent_idx'),
 'AC-M365DOC-066 budget parent lookup has an indexed key');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='m365_budget_identity_idx'),
 'AC-M365DOC-066 budget identity lookup has an indexed key');

select is((select count(*)::integer from public.project_documents
 where org_id='11200000-0000-0000-0000-000000000001'
 and project_id='11200000-0000-0000-0000-000000000201'),1000,
 'AC-M365DOC-066 project parent query returns only its bounded synthetic set');
select is((select count(*)::integer from public.project_documents
 where org_id='11200000-0000-0000-0000-000000000001' and source='onedrive'
 and ms_drive_id='plan-drive' and ms_item_id like 'project-item-%'),1000,
 'AC-M365DOC-066 project identity query returns only its bounded synthetic set');
select is((select count(*)::integer from public.procurement_documents
 where org_id='11200000-0000-0000-0000-000000000001'
 and procurement_id='11200000-0000-0000-0000-000000000202'),1000,
 'AC-M365DOC-066 procurement parent query returns only its bounded synthetic set');
select is((select count(*)::integer from public.procurement_documents
 where org_id='11200000-0000-0000-0000-000000000001' and source='onedrive'
 and ms_drive_id='plan-drive' and ms_item_id like 'procurement-item-%'),1000,
 'AC-M365DOC-066 procurement identity query returns only its bounded synthetic set');
select is((select count(*)::integer from public.budget_version_document_links
 where org_id='11200000-0000-0000-0000-000000000001'
 and budget_version_id='11200000-0000-0000-0000-000000000203'),1000,
 'AC-M365DOC-066 budget parent query returns only its bounded synthetic set');
select is((select count(*)::integer from public.budget_version_document_links
 where org_id='11200000-0000-0000-0000-000000000001'
 and ms_drive_id='plan-drive' and ms_item_id like 'budget-item-%'),1000,
 'AC-M365DOC-066 budget identity query returns only its bounded synthetic set');

create temporary table m365_link_query_plans(label text, plan jsonb);
do $$ declare p jsonb; begin
 execute 'explain (format json, costs off) select id from public.project_documents where org_id=''11200000-0000-0000-0000-000000000001'' and project_id=''11200000-0000-0000-0000-000000000201''' into p;
 insert into m365_link_query_plans values ('project-parent',p);
 execute 'explain (format json, costs off) select id from public.project_documents where org_id=''11200000-0000-0000-0000-000000000001'' and source=''onedrive'' and ms_drive_id=''plan-drive'' and ms_item_id=''project-item-1''' into p;
 insert into m365_link_query_plans values ('project-identity',p);
 execute 'explain (format json, costs off) select id from public.procurement_documents where org_id=''11200000-0000-0000-0000-000000000001'' and procurement_id=''11200000-0000-0000-0000-000000000202''' into p;
 insert into m365_link_query_plans values ('procurement-parent',p);
 execute 'explain (format json, costs off) select id from public.procurement_documents where org_id=''11200000-0000-0000-0000-000000000001'' and source=''onedrive'' and ms_drive_id=''plan-drive'' and ms_item_id=''procurement-item-1''' into p;
 insert into m365_link_query_plans values ('procurement-identity',p);
 execute 'explain (format json, costs off) select id from public.budget_version_document_links where org_id=''11200000-0000-0000-0000-000000000001'' and budget_version_id=''11200000-0000-0000-0000-000000000203''' into p;
 insert into m365_link_query_plans values ('budget-parent',p);
 execute 'explain (format json, costs off) select id from public.budget_version_document_links where org_id=''11200000-0000-0000-0000-000000000001'' and ms_drive_id=''plan-drive'' and ms_item_id=''budget-item-1''' into p;
 insert into m365_link_query_plans values ('budget-identity',p);
end $$;
select diag(string_agg(label||': '||plan::text,E'\n' order by label)) from m365_link_query_plans;
select is((select count(*)::integer from m365_link_query_plans where plan is not null),6,
 'AC-M365DOC-066 EXPLAIN captured all six parent and identity lookup plans without assuming planner node selection');

select * from finish();
rollback;
