begin;
select no_plan();
insert into public.organizations(id,name,default_currency) values
 ('04000000-0000-0000-0000-000000000001','Budget read org','USD'),
 ('04000000-0000-0000-0000-000000000002','Budget read other','USD');
insert into auth.users(id,email) values
 ('04000000-0000-0000-0000-0000000000a1','t400admin@example.test'),
 ('04000000-0000-0000-0000-0000000000a2','t400other@example.test'),
 ('04000000-0000-0000-0000-0000000000a3','t400finance@example.test'),
 ('04000000-0000-0000-0000-0000000000a4','t400engineer@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('04000000-0000-0000-0000-0000000000a1','04000000-0000-0000-0000-000000000001','Reader','t400admin@example.test','Admin','active'),
 ('04000000-0000-0000-0000-0000000000a2','04000000-0000-0000-0000-000000000002','Other','t400other@example.test','Admin','active'),
 ('04000000-0000-0000-0000-0000000000a3','04000000-0000-0000-0000-000000000001','Finance','t400finance@example.test','Finance','active'),
 ('04000000-0000-0000-0000-0000000000a4','04000000-0000-0000-0000-000000000001','Engineer','t400engineer@example.test','Engineer','active');
insert into public.projects(id,org_id,code,name,status) values
 ('04000000-0000-0000-0000-000000000010','04000000-0000-0000-0000-000000000001','BREAD400','Budget read','Ongoing Project');
insert into public.budget_versions(id,org_id,project_id,version,name,status)
 select ('04000000-0000-0000-0001-' || lpad(i::text,12,'0'))::uuid,
 '04000000-0000-0000-0000-000000000001','04000000-0000-0000-0000-000000000010',i,'Read',(case when i = 1 then 'Draft' else 'Archived' end)::public.budget_status
 from generate_series(1,1001) i;
insert into public.budget_line_items(org_id,budget_version_id,category,budgeted_amount)
 select '04000000-0000-0000-0000-000000000001','04000000-0000-0000-0001-000000000001','Labor',0.01
 from generate_series(1,1001);
select ok(has_function_privilege('authenticated','public.budget_version_read_totals(uuid)','execute'),'authenticated can execute');
select ok(not has_function_privilege('anon','public.budget_version_read_totals(uuid)','execute'),'anon cannot execute');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"04000000-0000-0000-0000-0000000000a1","role":"authenticated"}',true);
select is((select count(*)::int from public.budget_version_read_totals('04000000-0000-0000-0000-000000000010')),1001,'all visible versions have a total');
select is((select total from public.budget_version_read_totals('04000000-0000-0000-0000-000000000010') where version_id='04000000-0000-0000-0001-000000000001'),10.01::numeric,'numeric total covers every line');
select is((select total from public.budget_version_read_totals('04000000-0000-0000-0000-000000000010') where version_id='04000000-0000-0000-0001-000000000002'),0::numeric,'empty version has zero total');
select set_config('request.jwt.claims','{"sub":"04000000-0000-0000-0000-0000000000a3","role":"authenticated"}',true);
select is((select total from public.budget_version_read_totals('04000000-0000-0000-0000-000000000010') where version_id='04000000-0000-0000-0001-000000000001'),10.01::numeric,'finance sees caller-visible total');
select set_config('request.jwt.claims','{"sub":"04000000-0000-0000-0000-0000000000a4","role":"authenticated"}',true);
select is((select total from public.budget_version_read_totals('04000000-0000-0000-0000-000000000010') where version_id='04000000-0000-0000-0001-000000000001'),10.01::numeric,'engineer sees caller-visible total');
select set_config('request.jwt.claims','{"sub":"04000000-0000-0000-0000-0000000000a2","role":"authenticated"}',true);
select is((select count(*)::int from public.budget_version_read_totals('04000000-0000-0000-0000-000000000010')),0,'other org sees no totals');
select * from finish();
rollback;
