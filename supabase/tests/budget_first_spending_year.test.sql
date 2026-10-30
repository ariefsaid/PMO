begin;
select plan(11);
insert into public.organizations(id,name) values ('0b190000-0000-0000-0000-000000000001','Summary org A'),('0b190000-0000-0000-0000-000000000002','Summary org B');
insert into auth.users(id,email) values ('0b190000-0000-0000-0000-0000000000a1','summary-a@example.invalid'),('0b190000-0000-0000-0000-0000000000a2','summary-engineer@example.invalid'),('0b190000-0000-0000-0000-0000000000b1','summary-b@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('0b190000-0000-0000-0000-0000000000a1','0b190000-0000-0000-0000-000000000001','Summary A','summary-a@example.invalid','Finance','active'),
 ('0b190000-0000-0000-0000-0000000000a2','0b190000-0000-0000-0000-000000000001','Summary engineer','summary-engineer@example.invalid','Engineer','active'),
 ('0b190000-0000-0000-0000-0000000000b1','0b190000-0000-0000-0000-000000000002','Summary B','summary-b@example.invalid','Finance','active');
insert into public.projects(id,org_id,name,status) values ('0b191111-0000-0000-0000-000000000001','0b190000-0000-0000-0000-000000000001','Summary project','Ongoing Project');
insert into public.budget_category_account_map(org_id,category,erp_account) values ('0b190000-0000-0000-0000-000000000001','Labor','Summary labor'),('0b190000-0000-0000-0000-000000000001','Materials','Summary materials');
insert into public.erp_actuals_snapshot(org_id,project_id,account,fiscal_year,debit,credit,net,snapshot_id)
select '0b190000-0000-0000-0000-000000000001','0b191111-0000-0000-0000-000000000001','Summary labor','opaque-spend',1,0,1,'0b195555-0000-0000-0000-000000000001' from generate_series(1,1100);
insert into public.erp_actuals_snapshot(org_id,project_id,account,fiscal_year,debit,credit,net,snapshot_id) values
 ('0b190000-0000-0000-0000-000000000001','0b191111-0000-0000-0000-000000000001','Summary materials','opaque-spend',0,1100,-1100,'0b195555-0000-0000-0000-000000000001'),
 ('0b190000-0000-0000-0000-000000000001','0b191111-0000-0000-0000-000000000001','Summary labor','older',3,0,3,'0b195555-0000-0000-0000-000000000001');
insert into public.erp_account_mirror (org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id)
values ('0b190000-0000-0000-0000-000000000001','Summary','Summary labor','Labor','Expense','Profit and Loss',false,'IDR',1,2,'0b195555-0000-0000-0000-000000000002');
insert into public.erp_gl_entry_mirror (org_id,erp_name,company,account,fiscal_year,project,party_type,posting_date,debit,credit,is_cancelled,erp_modified)
values ('0b190000-0000-0000-0000-000000000001','Summary GL','Summary','Summary labor','attributed',null,'Employee','2025-01-01',15,0,false,'1');
set local role authenticated;
set local request.jwt.claims='{"sub":"0b190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.save_cost_attribution_rule('{"name":"Summary rule","account":"Summary labor","effective_from":"2025-01-01","targets":[{"project_id":"0b191111-0000-0000-0000-000000000001","percent":100}]}'::jsonb);
select is(public.first_budget_spending_year('0b191111-0000-0000-0000-000000000001',array['empty','opaque-spend','older']), 'opaque-spend', 'any nonzero category wins despite offsetting categories and source rows over the response cap');
select is(public.first_budget_spending_year('0b191111-0000-0000-0000-000000000001',array['older','opaque-spend']), 'older', 'uses caller list order');
select is(public.first_budget_spending_year('0b191111-0000-0000-0000-000000000001',array['empty']), null::text, 'no spending returns null');
select is((select count(*)::int from public.get_budget_projection('0b191111-0000-0000-0000-000000000001','opaque-spend') where actuals_to_date <> 0),2,'summary fixture agrees with actual projection');
select is(public.first_budget_spending_year('0b191111-0000-0000-0000-000000000001',array['attributed']), 'attributed', 'attributed ledger spending qualifies');
select is((select actuals_to_date from public.get_budget_projection('0b191111-0000-0000-0000-000000000001','attributed') where category='Labor'),15::numeric,'attributed result agrees with actual projection');
select ok(not has_function_privilege('anon','public.budget_attributed_year_sums(uuid,text[])','execute'), 'anonymous callers cannot execute attributed helper');
set local request.jwt.claims='{"sub":"0b190000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.first_budget_spending_year('0b191111-0000-0000-0000-000000000001',array['attributed']), null::text, 'employee attribution is hidden from a caller without spend approval');
select is((select count(*)::int from public.get_budget_projection('0b191111-0000-0000-0000-000000000001','attributed') where actuals_to_date <> 0),0,'projection applies the same employee restriction');
set local request.jwt.claims='{"sub":"0b190000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(public.first_budget_spending_year('0b191111-0000-0000-0000-000000000001',array['opaque-spend']), null::text, 'another organization cannot observe spending');
select ok(not has_function_privilege('anon','public.first_budget_spending_year(uuid,text[])','execute'), 'anonymous callers cannot execute summary');
select * from finish();
rollback;
