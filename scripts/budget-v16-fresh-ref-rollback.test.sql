-- Round trip for 0379 (fresh v16 budget ref): down, then up again. Run by
-- scripts/test-budget-v16-fresh-ref-rollback.sh, which inlines the migration files at the markers.
-- The down half doubles as a mutation check: without 0379 the fresh ref is refused.
begin;
select plan(4);
insert into organizations(id,name) values ('0b799000-0000-0000-0000-000000000001','Fresh Ref RT');
insert into projects(id,org_id,name,status,start_date,end_date) values
 ('0b799111-0000-0000-0000-000000000001','0b799000-0000-0000-0000-000000000001','RT','Ongoing Project',date '2025-01-01',date '2025-12-31');
insert into budget_versions(id,org_id,project_id,version,name,status,activated_at) values
 ('0b799222-0000-0000-0000-000000000001','0b799000-0000-0000-0000-000000000001','0b799111-0000-0000-0000-000000000001',1,'RT','Active',timestamptz '2026-10-24 09:55:00+00');
insert into budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness)
values ('0b799000-0000-0000-0000-000000000001','0b799222-0000-0000-0000-000000000001','2025','Salary','ensure','pending',timestamptz '2026-10-24 09:55:00+00');
insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,external_record_id,claim_generation,payload)
values ('0b799333-0000-0000-0000-000000000001','0b799000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b799222-0000-0000-0000-000000000001','2025','Salary'),'rt-salary','erpnext','create','committed','BUDGET-RT',1,'{}');

-- @0379_DOWN@
select is(public.record_outbox_ref('0b799333-0000-0000-0000-000000000001',1,'budget','x','erpnext','BUDGET-RT'),0,
 'down: the 0293 rule refuses a fresh v16 ref again');
select is(to_regprocedure('public.finalize_wedged_v16_budget_commits()') is null,true,
 'down: the one-off finalize is dropped');

-- @0379_UP@
select is(public.record_outbox_ref('0b799333-0000-0000-0000-000000000001',1,'budget','x','erpnext','BUDGET-RT'),1,
 'up: a fresh v16 ref is recorded');
select is(to_regprocedure('public.finalize_wedged_v16_budget_commits()') is null,true,
 'up: the one-off finalize ran and was dropped');

select * from finish();
rollback;
