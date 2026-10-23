begin;
select plan(46);
insert into organizations (id,name,default_currency) values ('03670000-0000-0000-0000-0000000000c0','API operator reads','IDR');
insert into auth.users(id,email) values
('03670000-0000-0000-0000-0000000000c1','op-fin@example.com'),('03670000-0000-0000-0000-0000000000c2','op-eng@example.com'),
('03670000-0000-0000-0000-0000000000c3','op-disabled@example.com'),('03670000-0000-0000-0000-0000000000c4','op-pm@example.com'),
('03670000-0000-0000-0000-0000000000c5','op-exec@example.com'),('03670000-0000-0000-0000-0000000000c6','op-admin@example.com');
insert into organizations(id,name) values ('03670000-0000-0000-0000-0000000000d0','Other operator org');
insert into profiles(id,org_id,full_name,email,role,status) values
('03670000-0000-0000-0000-0000000000c1','03670000-0000-0000-0000-0000000000c0','Finance','op-fin@example.com','Finance','active'),
('03670000-0000-0000-0000-0000000000c2','03670000-0000-0000-0000-0000000000c0','Engineer','op-eng@example.com','Engineer','active'),
('03670000-0000-0000-0000-0000000000c3','03670000-0000-0000-0000-0000000000c0','Disabled','op-disabled@example.com','Finance','disabled'),
('03670000-0000-0000-0000-0000000000c4','03670000-0000-0000-0000-0000000000c0','PM','op-pm@example.com','Project Manager','active'),
('03670000-0000-0000-0000-0000000000c5','03670000-0000-0000-0000-0000000000c0','Executive','op-exec@example.com','Executive','active'),
('03670000-0000-0000-0000-0000000000c6','03670000-0000-0000-0000-0000000000c0','Admin','op-admin@example.com','Admin','active');
insert into projects(id,org_id,name,code) values
('03670000-0000-0000-0000-0000000000d1','03670000-0000-0000-0000-0000000000c0','Own project','OPR-OWN'),
('03670000-0000-0000-0000-0000000000d2','03670000-0000-0000-0000-0000000000d0','Foreign project','OPR-OTHER');
insert into project_documents(id,org_id,project_id,category,title,author_id) values
('03670000-0000-0000-0000-0000000000d3','03670000-0000-0000-0000-0000000000c0','03670000-0000-0000-0000-0000000000d1','Reference','Own doc','03670000-0000-0000-0000-0000000000c1'),
('03670000-0000-0000-0000-0000000000d4','03670000-0000-0000-0000-0000000000d0','03670000-0000-0000-0000-0000000000d2','Reference','Foreign doc','03670000-0000-0000-0000-0000000000c1');
insert into erp_gl_entry_mirror(org_id,erp_name,account,project,erp_modified) values
('03670000-0000-0000-0000-0000000000c0','OPR-OWN-GL','Direct Cost','OPR-OWN','1'),
('03670000-0000-0000-0000-0000000000d0','OPR-OTHER-GL','Direct Cost','OPR-OTHER','1');
insert into budget_versions(id,org_id,project_id,version,name,status) values
('03670000-0000-0000-0000-0000000000e1','03670000-0000-0000-0000-0000000000c0','03670000-0000-0000-0000-0000000000d1',1,'Draft v1','Draft');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status) values
('03670000-0000-0000-0000-0000000000e2','03670000-0000-0000-0000-0000000000c0','Operator purchase','03670000-0000-0000-0000-0000000000c1','IDR',1,'Draft');
insert into org_m365_document_settings(org_id,default_site_id,default_site_name,default_drive_id,default_drive_name,updated_by) values
('03670000-0000-0000-0000-0000000000c0','x.sharepoint.com,site-a,web-a','Site','drive-a','Library','03670000-0000-0000-0000-0000000000c6');
insert into auth.users(id,email) values ('03670000-0000-0000-0000-0000000000c7','op-other-fin@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
('03670000-0000-0000-0000-0000000000c7','03670000-0000-0000-0000-0000000000d0','Other Finance','op-other-fin@example.com','Finance','active');
insert into budget_versions(id,org_id,project_id,version,name,status) values
('03670000-0000-0000-0000-0000000000f1','03670000-0000-0000-0000-0000000000d0','03670000-0000-0000-0000-0000000000d2',1,'Foreign draft','Draft');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status) values
('03670000-0000-0000-0000-0000000000f2','03670000-0000-0000-0000-0000000000d0','Foreign purchase','03670000-0000-0000-0000-0000000000c7','IDR',1,'Draft'),
('03670000-0000-0000-0000-0000000000e3','03670000-0000-0000-0000-0000000000c0','Second purchase','03670000-0000-0000-0000-0000000000c1','IDR',1,'Draft');
create or replace function pg_temp.req(p_sub text,p_method text,p_path text) returns void language sql as $$
select set_config('request.jwt.claims',json_build_object('sub',p_sub,'role','authenticated','client_id','pmo-cli')::text,true),
set_config('request.method',p_method,true),set_config('request.path',p_path,true),set_config('request.headers','{}',true);$$;
set local role authenticated;
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','GET','/budget_versions');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active Finance reads budgets');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','GET','/budget_line_items');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active Finance reads budget lines');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','GET','/budget_category_account_map');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active Finance reads account map');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','GET','/erp_gl_entry_mirror');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active Finance reads GL mirror');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','GET','/project_documents');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active Finance reads project documents');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','GET','/org_m365_document_settings');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active Finance reads document settings');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','GET','/m365_record_folder_sweeps');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active Finance reads sweep summary');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','POST','/rpc/project_mapped_actuals');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active Finance calls mapped actuals');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','POST','/rpc/link_m365_documents_batch');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active Finance calls document batch');
select pg_temp.req('03670000-0000-0000-0000-0000000000c4','GET','/project_documents');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active PM read');
select pg_temp.req('03670000-0000-0000-0000-0000000000c5','GET','/project_documents');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active Executive read');
select pg_temp.req('03670000-0000-0000-0000-0000000000c6','GET','/project_documents');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 active Admin read');
select pg_temp.req('03670000-0000-0000-0000-0000000000c2','GET','/project_documents');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-OPR-001 Engineer refused');
select pg_temp.req('03670000-0000-0000-0000-0000000000c2','POST','/rpc/link_m365_documents_batch');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-OPR-001 Engineer refused document batch');
select pg_temp.req('03670000-0000-0000-0000-0000000000c3','GET','/project_documents');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-OPR-001 disabled member refused');
select pg_temp.req('03670000-0000-0000-0000-0000000000c3','POST','/rpc/link_m365_documents_batch');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-OPR-001 disabled member refused document batch');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','DELETE','/project_documents');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-OPR-001 deletes stay app-only');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','POST','/budget_category_account_map');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-OPR-001 map writes stay app-only');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','POST','/rpc/unlink_erp_purchase_document');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-OPR-001 unlink stays app-only');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','GET','/erp_gl_entry_mirror');
select lives_ok('select count(*) from public.erp_gl_entry_mirror','AC-OPR-002 active CLI reads GL mirror through table grants and RLS');
select is((select count(*)::int from public.erp_gl_entry_mirror where erp_name like 'OPR-%-GL'),1,'AC-OPR-002 GL mirror hides the other org row');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','GET','/project_documents');
select lives_ok('select count(*) from public.project_documents','AC-OPR-002 active CLI reads project documents through table grants and RLS');
select is((select count(*)::int from public.project_documents where id in ('03670000-0000-0000-0000-0000000000d3','03670000-0000-0000-0000-0000000000d4')),1,'AC-OPR-002 project documents hide the other org row');
select lives_ok($q$select * from public.project_mapped_actuals('03670000-0000-0000-0000-0000000000d1',null)$q$,'AC-OPR-002 active CLI calls project_mapped_actuals');
-- link_m365_documents_batch behaviour (dry run, real link, idempotence, tenancy, role, validation)
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','POST','/rpc/link_m365_documents_batch');
select is((public.link_m365_documents_batch('[{"project_id":"03670000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"i1","web_url":"https://x.sharepoint.com/a","name":"A","kind":"file"}]'::jsonb,true))->'results'->0->>'state','linked','AC-OPR-003 dry run reports the planned link');
select is((select count(*)::int from public.project_documents where ms_item_id='i1'),0,'AC-OPR-003 dry run writes nothing');
select is((public.link_m365_documents_batch('[{"project_id":"03670000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"i1","web_url":"https://x.sharepoint.com/a","name":"A","kind":"file"},{"budget_version_id":"03670000-0000-0000-0000-0000000000e1","drive_id":"d1","item_id":"i2","web_url":"https://x.sharepoint.com/b","name":"B","kind":"file"},{"procurement_id":"03670000-0000-0000-0000-0000000000e2","drive_id":"d1","item_id":"i3","web_url":"https://x.sharepoint.com/c","name":"C","kind":"folder"}]'::jsonb,false))->>'dry_run','false','AC-OPR-003 real run links project, budget version and purchase');
select is((select count(*)::int from public.project_documents where ms_item_id='i1')+(select count(*)::int from public.budget_version_document_links where ms_item_id='i2')+(select count(*)::int from public.procurement_documents where ms_item_id='i3'),3,'AC-OPR-003 all three rows written');
select is((public.link_m365_documents_batch('[{"project_id":"03670000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"i1","web_url":"https://x.sharepoint.com/a","name":"A","kind":"file"}]'::jsonb,false))->'results'->0->>'state','already_linked','AC-OPR-003 re-run is idempotent');
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03670000-0000-0000-0000-0000000000d2","drive_id":"d1","item_id":"i9","web_url":"https://x.sharepoint.com/z","name":"Z","kind":"file"}]'::jsonb,false)$q$,'42501',null,'AC-OPR-003 another org project refused');
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03670000-0000-0000-0000-0000000000d1","procurement_id":"03670000-0000-0000-0000-0000000000e2","drive_id":"d1","item_id":"i8","web_url":"https://x.sharepoint.com/z","name":"Z","kind":"file"}]'::jsonb,false)$q$,'22023',null,'AC-OPR-003 two targets refused');
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03670000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"i8","web_url":"http://insecure","name":"Z","kind":"file"}]'::jsonb,false)$q$,'22023',null,'AC-OPR-003 non-https url refused');
select pg_temp.req('03670000-0000-0000-0000-0000000000c2','POST','/rpc/link_m365_documents_batch');
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03670000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"e1","web_url":"https://x.sharepoint.com/e","name":"E","kind":"file"}]'::jsonb,false)$q$,'42501',null,'AC-OPR-003 Engineer cannot call the RPC directly');
select pg_temp.req('03670000-0000-0000-0000-0000000000c3','POST','/rpc/link_m365_documents_batch');
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03670000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"e2","web_url":"https://x.sharepoint.com/e","name":"E","kind":"file"}]'::jsonb,false)$q$,'42501',null,'AC-OPR-003 disabled member cannot call the RPC directly');
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','GET','/m365_record_folder_sweeps');
select is((select count(*)::int from public.m365_record_folder_sweeps),0,'AC-OPR-004 active Finance reads sweep summary rows through RLS (none yet)');
reset role;
insert into m365_record_folder_sweeps(org_id,actor_id,state,counts) values
('03670000-0000-0000-0000-0000000000c0','03670000-0000-0000-0000-0000000000c6','complete','{"scanned":1}'),
('03670000-0000-0000-0000-0000000000d0','03670000-0000-0000-0000-0000000000c6','complete','{"scanned":9}');
set local role authenticated;
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','GET','/m365_record_folder_sweeps');
select is((select count(*)::int from public.m365_record_folder_sweeps),1,'AC-OPR-004 sweep summary hides the other org row');
select pg_temp.req('03670000-0000-0000-0000-0000000000c2','GET','/m365_record_folder_sweeps');
select is((select count(*)::int from public.m365_record_folder_sweeps),0,'AC-OPR-004 Engineer sees no sweep summary');
-- hardening: host pinning, unconfigured org, folder uniqueness for purchases, foreign-org budget/purchase, PM ledger
select pg_temp.req('03670000-0000-0000-0000-0000000000c1','POST','/rpc/link_m365_documents_batch');
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03670000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"h1","web_url":"https://evil.example.com/a","name":"Z","kind":"file"}]'::jsonb,false)$q$,'22023',null,'AC-OPR-005 a foreign SharePoint host is refused');
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03670000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"h2","web_url":"https://x.sharepoint.com.evil.example/a","name":"Z","kind":"file"}]'::jsonb,true)$q$,'22023',null,'AC-OPR-005 a look-alike host suffix is refused, dry run too');
select lives_ok($q$select public.link_m365_documents_batch('[{"project_id":"03670000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"h3","web_url":"https://X.SharePoint.com/ok","name":"Z","kind":"file"}]'::jsonb,true)$q$,'AC-OPR-005 the organisation own host is accepted (case-insensitive)');
select throws_ok($q$select public.link_m365_documents_batch('[{"budget_version_id":"03670000-0000-0000-0000-0000000000f1","drive_id":"d1","item_id":"f1","web_url":"https://x.sharepoint.com/f","name":"F","kind":"file"}]'::jsonb,false)$q$,'42501',null,'AC-OPR-005 another org budget version refused');
select throws_ok($q$select public.link_m365_documents_batch('[{"procurement_id":"03670000-0000-0000-0000-0000000000f2","drive_id":"d1","item_id":"f2","web_url":"https://x.sharepoint.com/f","name":"F","kind":"file"}]'::jsonb,false)$q$,'42501',null,'AC-OPR-005 another org purchase refused');
select throws_ok($q$select public.link_m365_documents_batch('[{"procurement_id":"03670000-0000-0000-0000-0000000000e3","drive_id":"d1","item_id":"i3","web_url":"https://x.sharepoint.com/c","name":"C","kind":"folder"}]'::jsonb,false)$q$,'23514',null,'AC-OPR-005 a folder already linked to another purchase is refused');
select lives_ok($q$select public.link_m365_documents_batch('[{"procurement_id":"03670000-0000-0000-0000-0000000000e2","drive_id":"d1","item_id":"i3","web_url":"https://x.sharepoint.com/c","name":"C","kind":"folder"}]'::jsonb,false)$q$,'AC-OPR-005 re-linking the same folder to the same purchase stays idempotent');
select pg_temp.req('03670000-0000-0000-0000-0000000000c7','POST','/rpc/link_m365_documents_batch');
select throws_ok($q$select public.link_m365_documents_batch('[{"procurement_id":"03670000-0000-0000-0000-0000000000f2","drive_id":"d1","item_id":"f3","web_url":"https://x.sharepoint.com/f","name":"F","kind":"file"}]'::jsonb,false)$q$,'22023','m365_not_configured','AC-OPR-005 an org with no SharePoint library configured is refused with m365_not_configured');
select pg_temp.req('03670000-0000-0000-0000-0000000000c4','GET','/erp_gl_entry_mirror');
select is((select count(*)::int from public.erp_gl_entry_mirror),0,'AC-OPR-006 a Project Manager token reads zero GL mirror rows (ledger stays Admin/Finance by RLS)');
reset role;
select * from finish();
rollback;
