-- 0850: an archive-cancel (budget_intent 'remove') outbox row records its ERP reference even though the
-- version it finalizes against is, by definition, Archived. Every other guard in record_outbox_ref holds.
begin;
select plan(13);

insert into organizations(id,name) values
 ('0b850000-0000-0000-0000-000000000001','Archive Ref Org'),
 ('0b850000-0000-0000-0000-000000000002','Archive Ref Other Org');
insert into projects(id,org_id,name,status,start_date,end_date) values
 ('0b851111-0000-0000-0000-000000000001','0b850000-0000-0000-0000-000000000001','Archive Ref Project','Ongoing Project',date '2025-01-01',date '2025-12-31');
insert into budget_versions(id,org_id,project_id,version,name,status,activated_at) values
 ('0b852222-0000-0000-0000-000000000001','0b850000-0000-0000-0000-000000000001','0b851111-0000-0000-0000-000000000001',1,'Old','Archived',timestamptz '2026-10-01 00:00:00+00'),
 ('0b852222-0000-0000-0000-000000000002','0b850000-0000-0000-0000-000000000001','0b851111-0000-0000-0000-000000000001',2,'Live','Active',timestamptz '2026-10-02 00:00:00+00'),
 ('0b852222-0000-0000-0000-000000000003','0b850000-0000-0000-0000-000000000001','0b851111-0000-0000-0000-000000000001',3,'Older','Archived',timestamptz '2026-10-03 00:00:00+00');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into budget_version_account_erp_mirror(org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness,erp_budget_name,erp_docstatus)
values
 ('0b850000-0000-0000-0000-000000000001','0b852222-0000-0000-0000-000000000001','2025','Salary','remove','pending',timestamptz '2026-10-01 00:00:00+00','BUD-OLD-SAL',1),
 ('0b850000-0000-0000-0000-000000000001','0b852222-0000-0000-0000-000000000001','2025','Travel','ensure','pushed',timestamptz '2026-10-01 00:00:00+00','BUD-OLD-TRV',1),
 ('0b850000-0000-0000-0000-000000000001','0b852222-0000-0000-0000-000000000001','2025','Vehicle','ensure','pushed',timestamptz '2026-10-01 00:00:00+00','BUD-OLD-VEH',1),
 ('0b850000-0000-0000-0000-000000000001','0b852222-0000-0000-0000-000000000002','2025','Rent','remove','pending',timestamptz '2026-10-02 00:00:00+00','BUD-LIVE-RENT',1),
 -- a second Archived version's remove slot naming a Budget another identity's ref already owns
 ('0b850000-0000-0000-0000-000000000001','0b852222-0000-0000-0000-000000000003','2025','Travel','remove','pending',timestamptz '2026-10-03 00:00:00+00','BUD-OLD-TRV',1);
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values
 ('0b850000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0b852222-0000-0000-0000-000000000001','2025','Salary'),'erpnext','BUD-OLD-SAL'),
 ('0b850000-0000-0000-0000-000000000001','budget',public.budget_account_identity('0b852222-0000-0000-0000-000000000001','2025','Travel'),'erpnext','BUD-OLD-TRV');

insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,external_record_id,claim_generation,payload)
values
 -- archive-cancel of an Archived version's account
 ('0b853333-0000-0000-0000-000000000001','0b850000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b852222-0000-0000-0000-000000000001','2025','Salary'),'k-remove','erpnext','create','committed','BUD-OLD-SAL',1,'{"budget_intent":"remove"}'),
 -- same Archived version, but an ensure (non-remove) row
 ('0b853333-0000-0000-0000-000000000002','0b850000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b852222-0000-0000-0000-000000000001','2025','Travel'),'k-ensure','erpnext','create','committed','BUD-OLD-TRV',1,'{}'),
 -- a remove-payload row whose mirror slot is an ensure slot
 ('0b853333-0000-0000-0000-000000000005','0b850000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b852222-0000-0000-0000-000000000001','2025','Vehicle'),'k-remove-on-ensure','erpnext','create','committed','BUD-OLD-VEH',1,'{"budget_intent":"remove"}'),
 -- a remove row that would take over a Budget another identity's ref owns
 ('0b853333-0000-0000-0000-000000000006','0b850000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b852222-0000-0000-0000-000000000003','2025','Travel'),'k-remove-owned','erpnext','create','committed','BUD-OLD-TRV',1,'{"budget_intent":"remove"}'),
 -- a remove row whose version is NOT Archived
 ('0b853333-0000-0000-0000-000000000003','0b850000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('0b852222-0000-0000-0000-000000000002','2025','Rent'),'k-remove-live','erpnext','create','committed','BUD-LIVE-RENT',1,'{"budget_intent":"remove"}'),
 -- another org's remove row carrying org 1's identity
 ('0b853333-0000-0000-0000-000000000004','0b850000-0000-0000-0000-000000000002','budget',
  public.budget_account_identity('0b852222-0000-0000-0000-000000000001','2025','Salary'),'k-remove-other','erpnext','create','committed','BUD-OLD-SAL',1,'{"budget_intent":"remove"}');

select is(public.record_outbox_ref('0b853333-0000-0000-0000-000000000001',1,'budget','ignored','erpnext','BUD-OLD-SAL'),1,
 'AC-BV16-011 an archive-cancel remove row on an Archived version records its ref');
select is(public.record_outbox_ref('0b853333-0000-0000-0000-000000000001',1,'budget','ignored','erpnext','BUD-OLD-SAL'),1,
 'AC-BV16-011 a replayed archive-cancel finalize still succeeds');
select is((select count(*)::int from external_refs where external_record_id='BUD-OLD-SAL'),1,
 'AC-BV16-011 exactly one ref remains for the cancelled Budget');
select is(public.record_outbox_ref('0b853333-0000-0000-0000-000000000001',0,'budget','ignored','erpnext','BUD-OLD-SAL'),0,
 'AC-BV16-011 a stale claim generation is still refused on a remove row');
select is(public.record_outbox_ref('0b853333-0000-0000-0000-000000000001',1,'budget','ignored','erpnext','BUD-OTHER'),0,
 'AC-BV16-011 a remove row cannot record a Budget other than the one its commit stored');
select is(public.record_outbox_ref('0b853333-0000-0000-0000-000000000002',1,'budget','ignored','erpnext','BUD-OLD-TRV'),0,
 'AC-BV16-011 a non-remove row on an Archived version is still refused');
select is(public.record_outbox_ref('0b853333-0000-0000-0000-000000000005',1,'budget','ignored','erpnext','BUD-OLD-VEH'),0,
 'AC-BV16-011 a remove row cannot finalize against a slot that is not a remove slot');
select is(public.record_outbox_ref('0b853333-0000-0000-0000-000000000006',1,'budget','ignored','erpnext','BUD-OLD-TRV'),0,
 'AC-BV16-011 a remove row cannot repoint a Budget ref that another identity owns');
select is(public.record_outbox_ref('0b853333-0000-0000-0000-000000000003',1,'budget','ignored','erpnext','BUD-LIVE-RENT'),0,
 'AC-BV16-011 a remove row for a version that is not Archived is refused');
select is(public.record_outbox_ref('0b853333-0000-0000-0000-000000000004',1,'budget','ignored','erpnext','BUD-OLD-SAL'),0,
 'AC-BV16-011 another org''s remove row cannot finalize against this org''s version');
select is((select count(*)::int from external_refs where external_record_id in ('BUD-LIVE-RENT','BUD-OTHER','BUD-OLD-VEH')),0,
 'AC-BV16-011 the refused rows write no ref');
select is((select pmo_record_id from external_refs where external_record_id='BUD-OLD-TRV'),
 public.budget_account_identity('0b852222-0000-0000-0000-000000000001','2025','Travel'),
 'AC-BV16-011 a refused remove leaves the owning identity''s ref untouched');
select is((select count(*)::int from external_refs where org_id='0b850000-0000-0000-0000-000000000002'),0,
 'AC-BV16-011 nothing is written under the other org');

select * from finish();
rollback;
