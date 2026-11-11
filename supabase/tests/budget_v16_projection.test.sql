begin;
select plan(14);
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
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','Labor','later phased budget',200,0,'2031'),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','Materials','unphased budget',50,0,null);
update public.budget_versions set status='Active' where id='0b182222-0000-0000-0000-000000000001';
insert into public.budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,push_state,budget_intent,erp_docstatus,pushed_project_start_date,pushed_project_end_date)
values ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2026','Salary','pushed','ensure',1,'2025-01-01','2027-12-31'),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2026','COGS','pushed','ensure',1,'2025-01-01','2027-12-31'),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2026','Equipment','failed','ensure',null,null,null),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2027','Travel','pushed','remove',2,'2025-01-01','2027-12-31'),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2028','Cancelled','pushed','ensure',2,null,null),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2029','Removed','pushed','remove',2,null,null),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2029','Live','pushed','ensure',null,null,null),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2030','Removed','pushed','remove',1,null,null),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2030','Cancelled','pushed','ensure',2,null,null),
       ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000001','2031','Removed','pushed','remove',2,null,null);
insert into public.budget_projections(org_id,project_id,fiscal_year,category,pmo_etc)
values ('0b180000-0000-0000-0000-000000000001','0b181111-0000-0000-0000-000000000001','2027','Materials',10),
       ('0b180000-0000-0000-0000-000000000001','0b181111-0000-0000-0000-000000000001','2028','Materials',10),
       ('0b180000-0000-0000-0000-000000000001','0b181111-0000-0000-0000-000000000001','2030','Materials',10);
set local role authenticated;
set local request.jwt.claims='{"sub":"0b180000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select pmo_budget_amount from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2026') where category='Labor'),100::numeric,'two successful account mirrors do not duplicate PMO budget amounts');
select is((select pmo_budget_amount from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2027') where category='Materials'),null::numeric,'a remove-only year cannot attribute unphased PMO money');
select ok((select pmo_budget_amount=100::numeric from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2026') where category='Labor') and (select count(*)=2 from public.list_budget_fiscal_years('0b181111-0000-0000-0000-000000000001') where fiscal_year in ('2026','2027')),'a separately failed account cannot hide phased PMO amounts or its year');
select results_eq(
  $$select fiscal_year, is_active_push from public.list_budget_fiscal_years('0b181111-0000-0000-0000-000000000001') order by fiscal_year$$,
  $$values ('2026'::text,true),('2027'::text,false),('2028'::text,false),('2029'::text,true),('2030'::text,false),('2031'::text,true)$$,
  'offered years distinguish remove-only, cancelled, mixed live and mixed nonqualifying accounts');
select is((select count(*)::int from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2028') where category='Materials' and pmo_budget_amount is null and projected_variance is null),1,'cancelled year retains the ETC row while withholding budget and variance');
select is((select pmo_budget_amount from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2028') where category='Materials'),null::numeric,'cancelled account does not attribute unphased money');
select is((select pmo_budget_amount from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2029') where category='Materials'),50::numeric,'a live ensure among removals attributes unphased money');
select is((select pmo_budget_amount from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2030') where category='Materials'),null::numeric,'mixed removed and cancelled accounts cannot attribute unphased money');
select is((select is_active_push from public.list_budget_fiscal_years('0b181111-0000-0000-0000-000000000001') where fiscal_year='2026'),true,'active phased year remains on record');
select is((select pmo_budget_amount from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2031') where category='Labor'),200::numeric,'active phased money remains on record despite a removal');
set local role postgres;
insert into public.budget_versions(id,org_id,project_id,version,name,status,activated_at)
values ('0b182222-0000-0000-0000-000000000002','0b180000-0000-0000-0000-000000000001','0b181111-0000-0000-0000-000000000001',2,'v15 legacy projection version','Draft',now());
insert into public.budget_line_items(org_id,budget_version_id,category,description,budgeted_amount,actual_amount,fiscal_year)
values ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000002','Subcontractors','v15 unphased budget',75,0,null);
update public.budget_versions set status='Draft' where id='0b182222-0000-0000-0000-000000000001';
update public.budget_versions set status='Active' where id='0b182222-0000-0000-0000-000000000002';
insert into public.budget_version_erp_mirror(org_id,budget_version_id,fiscal_year,push_state,erp_docstatus,pushed_at)
values ('0b180000-0000-0000-0000-000000000001','0b182222-0000-0000-0000-000000000002','2026','pushed',2,now());
set local role authenticated;
select is((select pmo_budget_amount from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2026') where category='Subcontractors'),75::numeric,'a Desk-cancelled v15 legacy push retains its pre-0293 attribution');
select is((select is_active_push from public.list_budget_fiscal_years('0b181111-0000-0000-0000-000000000001') where fiscal_year='2026'),true,'legacy pushed year remains on record even when its document is cancelled');
set local role postgres;
insert into public.organizations(id,name) values ('0b180000-0000-0000-0000-000000000002','Another organization');
insert into auth.users(id,email) values ('0b180000-0000-0000-0000-0000000000b1','other-bv16@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status)
values ('0b180000-0000-0000-0000-0000000000b1','0b180000-0000-0000-0000-000000000002','Other member','other-bv16@example.invalid','Finance','active');
set local role authenticated;
set local request.jwt.claims='{"sub":"0b180000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.list_budget_fiscal_years('0b181111-0000-0000-0000-000000000001')),0,'another organization cannot see offered years');
select is((select count(*)::int from public.get_budget_projection('0b181111-0000-0000-0000-000000000001','2026')),0,'another organization cannot see projection rows');
select * from finish();
rollback;
