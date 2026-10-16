begin;
select plan(1);
insert into public.organizations(id,name)
values ('0b160000-0000-0000-0000-000000000001','BV16 test organization');
insert into auth.users(id,email)
values ('0b160000-0000-0000-0000-0000000000a1','bv16-fixture@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status)
values ('0b160000-0000-0000-0000-0000000000a1',
        '0b160000-0000-0000-0000-000000000001','BV16 fixture',
        'bv16-fixture@example.invalid','Finance','active');
insert into public.projects(id,org_id,name,status,start_date,end_date)
values ('0b161111-0000-0000-0000-000000000001',
        '0b160000-0000-0000-0000-000000000001','BV16 fixture project',
        'Ongoing Project','2025-01-01','2026-12-31');
insert into public.budget_versions(id,org_id,project_id,version,name,status)
values ('0b162222-0000-0000-0000-000000000001',
        '0b160000-0000-0000-0000-000000000001',
        '0b161111-0000-0000-0000-000000000001',1,'BV16 fixture version','Draft');
insert into public.budget_line_items
  (org_id,budget_version_id,category,description,budgeted_amount,actual_amount,fiscal_year)
values ('0b160000-0000-0000-0000-000000000001',
        '0b162222-0000-0000-0000-000000000001','Labor','Fixture labor',50000,0,'2026'),
       ('0b160000-0000-0000-0000-000000000001',
        '0b162222-0000-0000-0000-000000000001','Materials','Fixture materials',25000,0,'2026');
update public.budget_versions
set status='Active',activated_at='2026-10-15T10:00:00Z'
where id='0b162222-0000-0000-0000-000000000001';
insert into public.budget_version_account_erp_mirror
  (org_id,budget_version_id,fiscal_year,erp_account,push_state,push_error,
   erp_budget_name,erp_docstatus,activated_at_witness)
values ('0b160000-0000-0000-0000-000000000001',
        '0b162222-0000-0000-0000-000000000001','2026','Salary','pushed',null,
        'BV16-SALARY-TEST',1,'2026-10-15T10:00:00Z'),
       ('0b160000-0000-0000-0000-000000000001',
        '0b162222-0000-0000-0000-000000000001','2026','COGS','failed',
        'external-unreachable',null,null,'2026-10-15T10:00:00Z');
insert into public.budget_version_erp_mirror
  (org_id,budget_version_id,fiscal_year,push_state,erp_budget_name)
values ('0b160000-0000-0000-0000-000000000001',
        '0b162222-0000-0000-0000-000000000001','2025','pushed','BV15-TEST');
set local role authenticated;
set local request.jwt.claims=
  '{"sub":"0b160000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select ok(
  (select count(*)=2 from public.budget_version_account_erp_mirror
    where budget_version_id='0b162222-0000-0000-0000-000000000001' and fiscal_year='2026')
  and (select count(*)=1 from public.get_budget_push_status('0b161111-0000-0000-0000-000000000001')
    where fiscal_year='2026')
  and (select push_state='failed' and position('account=COGS' in push_error)>0
    from public.get_budget_push_status('0b161111-0000-0000-0000-000000000001') where fiscal_year='2026')
  and (select count(*)=1 from public.budget_version_erp_mirror
    where budget_version_id='0b162222-0000-0000-0000-000000000001' and fiscal_year='2025')
  and (select push_state='pushed' and erp_budget_name='BV15-TEST'
    from public.get_budget_push_status('0b161111-0000-0000-0000-000000000001') where fiscal_year='2025'),
  'AC-BV16-006 account mirrors coexist and year reports the failing account');
select finish();
rollback;
