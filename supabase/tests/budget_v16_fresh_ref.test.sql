-- 0379: a FRESH v16 account push records its ERP Budget ref, and wedged commits are finalized once.
--
-- The served dispatch writes the account slot (push_state 'pending', erp_budget_name NULL) before the
-- push, and the success writer fills erp_budget_name only AFTER record_outbox_ref. 0293 required the
-- slot to already carry the ERP name, so every fresh push was refused at the ref step and the
-- committed outbox row could never be finalized.
begin;
select plan(17);

insert into organizations(id,name) values ('0b790000-0000-0000-0000-000000000001','Fresh Ref Org');
insert into projects(id,org_id,name,status,start_date,end_date) values
 ('0b791111-0000-0000-0000-000000000001','0b790000-0000-0000-0000-000000000001','Fresh Project','Ongoing Project',date '2025-01-01',date '2025-12-31');
insert into budget_versions(id,org_id,project_id,version,name,status,activated_at) values
 ('0b792222-0000-0000-0000-000000000001','0b790000-0000-0000-0000-000000000001','0b791111-0000-0000-0000-000000000001',1,'Fresh','Active',timestamptz '2026-10-24 09:55:00+00'),
 ('0b792222-0000-0000-0000-000000000002','0b790000-0000-0000-0000-000000000001','0b791111-0000-0000-0000-000000000001',2,'Old','Archived',timestamptz '2026-10-01 00:00:00+00');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- The account slots exactly as the served dispatch writes them: pending, no ERP name yet.
insert into budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness)
values
 ('0b790000-0000-0000-0000-000000000001','0b792222-0000-0000-0000-000000000001','2025','Salary','ensure','pending',timestamptz '2026-10-24 09:55:00+00'),
 ('0b790000-0000-0000-0000-000000000001','0b792222-0000-0000-0000-000000000001','2025','Travel','ensure','pending',timestamptz '2026-10-24 09:55:00+00'),
 ('0b790000-0000-0000-0000-000000000001','0b792222-0000-0000-0000-000000000001','2025','Vehicle','ensure','pending',timestamptz '2026-10-24 09:55:00+00'),
 ('0b790000-0000-0000-0000-000000000001','0b792222-0000-0000-0000-000000000002','2025','Salary','ensure','pending',timestamptz '2026-10-01 00:00:00+00');
update budget_version_account_erp_mirror set erp_budget_name='BUDGET-OTHER'
 where budget_version_id='0b792222-0000-0000-0000-000000000001' and erp_account='Vehicle';

insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,external_record_id,claim_generation,payload,canonical)
values
 ('0b793333-0000-0000-0000-000000000001','0b790000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b792222-0000-0000-0000-000000000001','2025','Salary'),'fresh-salary','erpnext','create','committed','BUDGET-FRESH-1',1,'{}',
  '{"erp_budget_name":"BUDGET-FRESH-1","erp_docstatus":1,"erp_modified":"2026-10-24 16:55:11","budget_intent":"ensure"}'),
 ('0b793333-0000-0000-0000-000000000002','0b790000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b792222-0000-0000-0000-000000000001','2025','Vehicle'),'fresh-vehicle','erpnext','create','committed','BUDGET-FRESH-2',1,'{}',
  '{"erp_budget_name":"BUDGET-FRESH-2","erp_docstatus":1}');

-- ── record_outbox_ref on the fresh path ──────────────────────────────────────────────────────────────
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

-- ── the one-off finalize of commits wedged before 0379 ──────────────────────────────────────────────
reset role;
delete from external_refs where external_record_id='BUDGET-FRESH-1';
insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,external_record_id,claim_generation,payload,canonical)
values
 ('0b793333-0000-0000-0000-000000000003','0b790000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b792222-0000-0000-0000-000000000002','2025','Salary'),'archived-salary','erpnext','create','committed','BUDGET-ARCHIVED',1,'{}',
  '{"erp_budget_name":"BUDGET-ARCHIVED","erp_docstatus":1}'),
 ('0b793333-0000-0000-0000-000000000004','0b790000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b792222-0000-0000-0000-000000000001','2025','Travel'),'travel-mismatch','erpnext','create','committed','BUDGET-TRAVEL',1,'{}',
  '{"erp_budget_name":"BUDGET-SOMETHING-ELSE","erp_docstatus":1}');

select is(public.finalize_wedged_v16_budget_commits(),1,
 'AC-BV16-010 exactly the one wedged commit of an Active version is finalized');
select is((select state from external_command_outbox where id='0b793333-0000-0000-0000-000000000001'),'confirmed',
 'AC-BV16-010 the wedged outbox row is confirmed');
select is((select push_state from budget_version_account_erp_mirror where budget_version_id='0b792222-0000-0000-0000-000000000001' and erp_account='Salary'),'pushed',
 'AC-BV16-010 its account mirror reports pushed');
select is((select erp_budget_name from budget_version_account_erp_mirror where budget_version_id='0b792222-0000-0000-0000-000000000001' and erp_account='Salary'),'BUDGET-FRESH-1',
 'AC-BV16-010 the mirror names the ERP Budget the commit created');
select is((select erp_docstatus::int from budget_version_account_erp_mirror where budget_version_id='0b792222-0000-0000-0000-000000000001' and erp_account='Salary'),1,
 'AC-BV16-010 the mirror carries the committed docstatus');
select is((select count(*)::int from external_refs where domain='budget' and external_record_id='BUDGET-FRESH-1'
   and pmo_record_id=public.budget_account_identity('0b792222-0000-0000-0000-000000000001','2025','Salary')),1,
 'AC-BV16-010 the ownership ref is recorded so later pushes recognise the Budget as PMO''s');
select is((select state from external_command_outbox where id='0b793333-0000-0000-0000-000000000003'),'committed',
 'AC-BV16-010 a commit for a version that is no longer Active is left for an operator');
select is((select state from external_command_outbox where id='0b793333-0000-0000-0000-000000000004'),'committed',
 'AC-BV16-010 a commit whose stored ERP name disagrees with its outbox row is left untouched');
select is((select state from external_command_outbox where id='0b793333-0000-0000-0000-000000000002'),'committed',
 'AC-BV16-010 a commit whose slot names a different Budget is left untouched');
select is(public.finalize_wedged_v16_budget_commits(),0,
 'AC-BV16-010 a second run finalizes nothing');

set local role authenticated;
select throws_ok($$select public.finalize_wedged_v16_budget_commits()$$,'42501',null,
 'AC-BV16-010 an app user cannot run the repair');

select * from finish();
rollback;
