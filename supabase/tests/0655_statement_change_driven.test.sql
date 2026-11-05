-- AC-CD-001..005: change-driven statement refresh admission. A tick runs a statement refresh only for a first
-- publication, an unfinished nightly date or an unacknowledged intent; a changed hint alone never runs. Runs
-- acknowledge only the revisions captured at admission, failures back off, and the user/post triggers coalesce.
begin;
select no_plan();
insert into public.organizations(id,name,default_currency,default_timezone) values
 ('06550000-0000-0000-0000-000000000001','Driven fixture A','IDR','UTC'),
 ('06550000-0000-0000-0000-000000000002','Driven fixture B','IDR','UTC');
insert into auth.users(id,email) values
 ('06550000-0000-0000-0000-0000000000a1','driven-admin@example.test'),
 ('06550000-0000-0000-0000-0000000000a2','driven-engineer@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('06550000-0000-0000-0000-0000000000a1','06550000-0000-0000-0000-000000000001','Driven Admin','driven-admin@example.test','Admin','active'),
 ('06550000-0000-0000-0000-0000000000a2','06550000-0000-0000-0000-000000000001','Driven Engineer','driven-engineer@example.test','Engineer','active');
set local role service_role;
insert into public.external_org_bindings(id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at) values
 ('06550000-0000-0000-0000-000000000011','06550000-0000-0000-0000-000000000001','erpnext','https://example.invalid','fixture',16,'{"company":"Driven A","project_map":{}}','2026-10-18T09:00:00Z');
insert into public.erp_sweep_lock(org_id,holder,locked_until) values
 ('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101',clock_timestamp()+interval '60 minutes');
select is(public.sync_erp_statement_change_scope('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')->>'enabled','true','AC-CD-001 state is on by default at deploy');
reset role;
create temporary table fx as select scope_epoch epoch from public.erp_statement_change_state where org_id='06550000-0000-0000-0000-000000000001';
grant select on fx to service_role;

set local role service_role;
select is(public.plan_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx))->>'reason','first_publication','AC-CD-001 no published generation for this binding runs a first publication');
reset role;
-- a published generation for this binding and company
insert into public.erp_financial_statement_snapshot
 (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
  current_start,current_end,prior_start,prior_end,currency,as_of,capture_started_at,capture_completed_at,
  source_report,report_version,filters,settings,payload,raw_reports,has_activity,display_precision,display_rounding_method)
values ('06550000-0000-0000-0000-000000000001','Driven A','06550000-0000-0000-0000-000000000201','06550000-0000-0000-0000-000000000202','profit_and_loss','company',null,'account_breakdown','month',
  '2025-08-01','2025-08-31','2025-07-01','2025-07-31','IDR',clock_timestamp(),clock_timestamp()-interval '1 second',clock_timestamp(),
  'Profit and Loss Statement','synthetic',null,null,'{"current":{"rows":[]},"prior":{"rows":[]}}','{"current":"{}","prior":"{}"}',false,2,'Commercial Rounding');
insert into public.erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context) values
 ('06550000-0000-0000-0000-000000000001','Driven A','06550000-0000-0000-0000-000000000201','06550000-0000-0000-0000-000000000202',
  '{"binding":{"id":"06550000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16}}')
on conflict do nothing;
set local role service_role;
select is(public.plan_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx))->>'mode','skip','AC-CD-001 an unchanged published catalogue with nothing due runs no refresh');
-- a changed hint only marks dirty: still no run before the nightly date
select public.observe_erp_statement_change('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx),'{"status":"unknown","reason":"request_failed"}');
select is(public.plan_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx))->>'mode','skip','AC-CD-001 a dirty hint alone waits for the nightly obligation');

-- manual/internal intent runs; completion acknowledges only the captured revision
select is(public.request_erp_statement_manual_intent('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')->>'status','accepted','AC-CD-004 internal intent accepted');
create temporary table cut as select public.plan_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx)) p;
reset role;
grant select on cut to service_role;
select is((select p->>'reason' from cut),'intent','AC-CD-004 an unacknowledged intent runs a refresh');
-- a confirmed ERP post after admission raises the revision above the captured cut
insert into public.external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state)
 values ('06550000-0000-0000-0000-000000000001','invoice','r1','k1','erpnext','create','committed');
update public.external_command_outbox set state='confirmed' where idempotency_key='k1';
select is((select intent_revision from public.erp_statement_change_state where org_id='06550000-0000-0000-0000-000000000001'),2::bigint,'AC-CD-005 a confirmed ERP post raises the intent revision without the user quota');
update public.external_command_outbox set state='confirmed',updated_at=now() where idempotency_key='k1';
select is((select intent_revision from public.erp_statement_change_state where org_id='06550000-0000-0000-0000-000000000001'),2::bigint,'AC-CD-005 an already-confirmed row does not re-raise it');
set local role service_role;
select is(public.complete_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx),(select (p->>'dirty_cut')::bigint from cut),(select (p->>'intent_cut')::bigint from cut),null,'06550000-0000-0000-0000-000000000201')->>'status','completed','AC-CD-004 completion settles the run');
reset role;
select is((select intent_acked from public.erp_statement_change_state where org_id='06550000-0000-0000-0000-000000000001'),1::bigint,'AC-CD-004 only the captured intent is acknowledged; the later post survives');
select ok((select dirty_acked<dirty_revision from public.erp_statement_change_state where org_id='06550000-0000-0000-0000-000000000001'),'AC-CD-004 an intent-only run leaves hint dirtiness pending for the nightly');
set local role service_role;
select is(public.plan_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx))->>'reason','intent','AC-CD-005 the post-admission intent still runs next');

-- nightly: an overdue local date runs and its completion clears the captured dirty revision
reset role;
update public.erp_statement_change_state set next_nightly_date=((clock_timestamp() at time zone 'UTC')::date-2),intent_acked=intent_revision where org_id='06550000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.record_erp_statement_nightly_due('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')->>'status','recorded','AC-CD-003 overdue nightly dates are recorded');
create temporary table ncut as select public.plan_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx)) p;
reset role;
grant select on ncut to service_role;
select is((select p->>'reason' from ncut),'nightly','AC-CD-003 an unfinished nightly date runs a refresh even when no hint changed');
set local role service_role;
select public.complete_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx),(select (p->>'dirty_cut')::bigint from ncut),(select (p->>'intent_cut')::bigint from ncut),(select (p->>'nightly_cut')::date from ncut),'06550000-0000-0000-0000-000000000201');
reset role;
select is((select count(*)::int from public.erp_statement_nightly_obligation where org_id='06550000-0000-0000-0000-000000000001' and completed_at is null and due_at<=clock_timestamp()),0,'AC-CD-003 completion finishes the due nightly dates');
select ok((select dirty_acked=dirty_revision from public.erp_statement_change_state where org_id='06550000-0000-0000-0000-000000000001'),'AC-CD-003 a nightly publication clears the captured hint dirtiness');
set local role service_role;
select is(public.plan_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx))->>'mode','skip','AC-CD-001 after the nightly run nothing is due');

-- failure backoff 5 then 15 minutes, persisted
reset role;
update public.erp_statement_change_state set intent_revision=intent_revision+1 where org_id='06550000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.fail_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx))->>'retry_failures','1','AC-CD-002 first failure counted');
select is(public.plan_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx))->>'mode','wait','AC-CD-002 a failed run waits inside its backoff');
reset role;
select ok((select retry_at between clock_timestamp()+interval '4 minutes' and clock_timestamp()+interval '5 minutes 5 seconds' from public.erp_statement_change_state where org_id='06550000-0000-0000-0000-000000000001'),'AC-CD-002 first backoff is five minutes');
update public.erp_statement_change_state set retry_at=clock_timestamp() where org_id='06550000-0000-0000-0000-000000000001';
set local role service_role;
select public.fail_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx));
reset role;
select ok((select retry_at between clock_timestamp()+interval '14 minutes' and clock_timestamp()+interval '15 minutes 5 seconds' from public.erp_statement_change_state where org_id='06550000-0000-0000-0000-000000000001'),'AC-CD-002 second backoff is fifteen minutes');

-- fences: wrong holder / stale epoch / expired lease refuse every writer
set local role service_role;
select throws_ok($q$select public.plan_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-0000000009ff','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx))$q$,'55000',null,'AC-CD-002 plan refuses a stranger holder');
select throws_ok($q$select public.plan_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',gen_random_uuid())$q$,'55000',null,'AC-CD-002 plan refuses a stale scope epoch');
select throws_ok($q$select public.complete_erp_statement_pass('06550000-0000-0000-0000-000000000001','06550000-0000-0000-0000-000000000101','06550000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',(select epoch from fx),1,1,null,gen_random_uuid())$q$,'55000',null,'AC-CD-002 completion needs a published generation');

-- user Refresh now: real role, org-scoped, one accepted request per five minutes
reset role;
update public.erp_statement_change_state set last_manual_at=null where org_id='06550000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"06550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.request_financial_statement_refresh()->>'status','accepted','AC-CD-006 an active Admin queues a refresh');
select is(public.request_financial_statement_refresh()->>'status','coalesced','AC-CD-006 a repeated request inside five minutes coalesces');
set local request.jwt.claims='{"sub":"06550000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($q$select public.request_financial_statement_refresh()$q$,'42501',null,'AC-CD-006 an Engineer cannot request a company-wide refresh');
reset role;
select ok(not has_function_privilege('anon','public.request_financial_statement_refresh()','EXECUTE') and has_function_privilege('authenticated','public.request_financial_statement_refresh()','EXECUTE')
  and not has_function_privilege('authenticated','public.plan_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.complete_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid,bigint,bigint,date,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.fail_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.plan_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.request_erp_statement_refresh_after_post()','EXECUTE'),
  'AC-CD-006 only the user request is client-callable; the run-settling RPCs are service-only');
select * from finish();
rollback;
