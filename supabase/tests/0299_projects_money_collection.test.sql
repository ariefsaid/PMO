begin;
create extension if not exists pgtap;
select plan(21);

insert into public.organizations (id,name,default_currency) values
 ('02990000-0000-0000-0000-000000000001','Collection read test org','IDR'),
 ('02990000-0000-0000-0000-000000000002','Other collection org','USD');
insert into auth.users (id,email) values
 ('02990000-0000-0000-0000-0000000000a1','collection-pm@example.test'),
 ('02990000-0000-0000-0000-0000000000a2','collection-engineer@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('02990000-0000-0000-0000-0000000000a1','02990000-0000-0000-0000-000000000001','Project Manager','collection-pm@example.test','Project Manager','active'),
 ('02990000-0000-0000-0000-0000000000a2','02990000-0000-0000-0000-000000000001','Engineer','collection-engineer@example.test','Engineer','active');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref)
values
 ('02990000-0000-0000-0000-0000000000d1','02990000-0000-0000-0000-000000000001','Synthetic delivery project','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'COLLECTION-ONE'),
 ('02990000-0000-0000-0000-0000000000d2','02990000-0000-0000-0000-000000000001','No reading project','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'COLLECTION-TWO'),
 ('02990000-0000-0000-0000-0000000000d3','02990000-0000-0000-0000-000000000002','Foreign project','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'COLLECTION-FOREIGN');
insert into public.procurements (id,org_id,title,status,total_value,project_id,requested_by_id) values
 ('02990000-0000-0000-0000-0000000000f1','02990000-0000-0000-0000-000000000001','ERP committed PO','Ordered',75,'02990000-0000-0000-0000-0000000000d1','02990000-0000-0000-0000-0000000000a1'),
 ('02990000-0000-0000-0000-0000000000f2','02990000-0000-0000-0000-000000000001','PMO committed PO','Ordered',45,'02990000-0000-0000-0000-0000000000d2','02990000-0000-0000-0000-0000000000a1');
insert into public.external_org_bindings (org_id,external_tier,site_url,secret_ref,status,connected_by,connected_at)
values ('02990000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','test-ref','active','02990000-0000-0000-0000-0000000000a1',now());
set local request.jwt.claims='{}';
set local role service_role;
insert into public.budget_category_account_map (org_id,category,erp_account,is_push_target) values
 ('02990000-0000-0000-0000-000000000001','Labor','COLLECTION-LABOR',true);
insert into public.erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at) values
 ('02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000d1','COLLECTION-LABOR','FY-2026',125,'2026-10-01','02990000-0000-0000-0000-0000000000b1','2026-10-02'),
 ('02990000-0000-0000-0000-000000000002','02990000-0000-0000-0000-0000000000d3','COLLECTION-LABOR','FY-2026',900,'2026-10-01','02990000-0000-0000-0000-0000000000b2','2026-10-02');
insert into public.budget_versions (id,org_id,project_id,version,name,status,currency,created_at) values
 ('02990000-0000-0000-0000-0000000000c1','02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000d1',1,'Active version','Draft','USD','2026-01-01'),
 ('02990000-0000-0000-0000-0000000000c2','02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000d1',2,'Draft version','Draft','USD','2026-02-01'),
 ('02990000-0000-0000-0000-0000000000c3','02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000d2',1,'PO risk budget','Draft','USD','2026-03-01');
insert into public.budget_line_items (org_id,budget_version_id,category,description,budgeted_amount,fiscal_year) values
 ('02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000c1','Labor','Active synthetic budget',500,'FY-2026'),
 ('02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000c1','Materials','Unmapped budgeted category',100,'FY-2026'),
 ('02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000c2','Labor','Draft must not drive risk',900,'FY-2026'),
 ('02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000c3','Labor','PO project active budget',40,'FY-2026');
update public.budget_versions set status='Active' where id in ('02990000-0000-0000-0000-0000000000c1','02990000-0000-0000-0000-0000000000c3');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"02990000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select actuals->>'total' from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          public.get_project_finances('02990000-0000-0000-0000-0000000000d1')->'actuals'->>'total',
          'AC-S02-001 collection Actual equals the shipped single-project mapped-cost result');
select is((select (actuals->>'total')::numeric from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          125::numeric,'AC-S02-001 delivery Actual reads mapped ledger cost');
select is((select ledger_basis from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          'erp','AC-S02-001 ERP-bound org returns ERP basis');
select is((select active_budget_amount::numeric from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          600::numeric,'AC-S02-002 active budget is used rather than the newer Draft amount');
select is((select has_active_budget from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          true,'AC-S02-002 Active budget presence is explicit');
select is((select active_budget_currency from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          'USD','AC-S02-007 Active budget retains its currency for safe denominator comparisons');
select is((select actuals->>'currency' from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          'IDR','A1 collection preserves the ERP Actual currency');
select is((select actuals->>'complete' from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          'false','A2 an unmapped budgeted category makes ERP Actual incomplete');
select is((select x->>'realized_margin' from json_array_elements(public.get_executive_dashboard()->'top_projects') x where x->>'id'='02990000-0000-0000-0000-0000000000d1'),
          null,'A1 cross-currency ledger Actual does not produce realized margin');
select is((public.get_executive_dashboard()->>'projects_at_risk')::int,0,'A1/A2 cross-currency and incomplete Actual never enters at-risk');
select is((select active_budget_amount::numeric from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d2'::uuid]) limit 1),
          40::numeric,'AC-S02-002 PO risk project uses its Active budget');
select is((select has_active_budget from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d2'::uuid]) limit 1),
          true,'AC-S02-002 PO risk project has an Active budget');
reset role;
update public.external_org_bindings set status='disconnected' where org_id='02990000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"02990000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select (actuals->>'total')::numeric from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d2'::uuid]) limit 1),
          45::numeric,'AC-S02-001 non-ERP org returns committed PO Actual');
select is((select ledger_basis from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d2'::uuid]) limit 1),
          'pmo','AC-S02-001 non-ERP org returns PMO basis');
select is((select count(*)::int from public.get_projects_money_collection(array[
          '02990000-0000-0000-0000-0000000000d1'::uuid,'02990000-0000-0000-0000-0000000000d1'::uuid,
          '02990000-0000-0000-0000-0000000000d3'::uuid])),1,'AC-S02-003 duplicate IDs collapse and foreign-org projects are excluded');
select is((select (actuals->>'total') from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d2'::uuid]) limit 1),
          '45.00','AC-S02-001 the non-ERP project uses its committed PO instead of a missing ERP snapshot');
select is((select actuals->>'complete' from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d2'::uuid]) limit 1),
          'true','A2 a successful PO read is complete without ERP categories');
select is((public.get_executive_dashboard()->>'projects_at_risk')::int,1,'A2 committed-PO project is included in dashboard at-risk');
select throws_ok($$select * from public.get_projects_money_collection(array[]::uuid[])$$,'22023',null,
                 'AC-S02-005 invalid empty collection is rejected');
set local request.jwt.claims='{"sub":"02990000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select * from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid])$$,'42501',null,
                 'AC-S02-006 Engineer cannot read collection finances');
reset role;
select ok(not has_function_privilege('anon','public.get_projects_money_collection(uuid[])','EXECUTE'),
          'AC-S02-006 anonymous access is revoked');
select * from finish();
rollback;
