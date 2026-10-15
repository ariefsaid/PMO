-- #1033 task 29: a v16 amendment transfers its unchanged ERP document ref atomically.
begin;
select plan(18);

insert into organizations(id,name) values
 ('0bda0000-0000-0000-0000-000000000001','Budget Handoff Org'),
 ('0bda0000-0000-0000-0000-000000000002','Budget Handoff Other Org');
insert into projects(id,org_id,name,status,start_date,end_date) values
 ('0bda1111-0000-0000-0000-000000000001','0bda0000-0000-0000-0000-000000000001','Handoff Project','Ongoing Project',date '2026-01-01',date '2026-12-31'),
 ('0bda1111-0000-0000-0000-000000000002','0bda0000-0000-0000-0000-000000000001','Other Project','Ongoing Project',date '2026-01-01',date '2026-12-31');
insert into budget_versions(id,org_id,project_id,version,name,status,activated_at) values
 ('0bda2222-0000-0000-0000-000000000001','0bda0000-0000-0000-0000-000000000001','0bda1111-0000-0000-0000-000000000001',1,'Prior','Draft',timestamptz '2026-01-01 00:00:00+00'),
 ('0bda2222-0000-0000-0000-000000000002','0bda0000-0000-0000-0000-000000000001','0bda1111-0000-0000-0000-000000000001',2,'Current','Active',timestamptz '2026-02-01 00:00:00+00'),
 ('0bda2222-0000-0000-0000-000000000003','0bda0000-0000-0000-0000-000000000001','0bda1111-0000-0000-0000-000000000002',2,'Other Project Current','Active',timestamptz '2026-02-01 00:00:00+00'),
 ('0bda2222-0000-0000-0000-000000000004','0bda0000-0000-0000-0000-000000000001','0bda1111-0000-0000-0000-000000000001',3,'Prior Account','Draft',timestamptz '2025-01-01 00:00:00+00'),
 ('0bda2222-0000-0000-0000-000000000005','0bda0000-0000-0000-0000-000000000001','0bda1111-0000-0000-0000-000000000001',4,'Prior Year','Draft',timestamptz '2025-01-01 00:00:00+00'),
 ('0bda2222-0000-0000-0000-000000000006','0bda0000-0000-0000-0000-000000000001','0bda1111-0000-0000-0000-000000000001',5,'Prior Conflict','Draft',timestamptz '2025-01-01 00:00:00+00');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
create function pg_temp.try_handoff(p_id uuid,p_generation integer,p_name text) returns integer
language plpgsql as $$
begin
  return public.record_outbox_ref(p_id,p_generation,'budget','untrusted-identity','erpnext',p_name);
exception when others then
  return -1;
end $$;
insert into budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,push_state,activated_at_witness,erp_budget_name,erp_docstatus)
values
 ('0bda0000-0000-0000-0000-000000000001','0bda2222-0000-0000-0000-000000000001','2026','Salary','pushed',timestamptz '2026-01-01 00:00:00+00','BUDGET-HANDOFF-1',1),
 ('0bda0000-0000-0000-0000-000000000001','0bda2222-0000-0000-0000-000000000002','2026','Salary','pushing',timestamptz '2026-02-01 00:00:00+00','BUDGET-HANDOFF-1',1),
 ('0bda0000-0000-0000-0000-000000000001','0bda2222-0000-0000-0000-000000000003','2026','Salary','pushing',timestamptz '2026-02-01 00:00:00+00','BUDGET-HANDOFF-1',1);
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values
 ('0bda0000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000001','2026','Salary'),'erpnext','BUDGET-HANDOFF-1');
insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,external_record_id,claim_generation,payload)
values
 ('0bda3333-0000-0000-0000-000000000001','0bda0000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000002','2026','Salary'),'handoff-current','erpnext','create','committed','BUDGET-HANDOFF-1',4,'{}'),
 ('0bda3333-0000-0000-0000-000000000002','0bda0000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000003','2026','Salary'),'handoff-other-project','erpnext','create','committed','BUDGET-HANDOFF-1',4,'{}');

select is(pg_temp.try_handoff('0bda3333-0000-0000-0000-000000000001',4,'BUDGET-HANDOFF-1'),1,
 'AC-BV16-006 current committed generation transfers the unchanged Budget mapping');
select is((select count(*)::int from external_refs where org_id='0bda0000-0000-0000-0000-000000000001' and domain='budget' and external_record_id='BUDGET-HANDOFF-1'),1,
 'AC-BV16-006 exactly one reverse ref remains after transfer');
select is((select count(*)::int from external_refs where domain='budget' and pmo_record_id=public.budget_account_identity('0bda2222-0000-0000-0000-000000000001','2026','Salary')),0,
 'AC-BV16-006 old version ref is removed while its historical mirror is retained');
select is((select count(*)::int from budget_version_account_erp_mirror where budget_version_id='0bda2222-0000-0000-0000-000000000001' and erp_budget_name='BUDGET-HANDOFF-1'),1,
 'AC-BV16-006 transfer preserves the prior historical mirror');
select is(pg_temp.try_handoff('0bda3333-0000-0000-0000-000000000001',4,'BUDGET-HANDOFF-1'),1,
 'AC-BV16-006 an identical finalization replay succeeds');
select is(pg_temp.try_handoff('0bda3333-0000-0000-0000-000000000001',3,'BUDGET-HANDOFF-1'),0,
 'AC-BV16-006 stale generation cannot transfer a mapping');
select is(pg_temp.try_handoff('0bda3333-0000-0000-0000-000000000002',4,'BUDGET-HANDOFF-1'),0,
 'AC-BV16-006 another project cannot claim an existing account-year ref');
select is((select pmo_record_id from external_refs where domain='budget' and external_record_id='BUDGET-HANDOFF-1'),
 public.budget_account_identity('0bda2222-0000-0000-0000-000000000002','2026','Salary'),
 'AC-BV16-006 reverse ref belongs only to the active destination identity');

-- Contact references keep their separate insert-only contract.
insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,claim_generation,payload)
values ('0bda3333-0000-0000-0000-000000000003','0bda0000-0000-0000-0000-000000000001','companies','handoff-contact','handoff-contact-key','erpnext','create','committed',1,'{"erp_doc_kind":"contact"}');
select is(public.record_outbox_ref('0bda3333-0000-0000-0000-000000000003',1,'companies','handoff-contact','erpnext','Contact:HANDOFF'),1,
 'AC-BV16-006 Contact finalization remains insert-only');
select throws_ok($$select public.record_outbox_ref('0bda3333-0000-0000-0000-000000000003',1,'companies','handoff-contact','erpnext','Contact:OTHER')$$,'23505','Contact mapping identity conflict',
 'AC-BV16-006 Contact mapping cannot be transferred');

-- A second account/year and a stale destination witness are all refused without moving a ref.
insert into budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,push_state,activated_at_witness,erp_budget_name,erp_docstatus)
values
 ('0bda0000-0000-0000-0000-000000000001','0bda2222-0000-0000-0000-000000000002','2026','COGS','pushing',timestamptz '2026-02-01 00:00:00+00','BUDGET-HANDOFF-COGS',1),
 ('0bda0000-0000-0000-0000-000000000001','0bda2222-0000-0000-0000-000000000002','2027','Salary','pushing',timestamptz '2026-02-01 00:00:00+00','BUDGET-HANDOFF-YEAR',1),
 ('0bda0000-0000-0000-0000-000000000001','0bda2222-0000-0000-0000-000000000002','2026','Equipment','pushing',timestamptz '2026-02-01 00:00:00+00','BUDGET-HANDOFF-CONFLICT',1);
insert into budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,push_state,activated_at_witness,erp_budget_name,erp_docstatus)
values
 ('0bda0000-0000-0000-0000-000000000001','0bda2222-0000-0000-0000-000000000004','2026','Salary','pushed',timestamptz '2025-01-01 00:00:00+00','BUDGET-HANDOFF-COGS',1),
 ('0bda0000-0000-0000-0000-000000000001','0bda2222-0000-0000-0000-000000000005','2025','Salary','pushed',timestamptz '2025-01-01 00:00:00+00','BUDGET-HANDOFF-YEAR',1),
 ('0bda0000-0000-0000-0000-000000000001','0bda2222-0000-0000-0000-000000000006','2026','Equipment','pushed',timestamptz '2025-01-01 00:00:00+00','BUDGET-HANDOFF-CONFLICT',1);
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values
 ('0bda0000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000004','2026','Salary'),'erpnext','BUDGET-HANDOFF-COGS'),
 ('0bda0000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000005','2025','Salary'),'erpnext','BUDGET-HANDOFF-YEAR'),
 ('0bda0000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000006','2026','Equipment'),'erpnext','BUDGET-HANDOFF-CONFLICT'),
 ('0bda0000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000002','2026','Equipment'),'erpnext','BUDGET-OTHER-CONFLICT');
insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,external_record_id,claim_generation)
values
 ('0bda3333-0000-0000-0000-000000000004','0bda0000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000002','2026','COGS'),'handoff-wrong-account','erpnext','create','committed','BUDGET-HANDOFF-COGS',4),
 ('0bda3333-0000-0000-0000-000000000005','0bda0000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000002','2027','Salary'),'handoff-wrong-year','erpnext','create','committed','BUDGET-HANDOFF-YEAR',4),
 ('0bda3333-0000-0000-0000-000000000006','0bda0000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000001','2026','Salary'),'handoff-historical-finalizer','erpnext','create','committed','BUDGET-HANDOFF-1',4),
 ('0bda3333-0000-0000-0000-000000000007','0bda0000-0000-0000-0000-000000000002','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000002','2026','Salary'),'handoff-wrong-org','erpnext','create','committed','BUDGET-HANDOFF-1',4),
 ('0bda3333-0000-0000-0000-000000000008','0bda0000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0bda2222-0000-0000-0000-000000000002','2026','Equipment'),'handoff-conflict','erpnext','create','committed','BUDGET-HANDOFF-CONFLICT',4);
select is(pg_temp.try_handoff('0bda3333-0000-0000-0000-000000000004',4,'BUDGET-HANDOFF-COGS'),0,
 'AC-BV16-006 a different account cannot receive the source Budget mapping');
select is(pg_temp.try_handoff('0bda3333-0000-0000-0000-000000000005',4,'BUDGET-HANDOFF-YEAR'),0,
 'AC-BV16-006 a different fiscal year cannot receive the source Budget mapping');
select is(pg_temp.try_handoff('0bda3333-0000-0000-0000-000000000006',4,'BUDGET-HANDOFF-1'),0,
 'AC-BV16-006 a historical finalizer cannot transfer the mapping back');
select is(pg_temp.try_handoff('0bda3333-0000-0000-0000-000000000007',4,'BUDGET-HANDOFF-1'),0,
 'AC-BV16-006 an outbox in another org cannot claim this account-year mapping');
update budget_version_account_erp_mirror set activated_at_witness=timestamptz '2020-01-01 00:00:00+00'
 where budget_version_id='0bda2222-0000-0000-0000-000000000002' and fiscal_year='2026' and erp_account='Salary';
select is(pg_temp.try_handoff('0bda3333-0000-0000-0000-000000000001',4,'BUDGET-HANDOFF-1'),0,
 'AC-BV16-006 stale activation witness blocks even a replayed handoff');
select is((select count(*)::int from external_refs where external_record_id='BUDGET-HANDOFF-1' and domain='budget'),1,
 'AC-BV16-006 invalid handoff attempts preserve the sole reverse ref');
select is(pg_temp.try_handoff('0bda3333-0000-0000-0000-000000000008',4,'BUDGET-HANDOFF-CONFLICT'),-1,
 'AC-BV16-006 a destination identity conflict aborts the atomic handoff');
select is((select count(*)::int from external_refs where domain='budget' and external_record_id in ('BUDGET-HANDOFF-CONFLICT','BUDGET-OTHER-CONFLICT')),2,
 'AC-BV16-006 failed conflict leaves both pre-existing references intact');

select * from finish();
rollback;
