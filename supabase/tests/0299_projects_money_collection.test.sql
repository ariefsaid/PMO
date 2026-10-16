begin;
create extension if not exists pgtap;
select plan(12);

insert into public.organizations (id,name) values
 ('02990000-0000-0000-0000-000000000001','Collection read test org'),
 ('02990000-0000-0000-0000-000000000002','Other collection org');
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
set local request.jwt.claims='{}';
set local role service_role;
insert into public.budget_category_account_map (org_id,category,erp_account,is_push_target) values
 ('02990000-0000-0000-0000-000000000001','Labor','COLLECTION-LABOR',true);
insert into public.erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at) values
 ('02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000d1','COLLECTION-LABOR','FY-2026',125,'2026-10-01','02990000-0000-0000-0000-0000000000b1','2026-10-02'),
 ('02990000-0000-0000-0000-000000000002','02990000-0000-0000-0000-0000000000d3','COLLECTION-LABOR','FY-2026',900,'2026-10-01','02990000-0000-0000-0000-0000000000b2','2026-10-02');
insert into public.budget_versions (id,org_id,project_id,version,name,status,currency,created_at) values
 ('02990000-0000-0000-0000-0000000000c1','02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000d1',1,'Active version','Draft','USD','2026-01-01'),
 ('02990000-0000-0000-0000-0000000000c2','02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000d1',2,'Draft version','Draft','USD','2026-02-01');
insert into public.budget_line_items (org_id,budget_version_id,category,description,budgeted_amount,fiscal_year) values
 ('02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000c1','Labor','Active synthetic budget',500,'FY-2026'),
 ('02990000-0000-0000-0000-000000000001','02990000-0000-0000-0000-0000000000c2','Labor','Draft must not drive risk',900,'FY-2026');
update public.budget_versions set status='Active' where id='02990000-0000-0000-0000-0000000000c1';
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"02990000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select actuals->>'total' from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          public.get_project_finances('02990000-0000-0000-0000-0000000000d1')->'actuals'->>'total',
          'AC-S02-001 collection Actual equals the shipped single-project mapped-cost result');
select is((select (actuals->>'total')::numeric from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          125::numeric,'AC-S02-001 delivery Actual reads mapped ledger cost');
select is((select active_budget_amount::numeric from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          500::numeric,'AC-S02-002 active budget is used rather than the newer Draft amount');
select is((select has_active_budget from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          true,'AC-S02-002 Active budget presence is explicit');
select is((select active_budget_currency from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d1'::uuid]) limit 1),
          'USD','AC-S02-007 Active budget retains its currency for safe denominator comparisons');
select is((select active_budget_amount::numeric from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d2'::uuid]) limit 1),
          null::numeric,'AC-S02-002 missing Active budget is unavailable, not zero');
select is((select has_active_budget from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d2'::uuid]) limit 1),
          false,'AC-S02-002 a Draft-only project has no Active budget');
select is((select count(*)::int from public.get_projects_money_collection(array[
          '02990000-0000-0000-0000-0000000000d1'::uuid,'02990000-0000-0000-0000-0000000000d1'::uuid,
          '02990000-0000-0000-0000-0000000000d3'::uuid])),1,'AC-S02-003 duplicate IDs collapse and foreign-org projects are excluded');
select is((select (actuals->>'total') from public.get_projects_money_collection(array['02990000-0000-0000-0000-0000000000d2'::uuid]) limit 1),
          null,'AC-S02-004 a missing snapshot remains unknown, not zero');
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
