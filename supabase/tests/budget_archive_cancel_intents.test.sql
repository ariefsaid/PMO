-- #1422 / FR-BUD-122: archiving and queuing ERPNext cancellation is atomic,
-- idempotent, actor-attributed, and preserves the existing four-role gate.
create extension if not exists dblink;
begin;
select plan(49);
select dblink_connect('archive_race', format('dbname=%s user=%s password=postgres host=%s port=%s', current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(),5432)));
select dblink_exec('archive_race', $q$
 insert into organizations(id,name) values ('04040000-0000-0000-0000-000000000001','Archive race');
 insert into auth.users(id) values ('04040000-0000-0000-0000-000000000002');
 insert into profiles(id,org_id,full_name,email,role,status) values ('04040000-0000-0000-0000-000000000002','04040000-0000-0000-0000-000000000001','Race actor','archive-race@example.invalid','Finance','active');
 insert into projects(id,org_id,name,status) values ('04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000001','Race project','Ongoing Project');
 insert into budget_versions(id,org_id,project_id,version,name,status,activated_at) values ('04040000-0000-0000-0000-000000000004','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000003',1,'Race budget','Archived','2026-10-28T00:00:00Z');
 insert into budget_version_account_erp_mirror(id,org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness,erp_budget_name,erp_docstatus) values ('04040000-0000-0000-0000-000000000005','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000004','2026','Labor','remove','pending','2026-10-28T00:00:00Z','BUD-RACE',1);
 insert into budget_archive_requests(id,org_id,project_id,budget_version_id,requested_by,cancel_erp) values ('04040000-0000-0000-0000-000000000006','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000004','04040000-0000-0000-0000-000000000002',true);
 insert into budget_archive_cancel_intents(id,org_id,request_id,project_id,budget_version_id,source_mirror_id,actor_user_id,fiscal_year,erp_account,erp_budget_name,activated_at_witness) values ('04040000-0000-0000-0000-000000000007','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000006','04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000004','04040000-0000-0000-0000-000000000005','04040000-0000-0000-0000-000000000002','2026','Labor','BUD-RACE','2026-10-28T00:00:00Z');
$q$);

select dblink_exec('archive_race','begin');
select is((select result from dblink('archive_race', $$select public.transition_budget_archive_cancel_intent('04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000007','retry','retry')$$) as t(result text)), 'applied', 'first retry takes the intent lock');
set local lock_timeout='500ms';
select throws_ok($$select public.transition_budget_archive_cancel_intent('04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000007','retry','retry')$$,'55P03',null,'concurrent retry waits on the intent');
select dblink_exec('archive_race','commit');
select is(public.transition_budget_archive_cancel_intent('04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000007','retry','retry'), 'applied', 'retry converges after the lock releases');
select is((select count(*)::int from error_events where org_id='04040000-0000-0000-0000-000000000001' and error_code='budget-archive-cancel-retry'), 1, 'serialized retries emit one event');
set local lock_timeout='0';

insert into organizations (id, name) values
  ('03870000-0000-0000-0000-000000000001', 'Archive Intent Org');
insert into auth.users (id, email) values
  ('03870000-0000-0000-0000-0000000000a1', 'archive-finance@example.invalid'),
  ('03870000-0000-0000-0000-0000000000a2', 'archive-engineer@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03870000-0000-0000-0000-0000000000a1', '03870000-0000-0000-0000-000000000001', 'Archive Finance', 'archive-finance@example.invalid', 'Finance', 'active'),
  ('03870000-0000-0000-0000-0000000000a2', '03870000-0000-0000-0000-000000000001', 'Archive Engineer', 'archive-engineer@example.invalid', 'Engineer', 'active');
insert into projects (id, org_id, name, status) values
  ('03870000-0000-0000-0000-0000000000c1', '03870000-0000-0000-0000-000000000001', 'Cancel Project', 'Ongoing Project'),
  ('03870000-0000-0000-0000-0000000000c2', '03870000-0000-0000-0000-000000000001', 'Keep Project', 'Ongoing Project'),
  ('03870000-0000-0000-0000-0000000000c3', '03870000-0000-0000-0000-000000000001', 'Denied Project', 'Ongoing Project');
insert into budget_versions (id, org_id, project_id, version, name, status, activated_at) values
  ('03870000-0000-0000-0000-0000000000d1', '03870000-0000-0000-0000-000000000001', '03870000-0000-0000-0000-0000000000c1', 1, 'Cancel Budget', 'Active', '2026-10-28T00:00:00Z'),
  ('03870000-0000-0000-0000-0000000000d2', '03870000-0000-0000-0000-000000000001', '03870000-0000-0000-0000-0000000000c2', 1, 'Keep Budget', 'Active', '2026-10-28T00:00:00Z'),
  ('03870000-0000-0000-0000-0000000000d3', '03870000-0000-0000-0000-000000000001', '03870000-0000-0000-0000-0000000000c3', 1, 'Denied Budget', 'Active', '2026-10-28T00:00:00Z');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, version_major, activated_at)
values ('03870000-0000-0000-0000-000000000001', 'erpnext', 'https://erp.example.invalid', 'fixture', 16, now());
insert into budget_version_account_erp_mirror
  (org_id, budget_version_id, fiscal_year, erp_account, budget_intent, push_state, activated_at_witness,
   erp_budget_name, erp_docstatus, pushed_project_start_date, pushed_project_end_date)
values
  -- A failed retry can leave the previous successful ERP document live; its known document name still needs cancellation.
  ('03870000-0000-0000-0000-000000000001', '03870000-0000-0000-0000-0000000000d1', '2026', '5100 - Labor - AC', 'ensure', 'failed', '2026-10-28T00:00:00Z', 'BUD-ARCHIVE-1', 1, '2026-01-01', '2026-12-31'),
  ('03870000-0000-0000-0000-000000000001', '03870000-0000-0000-0000-0000000000d2', '2026', '5100 - Labor - AC', 'ensure', 'pushed', '2026-10-28T00:00:00Z', 'BUD-ARCHIVE-2', 1, '2026-01-01', '2026-12-31');

select ok(not has_column_privilege('authenticated', 'public.budget_versions', 'status', 'UPDATE'),
  'AC-BUD-122: authenticated status updates cannot bypass the durable archive RPC');
select ok(has_function_privilege('authenticated', 'public.archive_budget_version_with_cancel_intent(uuid,boolean,uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.archive_budget_version_with_cancel_intent(uuid,boolean,uuid)', 'EXECUTE'),
  'AC-BUD-122: only authenticated callers can execute the archive RPC');
select ok(not has_table_privilege('authenticated', 'public.budget_archive_cancel_intents', 'SELECT')
          and not has_table_privilege('authenticated', 'public.budget_archive_cancel_intents', 'INSERT'),
  'AC-BUD-122: cancellation intents are service-role owned');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.archive_budget_version_with_cancel_intent('03870000-0000-0000-0000-0000000000d1', true, '03870000-0000-0000-0000-0000000000e1')->>'live_target_count', '1',
  'AC-BUD-122: Finance archives and queues the one live v16 ERP Budget');
reset role;

select is((select status::text from budget_versions where id='03870000-0000-0000-0000-0000000000d1'), 'Archived',
  'AC-BUD-122: the budget is archived in the same transaction as its cancellation intent');
select is((select count(*)::int from budget_archive_cancel_intents where budget_version_id='03870000-0000-0000-0000-0000000000d1' and state='pending'), 1,
  'AC-BUD-122: a pending intent survives independently of the browser request');
select is((select actor_user_id from budget_archive_cancel_intents where budget_version_id='03870000-0000-0000-0000-0000000000d1'), '03870000-0000-0000-0000-0000000000a1'::uuid,
  'AC-BUD-122: sweep recovery retains the verified initiating actor');
select is((select budget_intent from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'remove',
  'AC-BUD-122: the mirror records the persisted cancellation decision');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.archive_budget_version_with_cancel_intent('03870000-0000-0000-0000-0000000000d1', false)->>'cancel_erp'), 'true',
  'AC-BUD-122: repeating archive returns the stored operator decision without changing it');
reset role;

-- The archive remains fenced until every exact-target cancellation has settled.
select throws_ok($$ update budget_versions set status='Active'
 where id='03870000-0000-0000-0000-0000000000d1' $$,
 'P0001', 'budget archive cancellation is unresolved; complete cancellation before reactivating',
 'AC-BUD-122: reactivation cannot cross an unresolved cancellation');
select throws_ok($$ update budget_versions set activated_at='2026-10-29T00:00:00Z'
 where id='03870000-0000-0000-0000-0000000000d1' $$,
 'P0001', 'budget archive cancellation is unresolved; complete cancellation before reactivating',
 'AC-BUD-122: the activation witness is fenced while cancellation is unresolved');
update budget_archive_cancel_intents set state='held'
 where budget_version_id='03870000-0000-0000-0000-0000000000d1';
select throws_ok($$ update budget_versions set status='Draft'
 where id='03870000-0000-0000-0000-0000000000d1' $$,
 'P0001', 'budget archive cancellation is unresolved; complete cancellation before reactivating',
 'AC-BUD-122: a held intent cannot be bypassed by returning to Draft');
update budget_archive_cancel_intents set state='superseded'
 where budget_version_id='03870000-0000-0000-0000-0000000000d1';
select throws_ok($$ update budget_versions set status='Active'
 where id='03870000-0000-0000-0000-0000000000d1' $$,
 'P0001', 'budget archive cancellation is unresolved; complete cancellation before reactivating',
 'AC-BUD-122: superseding an intent does not release an issued cancellation');
select lives_ok($$ update budget_versions set name='Renamed archived budget'
 where id='03870000-0000-0000-0000-0000000000d1' $$,
 'AC-BUD-122: unrelated archived metadata remains editable');
update budget_archive_cancel_intents set state='complete'
 where budget_version_id='03870000-0000-0000-0000-0000000000d1';

update budget_versions set status='Active', activated_at='2026-10-29T00:00:00Z'
 where id='03870000-0000-0000-0000-0000000000d1';
update budget_version_account_erp_mirror
   set budget_intent='ensure', push_state='pushed', activated_at_witness='2026-10-29T00:00:00Z',
       erp_budget_name='BUD-ARCHIVE-REACTIVATED', erp_cancelled_at=null, erp_docstatus=1
 where budget_version_id='03870000-0000-0000-0000-0000000000d1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.archive_budget_version_with_cancel_intent('03870000-0000-0000-0000-0000000000d1', true, '03870000-0000-0000-0000-0000000000e2')->>'live_target_count', '1',
  'AC-BUD-122: a reactivated version can be archived with a distinct request id');
reset role;
select is((select count(*)::int from budget_archive_requests where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 2,
  'AC-BUD-122: each activation cycle retains its own archive decision');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03870000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.archive_budget_version_with_cancel_intent('03870000-0000-0000-0000-0000000000d3', true) $$,
  '42501', 'not authorized to archive this budget version',
  'AC-BUD-122: a role outside the shipped four-role budget write gate is refused');
reset role;

-- The sweep transition and its durable signal share one database transaction.
set local role service_role;
select lives_ok($$ select public.transition_budget_archive_cancel_intent(
  '03870000-0000-0000-0000-000000000001',
  (select id from public.budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'),
  'held', 'operator review') $$, 'archive hold transition succeeds');
reset role;
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'hold persists the intent');
select is((select push_state from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'held', 'hold persists the matching mirror');
select is((select count(*)::int from error_events where fn='erpnext-sweep' and error_code='budget-archive-cancel-held' and org_id='03870000-0000-0000-0000-000000000001'), 1, 'hold records an independently drainable action event');
select lives_ok($$ select public.transition_budget_archive_cancel_intent(
  '03870000-0000-0000-0000-000000000001',
  (select id from public.budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'),
  'held', 'operator review') $$, 'repeating the hold is idempotent');
select is((select count(*)::int from error_events where fn='erpnext-sweep' and error_code='budget-archive-cancel-held' and org_id='03870000-0000-0000-0000-000000000001'), 1, 'repeated transition does not duplicate the durable signal');
select ok(not has_function_privilege('authenticated', 'public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)', 'EXECUTE') and has_function_privilege('service_role', 'public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)', 'EXECUTE'), 'transition is service only');
set local role authenticated;
select throws_ok($$select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001','03870000-0000-0000-0000-0000000000e2','held','review')$$, '42501', null, 'authenticated role cannot execute the service transaction');
reset role;
update budget_archive_cancel_intents set state='pending' where request_id='03870000-0000-0000-0000-0000000000e2';
update budget_version_account_erp_mirror set push_state='pending' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
delete from error_events where fn='erpnext-sweep' and error_code='budget-archive-cancel-held';
select throws_ok($$ select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000099', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review') $$, 'P0001', null, 'another org cannot transition the intent');
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'pending', 'cross-org attempt leaves the intent pending');
update budget_version_account_erp_mirror set erp_budget_name='different' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
select is(public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review'), 'stale', 'a changed mirror witness refuses the transition');
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'pending', 'changed witness leaves intent retryable');
select is((select count(*)::int from error_events where error_code='budget-archive-cancel-stale' and org_id='03870000-0000-0000-0000-000000000001'), 1, 'stale witness records an independently actionable event');
update budget_version_account_erp_mirror set erp_budget_name='BUD-ARCHIVE-REACTIVATED' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
create function pg_temp.fail_archive_transition() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
create trigger test_archive_event_failure before insert on error_events for each row execute function pg_temp.fail_archive_transition();
select throws_ok($$ select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review') $$, 'P0001', 'injected failure', 'event insertion failure aborts the transaction');
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'pending', 'event failure rolls back intent');
select is((select push_state from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'pending', 'event failure rolls back mirror');
drop trigger test_archive_event_failure on error_events;
select lives_ok($$ select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review') $$, 'retry after event failure converges');
update budget_archive_cancel_intents set state='pending' where request_id='03870000-0000-0000-0000-0000000000e2';
update budget_version_account_erp_mirror set push_state='pending' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
create trigger test_archive_mirror_failure before update on budget_version_account_erp_mirror for each row execute function pg_temp.fail_archive_transition();
select throws_ok($$ select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review') $$, 'P0001', 'injected failure', 'mirror failure aborts the transition');
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'pending', 'mirror failure rolls back intent');
drop trigger test_archive_mirror_failure on budget_version_account_erp_mirror;
create trigger test_archive_intent_failure before update on budget_archive_cancel_intents for each row execute function pg_temp.fail_archive_transition();
select throws_ok($$ select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review') $$, 'P0001', 'injected failure', 'intent failure aborts the transition');
select is((select push_state from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'pending', 'intent failure leaves mirror unchanged');
drop trigger test_archive_intent_failure on budget_archive_cancel_intents;
select is(public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'retry', 'retry later'), 'applied', 'retry persists atomically');
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'pending', 'retry retains pending intent');
select is((select push_state from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'failed', 'retry persists the mirror failure');
select is((select count(*)::int from error_events where error_code='budget-archive-cancel-retry' and org_id='03870000-0000-0000-0000-000000000001'), 1, 'retry records the durable signal');
update budget_version_account_erp_mirror set push_state='held' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
select is(public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'retry', 'retry'), 'stale', 'retry cannot overwrite an independently held mirror');
select is((select push_state from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'held', 'independent hold is preserved');
update budget_version_account_erp_mirror set push_state='failed' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
select is(public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'superseded', null), 'applied', 'supersession persists atomically');
select finish();
rollback;
select dblink_exec('archive_race', $$delete from error_events where org_id='04040000-0000-0000-0000-000000000001'; delete from projects where org_id='04040000-0000-0000-0000-000000000001'; delete from profiles where org_id='04040000-0000-0000-0000-000000000001'; delete from organizations where id='04040000-0000-0000-0000-000000000001'; delete from auth.users where id='04040000-0000-0000-0000-000000000002'$$);
select dblink_disconnect('archive_race');
