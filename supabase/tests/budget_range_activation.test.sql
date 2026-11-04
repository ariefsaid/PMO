-- AC-012 / #1472 S5: changed ranges queue exact predecessor cancellation atomically with activation.
begin;
select no_plan();

insert into organizations(id,name) values
  ('14780000-0000-0000-0000-000000000001','Range Activation Account Org'),
  ('14780000-0000-0000-0000-000000000002','Range Activation Legacy Org'),
  ('14780000-0000-0000-0000-000000000003','Range Activation Unbound Org');
insert into auth.users(id,email) values
  ('14780000-0000-0000-0000-0000000000a1','range-finance@example.invalid'),
  ('14780000-0000-0000-0000-0000000000a2','range-drafter@example.invalid'),
  ('14780000-0000-0000-0000-0000000000a3','range-legacy-finance@example.invalid'),
  ('14780000-0000-0000-0000-0000000000a4','range-unbound-finance@example.invalid'),
  ('14780000-0000-0000-0000-0000000000a5','range-legacy-drafter@example.invalid'),
  ('14780000-0000-0000-0000-0000000000a6','range-unbound-drafter@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
  ('14780000-0000-0000-0000-0000000000a1','14780000-0000-0000-0000-000000000001','Range Finance','range-finance@example.invalid','Finance','active'),
  ('14780000-0000-0000-0000-0000000000a2','14780000-0000-0000-0000-000000000001','Range Drafter','range-drafter@example.invalid','Project Manager','active'),
  ('14780000-0000-0000-0000-0000000000a3','14780000-0000-0000-0000-000000000002','Legacy Finance','range-legacy-finance@example.invalid','Finance','active'),
  ('14780000-0000-0000-0000-0000000000a4','14780000-0000-0000-0000-000000000003','Unbound Finance','range-unbound-finance@example.invalid','Finance','active'),
  ('14780000-0000-0000-0000-0000000000a5','14780000-0000-0000-0000-000000000002','Legacy Drafter','range-legacy-drafter@example.invalid','Project Manager','active'),
  ('14780000-0000-0000-0000-0000000000a6','14780000-0000-0000-0000-000000000003','Unbound Drafter','range-unbound-drafter@example.invalid','Project Manager','active');
insert into projects(id,org_id,name,status,start_date,end_date) values
  ('14781111-0000-0000-0000-000000000001','14780000-0000-0000-0000-000000000001','Account predecessor project','Ongoing Project','2027-01-01','2028-12-31'),
  ('14781111-0000-0000-0000-000000000002','14780000-0000-0000-0000-000000000002','Legacy predecessor project','Ongoing Project','2027-01-01','2027-12-31'),
  ('14781111-0000-0000-0000-000000000003','14780000-0000-0000-0000-000000000003','Unbound predecessor project','Ongoing Project','2027-01-01','2027-12-31');
insert into external_org_bindings(org_id,external_tier,site_url,secret_ref,version_major,activated_at) values
  ('14780000-0000-0000-0000-000000000001','erpnext','https://erp.example.invalid','fixture',16,now()),
  ('14780000-0000-0000-0000-000000000002','erpnext','https://erp.example.invalid','fixture',15,now());

insert into budget_versions(id,org_id,project_id,version,name,status,created_by,activated_at,budget_mode) values
  ('14782222-0000-0000-0000-000000000001','14780000-0000-0000-0000-000000000001','14781111-0000-0000-0000-000000000001',1,'Annual predecessor','Active','14780000-0000-0000-0000-0000000000a2','2026-11-01T00:00:00Z','per_year'),
  ('14782222-0000-0000-0000-000000000002','14780000-0000-0000-0000-000000000001','14781111-0000-0000-0000-000000000001',2,'First range','Draft','14780000-0000-0000-0000-0000000000a2',null,'whole_project'),
  ('14782222-0000-0000-0000-000000000003','14780000-0000-0000-0000-000000000001','14781111-0000-0000-0000-000000000001',3,'Same range revision','Draft','14780000-0000-0000-0000-0000000000a2',null,'whole_project'),
  ('14782222-0000-0000-0000-000000000004','14780000-0000-0000-0000-000000000001','14781111-0000-0000-0000-000000000001',4,'Changed range','Draft','14780000-0000-0000-0000-0000000000a2',null,'whole_project'),
  ('14782222-0000-0000-0000-000000000005','14780000-0000-0000-0000-000000000001','14781111-0000-0000-0000-000000000001',5,'Next same range','Draft','14780000-0000-0000-0000-0000000000a2',null,'whole_project'),
  ('14782222-0000-0000-0000-000000000006','14780000-0000-0000-0000-000000000002','14781111-0000-0000-0000-000000000002',1,'Legacy predecessor','Active','14780000-0000-0000-0000-0000000000a5','2026-11-01T00:00:00Z','per_year'),
  ('14782222-0000-0000-0000-000000000007','14780000-0000-0000-0000-000000000002','14781111-0000-0000-0000-000000000002',2,'Legacy range successor','Draft','14780000-0000-0000-0000-0000000000a5',null,'whole_project'),
  ('14782222-0000-0000-0000-000000000008','14780000-0000-0000-0000-000000000003','14781111-0000-0000-0000-000000000003',1,'Unbound predecessor','Active','14780000-0000-0000-0000-0000000000a6','2026-11-01T00:00:00Z','per_year'),
  ('14782222-0000-0000-0000-000000000009','14780000-0000-0000-0000-000000000003','14781111-0000-0000-0000-000000000003',2,'Unbound range successor','Draft','14780000-0000-0000-0000-0000000000a6',null,'whole_project');

insert into budget_line_items(org_id,budget_version_id,category,description,budgeted_amount,actual_amount) values
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000002','Labor','First range total',100,0),
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000003','Labor','Same range total',100,0),
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000004','Labor','Changed range total',100,0),
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000005','Labor','Next range total',100,0),
  ('14780000-0000-0000-0000-000000000002','14782222-0000-0000-0000-000000000007','Labor','Legacy successor total',100,0),
  ('14780000-0000-0000-0000-000000000003','14782222-0000-0000-0000-000000000009','Labor','Unbound successor total',100,0);
insert into budget_distribution_plans(org_id,budget_version_id,method,inputs,category_overrides,basis) values
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000002','by_days','{}','{}','{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb),
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000003','by_days','{}','{}','{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb),
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000004','by_days','{}','{}','{"projectStart":"2027-01-01","projectEnd":"2029-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"},{"name":"FY29","start":"2029-01-01","end":"2029-12-31"}]}'::jsonb),
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000005','by_days','{}','{}','{"projectStart":"2027-01-01","projectEnd":"2029-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"},{"name":"FY29","start":"2029-01-01","end":"2029-12-31"}]}'::jsonb),
  ('14780000-0000-0000-0000-000000000002','14782222-0000-0000-0000-000000000007','by_days','{}','{}','{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb),
  ('14780000-0000-0000-0000-000000000003','14782222-0000-0000-0000-000000000009','by_days','{}','{}','{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb);
insert into budget_year_distributions(org_id,budget_version_id,category,fiscal_year,ordinal,amount,method,is_override) values
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000002','Labor','FY27',0,50,'by_days',false),('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000002','Labor','FY28',1,50,'by_days',false),
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000003','Labor','FY27',0,50,'by_days',false),('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000003','Labor','FY28',1,50,'by_days',false),
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000004','Labor','FY27',0,33.34,'by_days',false),('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000004','Labor','FY28',1,33.33,'by_days',false),('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000004','Labor','FY29',2,33.33,'by_days',false),
  ('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000005','Labor','FY27',0,33.34,'by_days',false),('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000005','Labor','FY28',1,33.33,'by_days',false),('14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000005','Labor','FY29',2,33.33,'by_days',false),
  ('14780000-0000-0000-0000-000000000002','14782222-0000-0000-0000-000000000007','Labor','FY27',0,100,'by_days',false),
  ('14780000-0000-0000-0000-000000000003','14782222-0000-0000-0000-000000000009','Labor','FY27',0,100,'by_days',false);
update budget_versions set status='Active' where id in ('14782222-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000006','14782222-0000-0000-0000-000000000008');
insert into budget_version_account_erp_mirror
  (id,org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,pushed_project_start_date,pushed_project_end_date)
values ('14783333-0000-0000-0000-000000000001','14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000001','FY27','Labor','ensure','pushed','2026-11-01T00:00:00Z','BUD-ANNUAL-ACCOUNT',1,'2026-11-01T00:00:00Z','2027-01-01','2028-12-31');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values
  ('14780000-0000-0000-0000-000000000001','budget',public.budget_account_identity('14782222-0000-0000-0000-000000000001','FY27','Labor'),'erpnext','BUD-ANNUAL-ACCOUNT');
insert into budget_version_erp_mirror
  (id,org_id,budget_version_id,fiscal_year,push_state,activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,pushed_project_start_date,pushed_project_end_date)
values ('14783333-0000-0000-0000-000000000002','14780000-0000-0000-0000-000000000002','14782222-0000-0000-0000-000000000006','FY27','pushed','2026-11-01T00:00:00Z','BUD-ANNUAL-LEGACY',1,'2026-11-01T00:00:00Z','2027-01-01','2027-12-31');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values
  ('14780000-0000-0000-0000-000000000002','budget',public.budget_legacy_identity('14782222-0000-0000-0000-000000000006','FY27'),'erpnext','BUD-ANNUAL-LEGACY');
insert into budget_version_account_erp_mirror
  (id,org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,pushed_project_start_date,pushed_project_end_date)
values ('14783333-0000-0000-0000-000000000004','14780000-0000-0000-0000-000000000003','14782222-0000-0000-0000-000000000008','FY27','Labor','ensure','pushed','2026-11-01T00:00:00Z','BUD-UNBOUND',1,'2026-11-01T00:00:00Z','2027-01-01','2027-12-31');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values
  ('14780000-0000-0000-0000-000000000003','budget',public.budget_account_identity('14782222-0000-0000-0000-000000000008','FY27','Labor'),'erpnext','BUD-UNBOUND');

set local role authenticated;
set local request.jwt.claims='{"sub":"14780000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.activate_budget_version('14782222-0000-0000-0000-000000000002')$$,
  'AC-012 activation from annual to range queues a witnessed v16 predecessor cancellation');
reset role;
select is((select status::text from budget_versions where id='14782222-0000-0000-0000-000000000001'),'Archived',
  'AC-012 predecessor archival is atomic with successor activation');
select is((select status::text from budget_versions where id='14782222-0000-0000-0000-000000000002'),'Active',
  'AC-012 changed-range successor becomes Active only after the queue is written');
select is((select count(*)::int from budget_archive_requests where budget_version_id='14782222-0000-0000-0000-000000000001' and queued_by_activation),1,
  'AC-012 cancellation provenance is stored on the durable request');
select is((select count(*)::int from budget_archive_cancel_intents i join budget_archive_requests r on r.id=i.request_id where i.budget_version_id='14782222-0000-0000-0000-000000000001' and r.queued_by_activation and i.source_kind='account' and i.source_mirror_id='14783333-0000-0000-0000-000000000001' and i.erp_budget_name='BUD-ANNUAL-ACCOUNT' and i.fiscal_year='FY27' and i.to_fiscal_year is null and i.erp_modified='2026-11-01T00:00:00Z' and i.state='pending'),1,
  'AC-012 account cancellation retains exact source, name, year, and modified witness');
select is((select budget_intent from budget_version_account_erp_mirror where id='14783333-0000-0000-0000-000000000001'),'remove',
  'AC-012 account mirror exposes the pending removal');

set local role authenticated;
set local request.jwt.claims='{"sub":"14780000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.activate_budget_version('14782222-0000-0000-0000-000000000003')$$,
  'AC-012 same-range revision activates without bulk cancellation');
reset role;
select is((select count(*)::int from budget_archive_requests where queued_by_activation and budget_version_id='14782222-0000-0000-0000-000000000002'),0,
  'AC-012 same-range revision follows the exact amend path without an activation cancellation request');

insert into budget_version_account_erp_mirror
  (id,org_id,budget_version_id,fiscal_year,to_fiscal_year,erp_account,budget_intent,push_state,activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,pushed_project_start_date,pushed_project_end_date)
select '14783333-0000-0000-0000-000000000003','14780000-0000-0000-0000-000000000001','14782222-0000-0000-0000-000000000003','FY27','FY28','Labor','ensure','pushed',v.activated_at,'BUD-RANGE-SAME',1,'2026-11-03T00:00:00Z','2027-01-01','2028-12-31'
  from budget_versions v where v.id='14782222-0000-0000-0000-000000000003';
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values
  ('14780000-0000-0000-0000-000000000001','budget',public.budget_account_identity('14782222-0000-0000-0000-000000000003','FY27','FY28','Labor'),'erpnext','BUD-RANGE-SAME');
update projects set end_date='2029-12-31' where id='14781111-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"14780000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.activate_budget_version('14782222-0000-0000-0000-000000000004')$$,
  'AC-012 a changed range queues cancellation for the exact old range');
reset role;
select is((select count(*)::int from budget_archive_cancel_intents i join budget_archive_requests r on r.id=i.request_id where i.budget_version_id='14782222-0000-0000-0000-000000000003' and r.queued_by_activation and i.source_kind='account' and i.source_mirror_id='14783333-0000-0000-0000-000000000003' and i.erp_budget_name='BUD-RANGE-SAME' and i.fiscal_year='FY27' and i.to_fiscal_year='FY28' and i.erp_modified='2026-11-03T00:00:00Z' and i.state='pending'),1,
  'AC-012 range replacement intent preserves both year endpoints and exact predecessor modified stamp');
set local role authenticated;
set local request.jwt.claims='{"sub":"14780000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.activate_budget_version('14782222-0000-0000-0000-000000000005')$$,
  'AC-012 same range after activation remains eligible without bulk cancellation');
reset role;
select is((select count(*)::int from budget_archive_requests where queued_by_activation and budget_version_id='14782222-0000-0000-0000-000000000004'),0,
  'AC-012 same-range successor creates no cancellation request');

set local role authenticated;
set local request.jwt.claims='{"sub":"14780000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.activate_budget_version('14782222-0000-0000-0000-000000000009')$$,
  'P0001','predecessor ERPNext Budget cancellation is not provably safe for every live target (1 of 1 target(s) are ineligible)',
  'AC-012 missing binding holds activation instead of assuming no live ERP control');
reset role;
select is((select status::text from budget_versions where id='14782222-0000-0000-0000-000000000008'),'Active',
  'AC-012 failed predecessor reconciliation leaves the predecessor Active');
select is((select status::text from budget_versions where id='14782222-0000-0000-0000-000000000009'),'Draft',
  'AC-012 failed predecessor reconciliation leaves the successor Draft');
select is((select count(*)::int from budget_archive_requests where budget_version_id='14782222-0000-0000-0000-000000000008'),0,
  'AC-012 failed queue rolls back without leaving a request or partial intent');

set local role authenticated;
set local request.jwt.claims='{"sub":"14780000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$select public.activate_budget_version('14782222-0000-0000-0000-000000000007')$$,
  'AC-012 v15 legacy predecessor is queued through its own provenance lane');
reset role;
select is((select count(*)::int from budget_archive_cancel_intents i join budget_archive_requests r on r.id=i.request_id where i.budget_version_id='14782222-0000-0000-0000-000000000006' and r.queued_by_activation and i.source_kind='legacy' and i.source_mirror_id='14783333-0000-0000-0000-000000000002' and i.erp_budget_name='BUD-ANNUAL-LEGACY' and i.fiscal_year='FY27' and i.to_fiscal_year is null and i.erp_account is null and i.state='pending'),1,
  'AC-012 legacy cancellation preserves the source mirror and never fabricates an account');

select ok(not has_function_privilege('authenticated','public.queue_budget_archive_cancel(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.queue_budget_archive_cancel(uuid,uuid,uuid)','EXECUTE'),
  'AC-012 queue helper is internal and cannot be called directly by a JWT role');
select ok(has_function_privilege('authenticated','public.activate_budget_version(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.activate_budget_version(uuid)','EXECUTE'),
  'AC-012 activation retains its authenticated-only gate');

select * from finish();
rollback;
