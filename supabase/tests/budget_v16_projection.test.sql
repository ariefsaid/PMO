begin;
select plan(3);
insert into public.organizations(id,name) values ('0b180000-0000-0000-0000-000000000001','BV16 projection organization');
insert into auth.users(id,email) values ('0b180000-0000-0000-0000-0000000000a1','bv16-projection@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status)
values ('0b180000-0000-0000-0000-0000000000a1','0b180000-0000-0000-0000-000000000001','BV16 projection','bv16-projection@example.invalid','Finance','active');
insert into public.projects(id,org_id,name,status,start_date,end_date)
values ('0b181111-0000-0000-0000-000000000001','0b180000-0000-0000-0000-000000000001','BV16 projection project','Ongoing Project','2025-01-01','2027-12-31');
insert into public.budget_versions(id,org_id,project_id,version,name,status,activated_at)
values ('0b182222-0000-0000-0000-000000000001','0b180000-0000-0000-0000-000000000001','0b181111-0000-0000-0000-000000000001',1,'BV16 projection version','Draft',now());
insert into public.budget_line_items(org_id,budget_version_id,category,description,budgeted_amount,actual_amount,fiscal_year)
values ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','Labor','phased budget',100,0,'2026'),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','Materials','unphased budget',50,0,null);
update public.budget_versions set status='Active' where id='0b182222-0000-0000-0000-000000000001';
insert into public.budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,push_state,budget_intent,erp_docstatus,pushed_project_start_date,pushed_project_end_date)
values ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2026','Salary','pushed','ensure',1,'2025-01-01','2027-12-31'),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2026','COGS','pushed','ensure',1,'2025-01-01','2027-12-31'),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2026','Equipment','failed','ensure',null,null,null),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2027','Travel','pushed','remove',2,'2025-01-01','2027-12-31');
set local role authenticated;
set local request.jwt.claims='{"sub":"0b180000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select pmo_budget_amount from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2026') where category='Labor'),100::numeric,'two successful account mirrors do not duplicate PMO budget amounts');
select is((select pmo_budget_amount from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2027') where category='Materials'),null::numeric,'a remove-only year cannot attribute unphased PMO money');
select ok((select pmo_budget_amount=100::numeric from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2026') where category='Labor') and (select count(*)=2 from public.list_budget_fiscal_years('0b181111-0000-0000-0000-000000000001') where fiscal_year in ('2026','2027')),'a separately failed account cannot hide phased PMO amounts or its year');
select * from finish();
rollback;
