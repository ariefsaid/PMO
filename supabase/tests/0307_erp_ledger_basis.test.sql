begin;
select plan(20);

insert into public.organizations (id,name) values
 ('03070000-0000-0000-0000-000000000001','ERP ledger basis org'),
 ('03070000-0000-0000-0000-000000000002','PMO ledger basis org');
insert into auth.users (id,email) values
 ('03070000-0000-0000-0000-0000000000a1','admin0307@example.test'),
 ('03070000-0000-0000-0000-0000000000a2','pm0307@example.test'),
 ('03070000-0000-0000-0000-0000000000a3','engineer0307@example.test'),
 ('03070000-0000-0000-0000-0000000000a4','exec0307@example.test'),
 ('03070000-0000-0000-0000-0000000000a5','pmo0307@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('03070000-0000-0000-0000-0000000000a1','03070000-0000-0000-0000-000000000001','Admin','admin0307@example.test','Admin','active'),
 ('03070000-0000-0000-0000-0000000000a2','03070000-0000-0000-0000-000000000001','PM','pm0307@example.test','Project Manager','active'),
 ('03070000-0000-0000-0000-0000000000a3','03070000-0000-0000-0000-000000000001','Engineer','engineer0307@example.test','Engineer','active'),
 ('03070000-0000-0000-0000-0000000000a4','03070000-0000-0000-0000-000000000001','Executive','exec0307@example.test','Executive','active'),
 ('03070000-0000-0000-0000-0000000000a5','03070000-0000-0000-0000-000000000002','PMO member','pmo0307@example.test','Admin','active');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat) values
 ('03070000-0000-0000-0000-0000000000d1','03070000-0000-0000-0000-000000000001','ERP project','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false),
 ('03070000-0000-0000-0000-0000000000d2','03070000-0000-0000-0000-000000000002','PMO project','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false);
insert into public.procurements (id,org_id,title,status,total_value,project_id,requested_by_id) values
 ('03070000-0000-0000-0000-0000000000f1','03070000-0000-0000-0000-000000000001','ERP PO','Ordered',75,'03070000-0000-0000-0000-0000000000d1','03070000-0000-0000-0000-0000000000a1'),
 ('03070000-0000-0000-0000-0000000000f2','03070000-0000-0000-0000-000000000002','PMO PO','Ordered',75,'03070000-0000-0000-0000-0000000000d2','03070000-0000-0000-0000-0000000000a5');
insert into public.external_org_bindings (org_id,external_tier,site_url,secret_ref,status,connected_by,connected_at)
values
 ('03070000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','test-ref','active','03070000-0000-0000-0000-0000000000a1',now()),
 ('03070000-0000-0000-0000-000000000002','clickup','https://clickup.example.test','test-ref','active','03070000-0000-0000-0000-0000000000a5',now());
insert into public.budget_category_account_map (org_id,category,erp_account,is_push_target)
values ('03070000-0000-0000-0000-000000000001','Labor','0307-LABOR',true);
insert into public.erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at)
values ('03070000-0000-0000-0000-000000000001','03070000-0000-0000-0000-0000000000d1','0307-LABOR','FY-2026',120,now(),'03070000-0000-0000-0000-0000000000b1',now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"03070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select ok(public.org_reads_erp_ledger(), 'active ERPNext binding selects ERP ledger');
select is((select (x->>'spent')::numeric from json_array_elements(public.get_executive_dashboard()->'top_projects') x where x->>'id'='03070000-0000-0000-0000-0000000000d1'),120::numeric,'ERP dashboard Actual uses mapped ledger cost, not committed PO');
select ok(has_function_privilege('authenticated','public.org_reads_erp_ledger()','EXECUTE'),'authenticated can call helper');

set local request.jwt.claims to '{"sub":"03070000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select ok(public.org_reads_erp_ledger(),'PM sees same ERP ledger basis as Admin');
select is((select (x->>'spent')::numeric from json_array_elements(public.get_executive_dashboard()->'top_projects') x where x->>'id'='03070000-0000-0000-0000-0000000000d1'),120::numeric,'PM dashboard uses the same ERP Actual as Admin');
set local request.jwt.claims to '{"sub":"03070000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select ok(public.org_reads_erp_ledger(),'Engineer sees same ERP ledger basis as Admin');
select is((select (x->>'spent')::numeric from json_array_elements(public.get_executive_dashboard()->'top_projects') x where x->>'id'='03070000-0000-0000-0000-0000000000d1'),120::numeric,'Engineer dashboard uses the same ERP Actual as Admin');
set local request.jwt.claims to '{"sub":"03070000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select ok(public.org_reads_erp_ledger(),'Executive sees same ERP ledger basis as Admin');
select is((select (x->>'spent')::numeric from json_array_elements(public.get_executive_dashboard()->'top_projects') x where x->>'id'='03070000-0000-0000-0000-0000000000d1'),120::numeric,'Executive dashboard uses the same ERP Actual as Admin');

set local request.jwt.claims to '{"sub":"03070000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select ok(not public.org_reads_erp_ledger(),'org without ERPNext binding selects PMO basis');
select is((select (x->>'spent')::numeric from json_array_elements(public.get_executive_dashboard()->'top_projects') x where x->>'id'='03070000-0000-0000-0000-0000000000d2'),75::numeric,'PMO dashboard Actual uses committed POs');

reset role;
update public.external_org_bindings set status='disconnected' where org_id='03070000-0000-0000-0000-000000000001' and external_tier='erpnext';
set local role authenticated;
set local request.jwt.claims to '{"sub":"03070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select ok(not public.org_reads_erp_ledger(),'non-active ERPNext binding selects PMO basis');
reset role;
update public.external_org_bindings set status='active' where org_id='03070000-0000-0000-0000-000000000001' and external_tier='erpnext';
reset role;
update public.profiles set status='disabled' where id='03070000-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims to '{"sub":"03070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select ok(not public.org_reads_erp_ledger(),'disabled member of ERP org does not read ERP ledger');
reset role;
update public.profiles set status='active' where id='03070000-0000-0000-0000-0000000000a1';
update auth.users set banned_until=now() + interval '1 hour' where id='03070000-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims to '{"sub":"03070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select ok(not public.org_reads_erp_ledger(),'banned member of ERP org does not read ERP ledger');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"03070000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select ok(not public.org_reads_erp_ledger(),'active non-ERP binding does not select ERP ledger');
reset role;
set local role anon;
select ok(not has_function_privilege('anon','public.org_reads_erp_ledger()','EXECUTE'),'anon cannot execute helper');
reset role;
set local role authenticated;
set local request.jwt.claims to '{}';
select ok(not public.org_reads_erp_ledger(),'non-member receives false');
reset role;
update auth.users set banned_until=null where id='03070000-0000-0000-0000-0000000000a1';
update public.organizations set default_currency='IDR' where id='03070000-0000-0000-0000-000000000001';
insert into public.budget_versions (id,org_id,project_id,version,name,status,currency) values
 ('03070000-0000-0000-0000-0000000000c1','03070000-0000-0000-0000-000000000001','03070000-0000-0000-0000-0000000000d1',1,'Active ledger budget','Draft','USD');
insert into public.budget_line_items (org_id,budget_version_id,category,description,budgeted_amount,fiscal_year) values
 ('03070000-0000-0000-0000-000000000001','03070000-0000-0000-0000-0000000000c1','Labor','Mapped ledger category',100,'FY-2026');
update public.budget_versions set status='Active' where id='03070000-0000-0000-0000-0000000000c1';
set local role authenticated;
set local request.jwt.claims to '{"sub":"03070000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select x->>'spent' from json_array_elements(public.get_executive_dashboard()->'top_projects') x where x->>'id'='03070000-0000-0000-0000-0000000000d1'),null,'A1 mismatched project currency makes the Actual amount unknown, not a USD figure');
select is((select x->>'actual_currency' from json_array_elements(public.get_executive_dashboard()->'top_projects') x where x->>'id'='03070000-0000-0000-0000-0000000000d1'),'IDR','A1 dashboard returns the ledger Actual currency for correct formatting');
select is((get_executive_dashboard()->>'projects_at_risk')::int,0,'A1 mismatched-currency Actual is excluded from risk despite exceeding budget');
reset role;
select * from finish();
rollback;
