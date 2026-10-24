-- 0379: a FRESH v16 account push records its ERP Budget ref.
--
-- The served dispatch writes the account slot (push_state 'pending', erp_budget_name NULL) before the
-- push, and the success writer fills erp_budget_name only AFTER record_outbox_ref. 0293 required the
-- slot to already carry the ERP name, so every fresh push was refused at the ref step and the
-- committed outbox row could never be finalized. 0379's one-off repair is proven by
-- scripts/test-budget-v16-fresh-ref-rollback.sh (it is dropped once it has run, so it cannot be called here).
begin;
select plan(13);

insert into organizations(id,name) values ('0b790000-0000-0000-0000-000000000001','Fresh Ref Org');
insert into projects(id,org_id,name,status,start_date,end_date) values
 ('0b791111-0000-0000-0000-000000000001','0b790000-0000-0000-0000-000000000001','Fresh Project','Ongoing Project',date '2025-01-01',date '2025-12-31');
insert into budget_versions(id,org_id,project_id,version,name,status,activated_at) values
 ('0b792222-0000-0000-0000-000000000001','0b790000-0000-0000-0000-000000000001','0b791111-0000-0000-0000-000000000001',3,'Current','Active',timestamptz '2026-10-24 09:55:00+00'),
 ('0b792222-0000-0000-0000-000000000002','0b790000-0000-0000-0000-000000000001','0b791111-0000-0000-0000-000000000001',2,'Prior','Archived',timestamptz '2026-10-01 00:00:00+00');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- The current version's account slots exactly as the served dispatch writes them: pending, no ERP name yet.
insert into budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness)
values
 ('0b790000-0000-0000-0000-000000000001','0b792222-0000-0000-0000-000000000001','2025','Salary','ensure','pending',timestamptz '2026-10-24 09:55:00+00'),
 ('0b790000-0000-0000-0000-000000000001','0b792222-0000-0000-0000-000000000001','2025','Travel','ensure','pending',timestamptz '2026-10-24 09:55:00+00'),
 ('0b790000-0000-0000-0000-000000000001','0b792222-0000-0000-0000-000000000001','2025','Vehicle','ensure','pending',timestamptz '2026-10-24 09:55:00+00'),
 ('0b790000-0000-0000-0000-000000000001','0b792222-0000-0000-0000-000000000001','2025','Rent','ensure','pending',timestamptz '2026-10-24 09:55:00+00');
update budget_version_account_erp_mirror set erp_budget_name='BUDGET-OTHER'
 where budget_version_id='0b792222-0000-0000-0000-000000000001' and erp_account='Vehicle';
-- The prior (archived) version pushed Rent; PMO owns that ERP Budget through its ref.
insert into budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness,erp_budget_name,erp_docstatus)
values ('0b790000-0000-0000-0000-000000000001','0b792222-0000-0000-0000-000000000002','2025','Rent','ensure','pushed',timestamptz '2026-10-01 00:00:00+00','BUDGET-RENT',1);
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values
 ('0b790000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0b792222-0000-0000-0000-000000000002','2025','Rent'),'erpnext','BUDGET-RENT');

insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,external_record_id,claim_generation,payload)
values
 ('0b793333-0000-0000-0000-000000000001','0b790000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b792222-0000-0000-0000-000000000001','2025','Salary'),'fresh-salary','erpnext','create','committed','BUDGET-FRESH-1',1,'{}'),
 ('0b793333-0000-0000-0000-000000000002','0b790000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b792222-0000-0000-0000-000000000001','2025','Vehicle'),'fresh-vehicle','erpnext','create','committed','BUDGET-FRESH-2',1,'{}'),
 ('0b793333-0000-0000-0000-000000000003','0b790000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b792222-0000-0000-0000-000000000001','2025','Travel'),'fresh-travel','erpnext','create','committed','BUDGET-TRAVEL',1,'{}'),
 ('0b793333-0000-0000-0000-000000000004','0b790000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b792222-0000-0000-0000-000000000001','2025','Rent'),'fresh-rent','erpnext','create','committed','BUDGET-RENT',1,'{}');

select is(public.record_outbox_ref('0b793333-0000-0000-0000-000000000001',1,'budget','ignored','erpnext','BUDGET-FRESH-1'),1,
 'AC-BV16-009 a fresh committed account push records its ERP Budget ref while the slot has no name yet');
select is((select pmo_record_id from external_refs where domain='budget' and external_record_id='BUDGET-FRESH-1'),
 public.budget_account_identity('0b792222-0000-0000-0000-000000000001','2025','Salary'),
 'AC-BV16-009 the ref is keyed on the locked command''s account identity');
select is(public.record_outbox_ref('0b793333-0000-0000-0000-000000000001',1,'budget','ignored','erpnext','BUDGET-FRESH-1'),1,
 'AC-BV16-009 a replayed finalize of the same ref still succeeds');
select is(public.record_outbox_ref('0b793333-0000-0000-0000-000000000001',0,'budget','ignored','erpnext','BUDGET-FRESH-1'),0,
 'AC-BV16-009 a stale claim generation is still refused');
select is(public.record_outbox_ref('0b793333-0000-0000-0000-000000000002',1,'budget','ignored','erpnext','BUDGET-FRESH-2'),0,
 'AC-BV16-009 a slot that already names a DIFFERENT ERP Budget is still refused');
select is((select count(*)::int from external_refs where external_record_id='BUDGET-FRESH-2'),0,
 'AC-BV16-009 the refused ref writes nothing');
select is(public.record_outbox_ref('0b793333-0000-0000-0000-000000000003',1,'budget','ignored','erpnext','BUDGET-ELSE'),0,
 'AC-BV16-009 a nameless slot cannot be claimed for a Budget other than the one its own commit stored');
select is((select count(*)::int from external_refs where external_record_id in ('BUDGET-ELSE','BUDGET-TRAVEL')),0,
 'AC-BV16-009 that refused claim records no ref');
select is(public.record_outbox_ref('0b793333-0000-0000-0000-000000000003',1,'budget','ignored','erpnext','BUDGET-TRAVEL'),1,
 'AC-BV16-009 the same command records the Budget its commit stored');

-- The transfer branch, now reachable: a nameless slot of the Active version takes over the Budget an
-- archived version of the same project, account and year pushed.
select is(public.record_outbox_ref('0b793333-0000-0000-0000-000000000004',1,'budget','ignored','erpnext','BUDGET-RENT'),1,
 'AC-BV16-009 a fresh slot with no name takes over the archived version''s unchanged Budget');
select is((select pmo_record_id from external_refs where external_record_id='BUDGET-RENT'),
 public.budget_account_identity('0b792222-0000-0000-0000-000000000001','2025','Rent'),
 'AC-BV16-009 the ref now belongs to the Active version''s account identity');
select is((select count(*)::int from external_refs where external_record_id='BUDGET-RENT'),1,
 'AC-BV16-009 exactly one ref remains for that Budget');

reset role;
select is(to_regprocedure('public.finalize_wedged_v16_budget_commits()') is null,true,
 'AC-BV16-010 the one-off repair no longer exists once 0379 has run');

select * from finish();
rollback;
