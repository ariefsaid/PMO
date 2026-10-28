-- #1422 / FR-BUD-122: archiving and queuing ERPNext cancellation is atomic,
-- idempotent, actor-attributed, and preserves the existing four-role gate.
begin;
select plan(17);

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

select finish();
rollback;
