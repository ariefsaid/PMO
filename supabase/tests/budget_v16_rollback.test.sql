begin;
select plan(6);
insert into public.organizations(id,name) values ('0b1a0000-0000-0000-0000-000000000001','BV16 rollback organization');
insert into public.projects(id,org_id,name,status) values ('0b1a1111-0000-0000-0000-000000000001','0b1a0000-0000-0000-0000-000000000001','BV16 rollback project','Ongoing Project');
insert into public.budget_versions(id,org_id,project_id,version,name,status) values
 ('0b1a2222-0000-0000-0000-000000000001','0b1a0000-0000-0000-0000-000000000001','0b1a1111-0000-0000-0000-000000000001',1,'BV16 rollback version','Active');
insert into public.budget_version_erp_mirror(org_id,budget_version_id,fiscal_year,push_state,erp_budget_name)
values ('0b1a0000-0000-0000-0000-000000000001','0b1a2222-0000-0000-0000-000000000001','2026','pushed','BUD-LEGACY');
insert into public.external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id)
values ('0b1a0000-0000-0000-0000-000000000001','budget','0b1a2222-0000-0000-0000-000000000001:32303236','erpnext','BUD-LEGACY');
insert into public.budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,push_state)
values ('0b1a0000-0000-0000-0000-000000000001','0b1a2222-0000-0000-0000-000000000001','2026','Salary','pushed');
select throws_like('select public.bv16_migration_0293_revert()','%v16 account data%','occupied rollback refuses before dropping account state');
select is((select count(*)::int from public.budget_version_account_erp_mirror where erp_account='Salary'),1,'refusal preserves the companion row');
delete from public.budget_version_account_erp_mirror where erp_account='Salary';
select lives_ok('select public.bv16_migration_0293_revert()','unused rollback restores legacy definitions and drops companion objects');
select is((select erp_budget_name from public.budget_version_erp_mirror where budget_version_id='0b1a2222-0000-0000-0000-000000000001' and fiscal_year='2026'),'BUD-LEGACY','legacy mirror row remains after rollback');
select is((select count(*)::int from public.external_refs where domain='budget' and external_record_id='BUD-LEGACY'),1,'legacy reverse pointer remains after rollback');
select col_is_unique('public','budget_version_erp_mirror',array['org_id','budget_version_id','fiscal_year'],'original mirror unique remains after rollback');
select * from finish();
rollback;
