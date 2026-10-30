begin;
select plan(26);
insert into organizations (id,name,default_currency) values ('c0300000-0000-0000-0000-000000000001','Currency test','USD');
insert into organizations (id,name,default_currency) values ('c0300000-0000-0000-0000-000000000008','Other currency test','USD');
insert into projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat) values ('c0300000-0000-0000-0000-000000000009','c0300000-0000-0000-0000-000000000008','Other project','Ongoing Project','USD',10,'exclusive',0,0,1,1,false);
insert into auth.users (id,email) values ('c0300000-0000-0000-0000-000000000002','currency-test@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values ('c0300000-0000-0000-0000-000000000002','c0300000-0000-0000-0000-000000000001','Manager','currency-test@example.test','Project Manager','active');
insert into projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat,project_manager_id) values
('c0300000-0000-0000-0000-000000000003','c0300000-0000-0000-0000-000000000001','Currency project','Ongoing Project','USD',5000,'exclusive',0,0,1,1,false,'c0300000-0000-0000-0000-000000000002');
insert into procurements (id,org_id,title,status,total_value,currency,project_id,requested_by_id)
select gen_random_uuid(),'c0300000-0000-0000-0000-000000000001','Purchase '||g,'Ordered',1,'USD','c0300000-0000-0000-0000-000000000003','c0300000-0000-0000-0000-000000000002' from generate_series(1,1001) g;
insert into procurements (id,org_id,title,status,total_value,currency,project_id,requested_by_id) values
('c0300000-0000-0000-0000-000000000004','c0300000-0000-0000-0000-000000000001','Foreign purchase','Ordered',300,'IDR','c0300000-0000-0000-0000-000000000003','c0300000-0000-0000-0000-000000000002');
insert into budget_versions (id,org_id,project_id,version,name,status,currency) values
('c0300000-0000-0000-0000-000000000005','c0300000-0000-0000-0000-000000000001','c0300000-0000-0000-0000-000000000003',1,'Budget','Draft','USD');
insert into budget_line_items (org_id,budget_version_id,category,description,budgeted_amount) values
('c0300000-0000-0000-0000-000000000001','c0300000-0000-0000-0000-000000000005','Labor','Budget',1000);
update budget_versions set status='Active' where id='c0300000-0000-0000-0000-000000000005';
set local role authenticated;
set local request.jwt.claims='{"sub":"c0300000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select (actuals->>'total')::numeric from get_projects_money_collection(array['c0300000-0000-0000-0000-000000000003'::uuid])),1001::numeric,'Collection retains project currency over the row cap');
select is((select actuals->>'complete' from get_projects_money_collection(array['c0300000-0000-0000-0000-000000000003'::uuid])),'false','Collection marks foreign positions incomplete');
select is((select (x->>'spent')::numeric from json_array_elements(get_executive_dashboard()->'top_projects') x where x->>'id'='c0300000-0000-0000-0000-000000000003'),1001::numeric,'Executive uses project currency');
select is((select x->>'actual_complete' from json_array_elements(get_executive_dashboard()->'top_projects') x where x->>'id'='c0300000-0000-0000-0000-000000000003'),'false','Executive marks foreign positions incomplete');
select is((select (x->>'spent')::numeric from json_array_elements(get_pm_dashboard_projects()) x where x->>'id'='c0300000-0000-0000-0000-000000000003'),1001::numeric,'PM dashboard uses project currency');
select is((select x->>'actual_complete' from json_array_elements(get_pm_dashboard_projects()) x where x->>'id'='c0300000-0000-0000-0000-000000000003'),'false','PM dashboard marks foreign positions incomplete');
select is((select x->>'contract_remaining' from json_array_elements(get_pm_dashboard_projects()) x where x->>'id'='c0300000-0000-0000-0000-000000000003'),null,'PM dashboard withholds incomplete remaining');
select is((select committed_spend from get_projects_delivery(array['c0300000-0000-0000-0000-000000000003'::uuid])),null::numeric,'Delivery withholds incomplete commitment');
select is((select amount from project_committed_spend('c0300000-0000-0000-0000-000000000003') where is_project_currency),1001::numeric,'Overview retains project currency');
select is((select amount from project_committed_spend('c0300000-0000-0000-0000-000000000003') where currency='IDR'),300::numeric,'Overview retains foreign currency');
select is((get_executive_dashboard()->>'projects_at_risk')::int,0,'Incomplete currency position is excluded from risk');
select is((get_executive_dashboard()->>'risk_unchecked_projects')::int,1,'Incomplete currency position is counted as unchecked');
select is((select count(*)::int from project_pmo_commitment_position('00000000-0000-0000-0000-000000000001')),0,'Unavailable projects return no position');
select is((select count(*)::int from project_pmo_commitment_position('c0300000-0000-0000-0000-000000000009')),0,'Other organizations return no position');
select is((select count(*)::int from get_projects_money_collection(array['c0300000-0000-0000-0000-000000000009'::uuid])),0,'Collection excludes other organizations');
select ok(not has_function_privilege('anon','public.project_pmo_commitment_position(uuid)','EXECUTE'),'Anonymous execution is unavailable');
reset role;
insert into auth.users (id,email) values ('c0300000-0000-0000-0000-000000000006','currency-engineer@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values ('c0300000-0000-0000-0000-000000000006','c0300000-0000-0000-0000-000000000001','Engineer','currency-engineer@example.test','Engineer','active');
set local role authenticated;
set local request.jwt.claims='{"sub":"c0300000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((select count(*)::int from project_pmo_commitment_position('c0300000-0000-0000-0000-000000000003')),0,'Restricted role receives no aggregate position');
select throws_ok($$select * from get_projects_money_collection(array['c0300000-0000-0000-0000-000000000003'::uuid])$$,'42501',null,'Restricted role cannot read collection finances');
reset role;
insert into auth.users (id,email) values
('c0300000-0000-0000-0000-000000000011','currency-admin@example.test'),
('c0300000-0000-0000-0000-000000000012','currency-exec@example.test'),
('c0300000-0000-0000-0000-000000000013','currency-finance@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values
('c0300000-0000-0000-0000-000000000011','c0300000-0000-0000-0000-000000000001','Admin','currency-admin@example.test','Admin','active'),
('c0300000-0000-0000-0000-000000000012','c0300000-0000-0000-0000-000000000001','Executive','currency-exec@example.test','Executive','active'),
('c0300000-0000-0000-0000-000000000013','c0300000-0000-0000-0000-000000000001','Finance','currency-finance@example.test','Finance','active');
set local role authenticated;
set local request.jwt.claims='{"sub":"c0300000-0000-0000-0000-000000000011","role":"authenticated"}';
select is((select amount from project_pmo_commitment_position('c0300000-0000-0000-0000-000000000003')),1001::numeric,'Admin reads the full same-currency position');
set local request.jwt.claims='{"sub":"c0300000-0000-0000-0000-000000000012","role":"authenticated"}';
select is((select amount from project_pmo_commitment_position('c0300000-0000-0000-0000-000000000003')),1001::numeric,'Executive reads the full same-currency position');
set local request.jwt.claims='{"sub":"c0300000-0000-0000-0000-000000000013","role":"authenticated"}';
select is((select amount from project_pmo_commitment_position('c0300000-0000-0000-0000-000000000003')),1001::numeric,'Finance reads the full same-currency position');
reset role;
delete from procurements where id='c0300000-0000-0000-0000-000000000004';
alter table procurements alter column currency drop not null;
alter table procurements disable trigger procurements_zz_stamp_currency;
insert into procurements (id,org_id,title,status,total_value,currency,project_id,requested_by_id) values
('c0300000-0000-0000-0000-000000000007','c0300000-0000-0000-0000-000000000001','Unknown purchase','Ordered',50,null,'c0300000-0000-0000-0000-000000000003','c0300000-0000-0000-0000-000000000002');
set local role authenticated;
set local request.jwt.claims='{"sub":"c0300000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select actuals->>'complete' from get_projects_money_collection(array['c0300000-0000-0000-0000-000000000003'::uuid])),'false','Unknown currency makes the collection position incomplete');
select is((select (actuals->>'total')::numeric from get_projects_money_collection(array['c0300000-0000-0000-0000-000000000003'::uuid])),1001::numeric,'Unknown currency is never added to the project currency');
select is((select x->>'actual_complete' from json_array_elements(get_executive_dashboard()->'top_projects') x where x->>'id'='c0300000-0000-0000-0000-000000000003'),'false','Executive marks unknown currency incomplete');
reset role;
delete from procurements where id='c0300000-0000-0000-0000-000000000007';
update budget_versions set currency='IDR' where id='c0300000-0000-0000-0000-000000000005';
set local role authenticated;
set local request.jwt.claims='{"sub":"c0300000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((get_executive_dashboard()->>'projects_at_risk')::int,0,'Different budget currency is excluded from risk');
select is((get_executive_dashboard()->>'risk_unchecked_projects')::int,1,'Different budget currency is counted as unchecked');
reset role;
select * from finish();
rollback;
