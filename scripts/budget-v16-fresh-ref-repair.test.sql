-- 0379 §2 — the one-off finalize of v16 account commits stranded by 0293's ref rule. The function is dropped as
-- soon as it runs, so it is proven by running the migration itself over seeded rows. Run by
-- scripts/test-budget-v16-fresh-ref-rollback.sh, which inlines the migration file at the marker.
begin;
select plan(14);
insert into organizations(id,name) values ('0b798000-0000-0000-0000-000000000001','Repair Org');
insert into projects(id,org_id,name,status,start_date,end_date) values
 ('0b798111-0000-0000-0000-000000000001','0b798000-0000-0000-0000-000000000001','Repair Project','Ongoing Project',date '2025-01-01',date '2025-12-31');
insert into budget_versions(id,org_id,project_id,version,name,status,activated_at) values
 ('0b798222-0000-0000-0000-000000000001','0b798000-0000-0000-0000-000000000001','0b798111-0000-0000-0000-000000000001',2,'Current','Active',timestamptz '2026-10-24 09:55:00+00'),
 ('0b798222-0000-0000-0000-000000000002','0b798000-0000-0000-0000-000000000001','0b798111-0000-0000-0000-000000000001',1,'Old','Archived',timestamptz '2026-10-01 00:00:00+00');

create function pg_temp.slot(p_version uuid, p_account text) returns public.budget_version_account_erp_mirror
language sql as $$ select * from public.budget_version_account_erp_mirror where budget_version_id=p_version and erp_account=p_account $$;
create function pg_temp.outbox_state(p_key text) returns text
language sql as $$ select state from public.external_command_outbox where idempotency_key=p_key $$;

insert into budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness,erp_budget_name,erp_cancelled_at)
values
 ('0b798000-0000-0000-0000-000000000001','0b798222-0000-0000-0000-000000000001','2025','Salary','ensure','pending',timestamptz '2026-10-24 09:55:00+00',null,null),
 ('0b798000-0000-0000-0000-000000000001','0b798222-0000-0000-0000-000000000001','2025','Travel','ensure','pending',timestamptz '2026-10-24 09:55:00+00',null,null),
 ('0b798000-0000-0000-0000-000000000001','0b798222-0000-0000-0000-000000000001','2025','Vehicle','ensure','pending',timestamptz '2026-10-24 09:55:00+00','BUDGET-OTHER',null),
 ('0b798000-0000-0000-0000-000000000001','0b798222-0000-0000-0000-000000000001','2025','Rent','ensure','pending',timestamptz '2026-10-24 09:55:00+00',null,null),
 ('0b798000-0000-0000-0000-000000000001','0b798222-0000-0000-0000-000000000001','2025','Tools','ensure','failed',timestamptz '2026-10-24 09:55:00+00',null,timestamptz '2026-10-24 10:00:00+00'),
 ('0b798000-0000-0000-0000-000000000001','0b798222-0000-0000-0000-000000000002','2025','Salary','ensure','pending',timestamptz '2026-10-01 00:00:00+00',null,null);
-- BUDGET-OWNED is already PMO's under the archived version's Salary identity.
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values
 ('0b798000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0b798222-0000-0000-0000-000000000002','2025','Salary'),'erpnext','BUDGET-OWNED');

insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,external_record_id,claim_generation,payload,canonical)
values
 ('0b798333-0000-0000-0000-000000000001','0b798000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b798222-0000-0000-0000-000000000001','2025','Salary'),'r-salary','erpnext','create','committed','BUDGET-SALARY',1,'{}',
  '{"erp_budget_name":"BUDGET-SALARY","erp_docstatus":1,"erp_modified":"2026-10-24 16:55:11"}'),
 ('0b798333-0000-0000-0000-000000000002','0b798000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b798222-0000-0000-0000-000000000001','2025','Travel'),'r-travel-mismatch','erpnext','create','committed','BUDGET-TRAVEL',1,'{}',
  '{"erp_budget_name":"BUDGET-SOMETHING-ELSE","erp_docstatus":1}'),
 ('0b798333-0000-0000-0000-000000000003','0b798000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b798222-0000-0000-0000-000000000001','2025','Vehicle'),'r-vehicle-other-name','erpnext','create','committed','BUDGET-VEHICLE',1,'{}',
  '{"erp_budget_name":"BUDGET-VEHICLE","erp_docstatus":1}'),
 ('0b798333-0000-0000-0000-000000000004','0b798000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b798222-0000-0000-0000-000000000001','2025','Rent'),'r-rent-owned-elsewhere','erpnext','create','committed','BUDGET-OWNED',1,'{}',
  '{"erp_budget_name":"BUDGET-OWNED","erp_docstatus":1}'),
 ('0b798333-0000-0000-0000-000000000005','0b798000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b798222-0000-0000-0000-000000000001','2025','Tools'),'r-tools-tombstoned','erpnext','create','committed','BUDGET-TOOLS',1,'{}',
  '{"erp_budget_name":"BUDGET-TOOLS","erp_docstatus":1}'),
 ('0b798333-0000-0000-0000-000000000006','0b798000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b798222-0000-0000-0000-000000000002','2025','Salary'),'r-archived','erpnext','create','committed','BUDGET-ARCHIVED',1,'{}',
  '{"erp_budget_name":"BUDGET-ARCHIVED","erp_docstatus":1}');

-- @0379_UP@

select is(pg_temp.outbox_state('r-salary'),'confirmed','AC-BV16-010 the wedged commit of the Active version is confirmed');
select is((pg_temp.slot('0b798222-0000-0000-0000-000000000001','Salary')).push_state,'pushed','AC-BV16-010 its account mirror reports pushed');
select is((pg_temp.slot('0b798222-0000-0000-0000-000000000001','Salary')).erp_budget_name,'BUDGET-SALARY','AC-BV16-010 the mirror names the ERP Budget the commit created');
select is((pg_temp.slot('0b798222-0000-0000-0000-000000000001','Salary')).erp_docstatus::int,1,'AC-BV16-010 the mirror carries the committed docstatus');
select is((select pmo_record_id from external_refs where external_record_id='BUDGET-SALARY'),
 public.budget_account_identity('0b798222-0000-0000-0000-000000000001','2025','Salary'),
 'AC-BV16-010 the ownership ref is recorded so later pushes recognise the Budget as PMO''s');
select is(pg_temp.outbox_state('r-travel-mismatch'),'committed','AC-BV16-010 a commit whose stored ERP name disagrees is left untouched');
select is(pg_temp.outbox_state('r-vehicle-other-name'),'committed','AC-BV16-010 a commit whose slot names a different Budget is left untouched');
select is(pg_temp.outbox_state('r-rent-owned-elsewhere'),'committed','AC-BV16-010 a commit whose Budget is owned by another identity is left untouched');
select is((select pmo_record_id from external_refs where external_record_id='BUDGET-OWNED'),
 public.budget_account_identity('0b798222-0000-0000-0000-000000000002','2025','Salary'),
 'AC-BV16-010 that other identity keeps its ref');
select is((pg_temp.slot('0b798222-0000-0000-0000-000000000001','Rent')).push_state,'pending','AC-BV16-010 and its slot is not marked pushed');
select is(pg_temp.outbox_state('r-tools-tombstoned'),'committed','AC-BV16-010 a commit whose slot is tombstoned is left untouched');
select is((pg_temp.slot('0b798222-0000-0000-0000-000000000001','Tools')).push_state,'failed','AC-BV16-010 the tombstoned slot is not revived as pushed');
select is(pg_temp.outbox_state('r-archived'),'committed','AC-BV16-010 a commit for a version no longer Active is left for an operator');
select is(to_regprocedure('public.finalize_wedged_v16_budget_commits()') is null,true,'AC-BV16-010 the repair is dropped once it has run');

select * from finish();
rollback;
