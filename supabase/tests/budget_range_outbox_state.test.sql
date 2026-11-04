-- AC-010/011: range recovery state lives on the generation-fenced command row and every stage is CAS-bound.
begin;
select no_plan();
insert into organizations(id,name) values ('14790000-0000-0000-0000-000000000001','Range Outbox State Org');
insert into auth.users(id,email) values ('14790000-0000-0000-0000-0000000000a1','range-outbox@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
  ('14790000-0000-0000-0000-0000000000a1','14790000-0000-0000-0000-000000000001','Range Outbox User','range-outbox@example.invalid','Finance','active');
insert into projects(id,org_id,name,status,start_date,end_date) values
  ('14791111-0000-0000-0000-000000000001','14790000-0000-0000-0000-000000000001','Range Outbox Project','Ongoing Project','2027-01-01','2028-12-31');
insert into external_org_bindings(org_id,external_tier,site_url,secret_ref,version_major,activated_at)
values ('14790000-0000-0000-0000-000000000001','erpnext','https://erp.example.invalid','fixture',16,now());
insert into budget_versions(id,org_id,project_id,version,name,status,created_by,activated_at,budget_mode)
values ('14792222-0000-0000-0000-000000000001','14790000-0000-0000-0000-000000000001','14791111-0000-0000-0000-000000000001',2,'Range Active','Active','14790000-0000-0000-0000-0000000000a1','2026-11-04T00:00:00Z','whole_project');
insert into budget_versions(id,org_id,project_id,version,name,status,created_by,activated_at,budget_mode)
values ('14792222-0000-0000-0000-000000000002','14790000-0000-0000-0000-000000000001','14791111-0000-0000-0000-000000000001',1,'Range Prior','Archived','14790000-0000-0000-0000-0000000000a1','2026-10-01T00:00:00Z','whole_project');
insert into budget_version_account_erp_mirror
  (org_id,budget_version_id,fiscal_year,to_fiscal_year,erp_account,budget_intent,push_state,
   activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,erp_cancelled_at,
   pushed_project_start_date,pushed_project_end_date)
values
  ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000002','FY27','FY28','Labor','ensure','pushed',
   '2026-10-01T00:00:00Z','BUD-RANGE-PRIOR',1,'m-source',null,'2027-01-01','2028-12-31');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id)
values ('14790000-0000-0000-0000-000000000001','budget',
  public.budget_account_identity('14792222-0000-0000-0000-000000000002','FY27','FY28','Labor'),
  'erpnext','BUD-RANGE-PRIOR');

insert into external_command_outbox
  (id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload,payload_digest)
values
  ('14794444-0000-0000-0000-000000000001','14790000-0000-0000-0000-000000000001','budget',
   public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),
   'bud16:range-state:1','erpnext','create','pending','14790000-0000-0000-0000-0000000000a1',
   jsonb_build_object('id','14792222-0000-0000-0000-000000000001','projectId','14791111-0000-0000-0000-000000000001',
     'erp_doc_kind','budget','budget_mode','whole_project','fiscal_year','FY27','to_fiscal_year','FY28',
     'erp_account','Labor','budget_intent','ensure','outbox_identity',
     public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor')),
   repeat('a',64));
update external_command_outbox set state='committing',claim_generation=1,claimed_at=now()
 where id='14794444-0000-0000-0000-000000000001';

select ok(has_function_privilege('service_role','public.read_budget_range_outbox_state(uuid,integer,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.advance_budget_range_outbox_stage(uuid,integer,text,text,text,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.read_budget_range_outbox_state(uuid,integer,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.advance_budget_range_outbox_stage(uuid,integer,text,text,text,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.advance_budget_range_outbox_stage(uuid,integer,text,text,text,jsonb)','EXECUTE'),
  'AC-010 range stage RPCs are available only to service_role');

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.read_budget_range_outbox_state('14794444-0000-0000-0000-000000000001',1,repeat('a',64),
  public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor')),null::jsonb,
  'AC-010 a fresh claimed range command has no provisional ERP document witness');
select ok(public.advance_budget_range_outbox_stage('14794444-0000-0000-0000-000000000001',1,repeat('a',64),
  public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),null,
  jsonb_build_object('stage','post_started','identity',public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),
    'payloadDigest',repeat('a',64),'mode','create','expectedDistributionFingerprint',repeat('b',64))),
  'AC-010 the create-attempt stage is persisted before the anchorless POST');
select is(public.read_budget_range_outbox_state('14794444-0000-0000-0000-000000000001',1,repeat('a',64),
  public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'))->>'stage','post_started',
  'AC-010 the exact claim reads back its durable stage');
select ok(not public.advance_budget_range_outbox_stage('14794444-0000-0000-0000-000000000001',2,repeat('a',64),
  public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),'post_started',
  jsonb_build_object('stage','draft_witnessed','identity',public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),
    'payloadDigest',repeat('a',64),'draftName','BUD-RANGE','draftOwner','api-user','initialModified','m1',
    'initialFingerprint',repeat('c',64),'expectedDistributionFingerprint',repeat('b',64))),
  'AC-010 stale generation cannot write a provisional document witness');
select ok(not public.advance_budget_range_outbox_stage('14794444-0000-0000-0000-000000000001',1,repeat('d',64),
  public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),'post_started',
  jsonb_build_object('stage','draft_witnessed','identity',public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),
    'payloadDigest',repeat('d',64),'draftName','BUD-RANGE','draftOwner','api-user','initialModified','m1',
    'initialFingerprint',repeat('c',64),'expectedDistributionFingerprint',repeat('b',64))),
  'AC-010 wrong immutable payload digest cannot write a draft witness');
select throws_ok($$select public.advance_budget_range_outbox_stage('14794444-0000-0000-0000-000000000001',1,repeat('a',64),
  public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),'post_started',
  jsonb_build_object('stage','submitted','identity',public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),
    'payloadDigest',repeat('a',64),'draftName','BUD-RANGE','draftOwner','api-user','initialModified','m1',
    'initialFingerprint',repeat('c',64),'expectedDistributionFingerprint',repeat('b',64),'savedModified','m2','savedFingerprint',repeat('e',64)))$$,
  '22023','invalid range budget stage transition','AC-010 illegal stage jump is rejected');
select ok(public.advance_budget_range_outbox_stage('14794444-0000-0000-0000-000000000001',1,repeat('a',64),
  public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),'post_started',
  jsonb_build_object('stage','draft_witnessed','identity',public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),
    'payloadDigest',repeat('a',64),'draftName','BUD-RANGE','draftOwner','api-user','initialModified','m1',
    'initialFingerprint',repeat('c',64),'expectedDistributionFingerprint',repeat('b',64))),
  'AC-010 exact returned draft name, API owner, modified stamp and content fingerprint are witnessed');
select ok(public.advance_budget_range_outbox_stage('14794444-0000-0000-0000-000000000001',1,repeat('a',64),
  public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),'draft_witnessed',
  jsonb_build_object('stage','distribution_put_started','identity',public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),
    'payloadDigest',repeat('a',64),'draftName','BUD-RANGE','draftOwner','api-user','initialModified','m1',
    'initialFingerprint',repeat('c',64),'expectedDistributionFingerprint',repeat('b',64))),
  'AC-010 distribution PUT begins only after the exact draft witness');
select throws_ok($$select public.advance_budget_range_outbox_stage('14794444-0000-0000-0000-000000000001',1,repeat('a',64),
  public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),'distribution_put_started',
  jsonb_build_object('stage','distribution_saved','identity',public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),
    'payloadDigest',repeat('a',64),'draftName','BUD-RANGE','draftOwner','api-user','initialModified','m1',
    'initialFingerprint',repeat('c',64),'expectedDistributionFingerprint',repeat('b',64)))$$,
  '22023','range budget saved distribution witness is incomplete','AC-010 final readback witness is mandatory before submit');
reset role;

-- The same durable range identity also carries an exact, witnessed account removal from a prior range owner.
update external_command_outbox set state='confirmed',external_record_id='BUD-RANGE-NEW'
 where id='14794444-0000-0000-0000-000000000001';
select lives_ok($$insert into external_command_outbox
  (id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload,payload_digest)
values
  ('14794444-0000-0000-0000-000000000002','14790000-0000-0000-0000-000000000001','budget',
   public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor'),
   'bud16:range-remove:1','erpnext','create','pending','14790000-0000-0000-0000-0000000000a1',
   jsonb_build_object('id','14792222-0000-0000-0000-000000000001','projectId','14791111-0000-0000-0000-000000000001',
     'erp_doc_kind','budget','budget_mode','whole_project','fiscal_year','FY27','to_fiscal_year','FY28',
     'erp_account','Labor','budget_intent','remove','budget_predecessor','BUD-RANGE-PRIOR',
     'budget_predecessor_modified','m-source','outbox_identity',
     public.budget_account_identity('14792222-0000-0000-0000-000000000001','FY27','FY28','Labor')),
   repeat('f',64))$$,
  'AC-010 a range account removal is admitted only for its exact witnessed same-range predecessor');

select * from finish();
rollback;
