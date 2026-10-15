begin;
select plan(8);

insert into public.organizations(id,name) values ('0b170000-0000-0000-0000-000000000001','BV16 status organization');
insert into auth.users(id,email) values ('0b170000-0000-0000-0000-0000000000a1','bv16-status@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status)
values ('0b170000-0000-0000-0000-0000000000a1','0b170000-0000-0000-0000-000000000001','BV16 status','bv16-status@example.invalid','Finance','active');
insert into public.external_org_bindings(org_id,external_tier,site_url,secret_ref,activated_at)
values ('0b170000-0000-0000-0000-000000000001','erpnext','https://erp.example.invalid','bv16-test-ref',now());
insert into public.projects(id,org_id,name,status,start_date,end_date)
values ('0b171111-0000-0000-0000-000000000001','0b170000-0000-0000-0000-000000000001','BV16 status project','Ongoing Project','2025-01-01','2028-12-31');
insert into public.budget_versions(id,org_id,project_id,version,name,status,activated_at)
values ('0b172222-0000-0000-0000-000000000001','0b170000-0000-0000-0000-000000000001','0b171111-0000-0000-0000-000000000001',1,'BV16 status version','Draft',now());
insert into public.budget_line_items(org_id,budget_version_id,category,description,budgeted_amount,actual_amount,fiscal_year)
values ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','Labor','2026 line',1,0,'2026'),
       ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','Labor','2027 line',1,0,'2027'),
       ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','Labor','2028 line',1,0,'2028');
update public.budget_versions set status='Active' where id='0b172222-0000-0000-0000-000000000001';
insert into public.budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,push_state,push_error,erp_budget_name)
values ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','2026','Salary','pushed',null,'BUD-SALARY'),
       ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','2026','Travel','pushed',null,'BUD-TRAVEL'),
       ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','2027','Salary','pushed',null,'BUD-SALARY-27'),
       ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','2027','Travel','pending',null,null),
       ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','2028','Salary','failed','salary-down',null),
       ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','2028','COGS','failed','cogs-down',null);

insert into public.budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,push_state,push_error,created_at)
values ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','2026','','failed','old-gate-refusal','2020-01-01'),
       ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','2028','','failed','old-gate-refusal','2020-01-01');
set local role authenticated;
set local request.jwt.claims='{"sub":"0b170000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select push_state from public.get_budget_push_status('0b171111-0000-0000-0000-000000000001') where fiscal_year='2026'), 'pushed', 'a later successful account attempt supersedes a prior gate-failure sentinel');
select is((select push_state||':'||push_error from public.get_budget_push_status('0b171111-0000-0000-0000-000000000001') where fiscal_year='2028'), 'failed:cogs-down: account=COGS','a real later account failure is named instead of masked by a stale sentinel');
select is((select push_state from public.get_budget_push_status('0b171111-0000-0000-0000-000000000001') where fiscal_year='2027'), 'pending', 'pending outranks pushed');
select results_eq($$select fiscal_year,push_state,push_error from public.get_budget_push_status('0b171111-0000-0000-0000-000000000001') order by fiscal_year$$,
  $$values ('2026'::text,'pushed'::text,null::text),('2027'::text,'pending'::text,null::text),('2028'::text,'failed'::text,'cogs-down: account=COGS'::text)$$,
  'failures are deterministic by account and years remain independent');
select is((select count(*)::int from public.get_budget_push_status('0b171111-0000-0000-0000-000000000001')),3,'one status row is returned per year');
set local role postgres;
insert into public.budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,push_state,push_error)
values ('0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000001','2027','A-Hold','held','operator-hold');
set local role authenticated;
select is((select push_state||':'||push_error from public.get_budget_push_status('0b171111-0000-0000-0000-000000000001') where fiscal_year='2027'), 'held:operator-hold: account=A-Hold','held account is preserved and identified');
set local role postgres;
insert into public.budget_versions(id,org_id,project_id,version,name,status,activated_at)
values ('0b172222-0000-0000-0000-000000000002','0b170000-0000-0000-0000-000000000001','0b171111-0000-0000-0000-000000000001',2,'BV16 plan fixture','Draft',now());
insert into public.budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,push_state,created_at)
select '0b170000-0000-0000-0000-000000000001','0b172222-0000-0000-0000-000000000002','2026','Plan-'||g,'failed',now() - (g || ' seconds')::interval
from generate_series(1,3000) g;
update public.budget_version_account_erp_mirror set push_state='pending'
where budget_version_id='0b172222-0000-0000-0000-000000000002' and erp_account in ('Plan-2999','Plan-3000');
analyze public.budget_version_account_erp_mirror;
create function pg_temp.explain_json(query text) returns json language plpgsql as $$
declare result json;
begin execute 'explain (format json) ' || query into result; return result; end;
$$;
select is((pg_temp.explain_json('select id from public.budget_version_account_erp_mirror where org_id=''0b170000-0000-0000-0000-000000000001'' and budget_version_id=''0b172222-0000-0000-0000-000000000002'' and fiscal_year=''2026'' and erp_account=''Plan-2999''')->0->'Plan'->>'Index Name'), 'budget_version_account_erp_mi_org_id_budget_version_id_fisc_key', 'account/year lookup uses the new unique index');
select is((jsonb_path_query_first(pg_temp.explain_json('select id from public.budget_version_account_erp_mirror where org_id=''0b170000-0000-0000-0000-000000000001'' and push_state=''pending'' order by created_at,id limit 200')::jsonb, '$.**."Index Name"') #>> '{}'), 'budget_version_account_erp_mirror_queue_idx', 'bounded org/state queue uses the queue index');
select * from finish();
rollback;
