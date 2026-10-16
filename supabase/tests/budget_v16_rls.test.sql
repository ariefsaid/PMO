begin;
select plan(7);
insert into public.organizations(id,name) values
 ('0b190000-0000-0000-0000-000000000001','BV16 RLS organization A'),
 ('0b190000-0000-0000-0000-000000000002','BV16 RLS organization B');
insert into auth.users(id,email) values
 ('0b190000-0000-0000-0000-0000000000a1','bv16-rls-a@example.invalid'),
 ('0b190000-0000-0000-0000-0000000000b1','bv16-rls-b@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('0b190000-0000-0000-0000-0000000000a1','0b190000-0000-0000-0000-000000000001','BV16 A','bv16-rls-a@example.invalid','Finance','active'),
 ('0b190000-0000-0000-0000-0000000000b1','0b190000-0000-0000-0000-000000000002','BV16 B','bv16-rls-b@example.invalid','Finance','active');
insert into public.projects(id,org_id,name,status) values
 ('0b191111-0000-0000-0000-000000000001','0b190000-0000-0000-0000-000000000001','BV16 RLS project','Ongoing Project');
insert into public.budget_versions(id,org_id,project_id,version,name,status) values
 ('0b192222-0000-0000-0000-000000000001','0b190000-0000-0000-0000-000000000001','0b191111-0000-0000-0000-000000000001',1,'BV16 RLS version','Draft');
select ok(
 has_table_privilege('authenticated','public.budget_version_account_erp_mirror','SELECT')
 and not has_table_privilege('authenticated','public.budget_version_account_erp_mirror','INSERT')
 and not has_table_privilege('authenticated','public.budget_version_account_erp_mirror','UPDATE')
 and not has_table_privilege('authenticated','public.budget_version_account_erp_mirror','DELETE'),
 'authenticated has SELECT only on companion mirror');
select ok(not has_table_privilege('anon','public.budget_version_account_erp_mirror','SELECT,INSERT,UPDATE,DELETE'),
 'anon has no companion mirror DML privileges');
set local role service_role;
insert into public.budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,push_state)
values ('0b190000-0000-0000-0000-000000000001','0b192222-0000-0000-0000-000000000001','2026','Salary','pushed'),
       ('0b190000-0000-0000-0000-000000000001','0b192222-0000-0000-0000-000000000001','2026','COGS','pushed');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"0b190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.budget_push_mirror_rows where budget_version_id='0b192222-0000-0000-0000-000000000001'),2,'same-org authenticated user reads both companion rows through the invoker union');
set local request.jwt.claims='{"sub":"0b190000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.budget_push_mirror_rows where budget_version_id='0b192222-0000-0000-0000-000000000001'),0,'other-org authenticated user sees no companion row through the union');
set local request.jwt.claims='{"sub":"0b190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$insert into public.budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account) values ('0b190000-0000-0000-0000-000000000001','0b192222-0000-0000-0000-000000000001','2026','Travel')$$,'42501',null,'same-org user cannot write companion rows');
reset role;
select throws_ok($$insert into public.budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account) values ('0b190000-0000-0000-0000-000000000001','0b192222-0000-0000-0000-000000000001','2026','Salary')$$,'23505',null,'duplicate account identity is rejected while distinct accounts coexist');
select ok(to_regclass('public.budget_version_account_erp_mirror_queue_idx') is not null and (select 'security_invoker=true'=any(coalesce(reloptions,'{}')) from pg_class where oid='public.budget_push_mirror_rows'::regclass),'queue index exists and union view is SECURITY INVOKER');
select * from finish();
rollback;
