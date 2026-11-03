-- AC-PLN-005 / FR-PLN-006 / FR-PLN-007 / FR-PLN-005a [pgTAP]: S2 server enforcement.
--
-- While a key resolves off for an org, that module's table writes, its write RPCs and its outbox enqueues
-- refuse with the typed `feature_off` error (P0001); reads stay open; data written while the module was on
-- stays readable and editable again after the switch is switched back on. Enforcement reads ENTITLEMENT
-- (resolve_feature_internal → enabled) and never the revenue display rule, so an ERP-owned org keeps its
-- revenue write path even while its revenue screens are hidden. Service-role maintenance paths (outbox
-- claim/confirm/release, the sweep's entitlement reads) stay callable while a module is off.
--
-- Fixtures: org A on Starter (revenue/stock/imprest/management_pack/multi_currency/budget_projection/
-- sales_pipeline/m365_integration off by plan; import_export overridden off), org C on Enterprise with
-- overrides off for sales_invoices, timesheets, procurement and agent_assistant, and org D on Enterprise
-- whose revenue is ERP-owned (display off, entitlement on).
begin;
create extension if not exists pgtap;
select plan(53);

insert into organizations (id, name) values
  ('05340000-0000-0000-0000-000000000001', 'Plans Enforcement A'),
  ('05340000-0000-0000-0000-000000000002', 'Plans Enforcement B'),
  ('05340000-0000-0000-0000-000000000003', 'Plans Enforcement C'),
  ('05340000-0000-0000-0000-000000000004', 'Plans Enforcement D');
insert into auth.users (id, email) values
  ('05340000-0000-0000-0000-0000000000a1', 'plans-enforcement-a@example.invalid'),
  ('05340000-0000-0000-0000-0000000000a2', 'plans-enforcement-c@example.invalid'),
  ('05340000-0000-0000-0000-0000000000a3', 'plans-enforcement-d@example.invalid'),
  ('05340000-0000-0000-0000-0000000000a4', 'plans-enforcement-operator@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('05340000-0000-0000-0000-0000000000a1', '05340000-0000-0000-0000-000000000001', 'Enforcement A Admin', 'plans-enforcement-a@example.invalid', 'Admin', 'active'),
  ('05340000-0000-0000-0000-0000000000a2', '05340000-0000-0000-0000-000000000003', 'Enforcement C Admin', 'plans-enforcement-c@example.invalid', 'Admin', 'active'),
  ('05340000-0000-0000-0000-0000000000a3', '05340000-0000-0000-0000-000000000004', 'Enforcement D Admin', 'plans-enforcement-d@example.invalid', 'Admin', 'active'),
  ('05340000-0000-0000-0000-0000000000a4', '05340000-0000-0000-0000-000000000002', 'Enforcement Operator', 'plans-enforcement-operator@example.invalid', 'Admin', 'active');
insert into platform_operators (user_id) values ('05340000-0000-0000-0000-0000000000a4');
insert into org_plans (org_id, plan_id) values ('05340000-0000-0000-0000-000000000001', 'starter');
insert into org_features (org_id, feature_key, enabled) values
  ('05340000-0000-0000-0000-000000000001', 'import_export', false),
  ('05340000-0000-0000-0000-000000000003', 'sales_invoices', false),
  ('05340000-0000-0000-0000-000000000003', 'timesheets', false),
  ('05340000-0000-0000-0000-000000000003', 'procurement', false),
  ('05340000-0000-0000-0000-000000000003', 'agent_assistant', false);
insert into external_domain_ownership (org_id, external_tier, domain)
  values ('05340000-0000-0000-0000-000000000004', 'erpnext', 'revenue');
insert into projects (id, org_id, name) values
  ('05340000-0000-0000-0000-0000000000b1', '05340000-0000-0000-0000-000000000001', 'Enforcement project A'),
  ('05340000-0000-0000-0000-0000000000b3', '05340000-0000-0000-0000-000000000003', 'Enforcement project C'),
  ('05340000-0000-0000-0000-0000000000b4', '05340000-0000-0000-0000-000000000004', 'Enforcement project D');
-- FR-PLN-007: a float recorded while imprest was on (inserted as the test owner, before the switch is off).
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by)
  values ('05340000-0000-0000-0000-0000000000f1', '05340000-0000-0000-0000-000000000001',
          '05340000-0000-0000-0000-0000000000b1', '05340000-0000-0000-0000-0000000000a1', 500, 'USD',
          '05340000-0000-0000-0000-0000000000a1');
-- An existing receipt in the ERP-owned org D: revenue display is hidden by ownership, but the
-- ENTITLEMENT is on, so an otherwise-authorized write must still pass (FR-PLN-005a).
insert into incoming_payments (id, org_id, reference_number, status)
  values ('05340000-0000-0000-0000-0000000000e5', '05340000-0000-0000-0000-000000000004', 'SEED-1', 'Scheduled');
-- The switch is off for A by plan; make it explicit for the fixtures that assert the write refusal.
insert into org_features (org_id, feature_key, enabled)
  values ('05340000-0000-0000-0000-000000000001', 'imprest', false)
  on conflict (org_id, feature_key) do update set enabled = excluded.enabled;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Structural: the gate helpers and the RLS wiring.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
select has_function('public', 'assert_feature_on', 'assert_feature_on(uuid,text) exists');
select has_function('public', 'service_feature_enabled', 'service_feature_enabled(uuid,text) exists');
select lives_ok($$ select public.assert_feature_on('05340000-0000-0000-0000-000000000002', 'imprest') $$,
  'the raising gate returns cleanly for an entitled org');
select throws_ok($$ select public.assert_feature_on('05340000-0000-0000-0000-000000000001', 'imprest') $$,
  'P0001', 'feature_off', 'AC-PLN-005 the raising gate refuses a plan-level off key');
select throws_ok($$ select public.assert_feature_on('05340000-0000-0000-0000-000000000001', 'no_such_key') $$,
  'P0001', 'feature_off', 'an unknown key fails closed');
select throws_ok($$ select public.assert_feature_on(null, 'imprest') $$,
  'P0001', 'feature_off', 'an unresolved org fails closed');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'imprest_floats'
              and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and coalesce(with_check, qual) like '%org_feature_enabled%'), 0,
  'imprest_floats is RPC-write-only (no client write policy) — its refusal is the §C RPC gate');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'incoming_payments'
              and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and coalesce(with_check, qual) like '%org_feature_enabled%'), 3,
  'every incoming_payments write policy carries the entitlement conjunct');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'incoming_payments' and cmd = 'SELECT'
              and coalesce(qual, '') like '%org_feature_enabled%'), 0,
  'incoming_payments SELECT is NOT gated (reads stay open)');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'stock_documents'
              and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and coalesce(with_check, qual) like '%org_feature_enabled%'), 0,
  'stock_documents is RPC-write-only (no client write policy) — its refusal is the §C RPC gate');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'budget_projections'
              and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and coalesce(with_check, qual) like '%org_feature_enabled%'), 1,
  'budget_projections write policy carries the entitlement conjunct');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'project_progress_entries'
              and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and coalesce(with_check, qual) like '%org_feature_enabled%'), 2,
  'project_progress_entries write policies carry the entitlement conjunct');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'fx_rates'
              and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and coalesce(with_check, qual) like '%org_feature_enabled%'), 2,
  'fx_rates write policies carry the entitlement conjunct');
-- Director ruling (#1720): goods receipts stay on `procurement`, never `procurement_full`, in this slice.
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename in ('procurement_receipts','procurement_receipt_files')
              and coalesce(with_check, qual) like '%procurement_full%'), 0,
  'receipts are NOT re-bound to procurement_full (move deferred pending owner sign-off)');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename in ('procurement_receipts','procurement_receipt_files')
              and coalesce(with_check, qual) like '%''procurement''%'), 4,
  'receipts stay gated on procurement exactly as today');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- AC-PLN-005 — imprest off refuses the RPC; data stays readable; re-enabling restores writes.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"05340000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.establish_imprest_float('05340000-0000-0000-0000-0000000000b1',
       '05340000-0000-0000-0000-0000000000a1', 100) $$,
  'P0001', 'feature_off', 'AC-PLN-005 imprest off ⇒ establish_imprest_float refuses with feature_off');
select throws_ok($$ select public.set_imprest_procurement_limit(1000) $$,
  'P0001', 'feature_off', 'AC-PLN-005 imprest off ⇒ set_imprest_procurement_limit refuses');
select is((select count(*)::int from public.imprest_floats
            where org_id = '05340000-0000-0000-0000-000000000001'), 1,
  'FR-PLN-007 imprest off ⇒ the float recorded while it was on stays readable');

-- Re-enable as the platform Operator, then the same write succeeds.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"05340000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select public.operator_toggle_feature('05340000-0000-0000-0000-000000000001', 'imprest', true) $$,
  'the Operator can switch imprest back on');
set local request.jwt.claims = '{"sub":"05340000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.set_imprest_procurement_limit(2500) $$,
  'FR-PLN-007 imprest on again ⇒ the previously refused write succeeds');
select is((select count(*)::int from public.imprest_floats
            where org_id = '05340000-0000-0000-0000-000000000001'), 1,
  'FR-PLN-007 the existing float is still there after the round trip');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- FR-PLN-006 — refusal matrix, one named assertion per gated module family (org A on Starter).
-- ══════════════════════════════════════════════════════════════════════════════════════════════
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"05340000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select public.operator_toggle_feature('05340000-0000-0000-0000-000000000001', 'imprest', false) $$,
  'the Operator can switch imprest back off after the round-trip proof');
set local request.jwt.claims = '{"sub":"05340000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.cancel_native_receipt('05340000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'feature_off', 'FR-PLN-006 revenue off ⇒ cancel_native_receipt refuses');
select throws_ok($$ select public.record_native_receipt('05340000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'feature_off', 'FR-PLN-006 revenue off ⇒ record_native_receipt refuses');
select throws_ok($$ select public.create_stock_document('{}'::jsonb, '[]'::jsonb) $$,
  'P0001', 'feature_off', 'FR-PLN-006 stock off ⇒ create_stock_document refuses');
select throws_ok($$ select public.set_stock_reorder_level(
    '05340000-0000-0000-0000-0000000000c1', '05340000-0000-0000-0000-0000000000c2', 10) $$,
  'P0001', 'feature_off', 'FR-PLN-006 stock off ⇒ set_stock_reorder_level refuses');
select throws_ok($$ select public.record_project_progress(
    '05340000-0000-0000-0000-0000000000b1', current_date, 25) $$,
  'P0001', 'feature_off', 'FR-PLN-006 management_pack off ⇒ record_project_progress refuses');
select throws_ok($$ select public.import_budget_line_v2(
    '05340000-0000-0000-0000-0000000000d1', 'Labor', 'desc', 10, '2026',
    '05340000-0000-0000-0000-0000000000d2', now(), 'k1', 'k1', false) $$,
  'P0001', 'feature_off', 'FR-PLN-006 import_export off ⇒ import_budget_line_v2 refuses');
select throws_ok($$ select public.m365_link_record_folder(
    'project', '05340000-0000-0000-0000-0000000000b1',
    '{"drive_id":"d","item_id":"i","item_kind":"folder","name":"n","web_url":"https://x.invalid/f"}'::jsonb,
    null, null, null) $$,
  'P0001', 'feature_off', 'FR-PLN-006 m365_integration off ⇒ m365_link_record_folder refuses');
select throws_ok($$ select public.transition_project('05340000-0000-0000-0000-0000000000b1', 'Leads') $$,
  'P0001', 'feature_off', 'FR-PLN-006 sales_pipeline off ⇒ a pipeline-stage transition refuses');

-- Direct client writes are refused by the RLS conjunct (an otherwise-authorized Admin).
select throws_ok($$ insert into public.budget_projections (org_id, project_id, fiscal_year, category)
    values ('05340000-0000-0000-0000-000000000001', '05340000-0000-0000-0000-0000000000b1', '2026', 'Labor') $$,
  '42501', null, 'FR-PLN-006 budget_projection off ⇒ budget_projections INSERT is denied by policy');
select throws_ok($$ insert into public.fx_rates (org_id, rate_date, rate)
    values ('05340000-0000-0000-0000-000000000001', '2026-11-03', 15000) $$,
  '42501', null, 'FR-PLN-006 multi_currency off ⇒ fx_rates INSERT is denied by policy');
select throws_ok($$ insert into public.project_progress_entries (org_id, project_id, month, pct_complete)
    values ('05340000-0000-0000-0000-000000000001', '05340000-0000-0000-0000-0000000000b1', '2026-11-01', 20) $$,
  '42501', null, 'FR-PLN-006 management_pack off ⇒ project_progress_entries INSERT is denied by policy');
select throws_ok($$ insert into public.incoming_payments (org_id, reference_number)
    values ('05340000-0000-0000-0000-000000000001', 'PLN-1') $$,
  '42501', null, 'FR-PLN-006 revenue off ⇒ incoming_payments INSERT is denied by the entitlement conjunct');
select throws_ok($$ insert into public.imprest_floats (org_id, project_id, custodian_id, currency, created_by)
    values ('05340000-0000-0000-0000-000000000001', '05340000-0000-0000-0000-0000000000b1',
            '05340000-0000-0000-0000-0000000000a1', 'USD', '05340000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'FR-PLN-006 imprest off (again) ⇒ imprest_floats INSERT is denied by policy');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- org C: override-level off, including the receipts boundary and the revenue/sales_invoices split.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"05340000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.transition_timesheet('05340000-0000-0000-0000-0000000000e2', 'Submitted') $$,
  'P0001', 'feature_off', 'FR-PLN-006 timesheets override off ⇒ transition_timesheet refuses');
select throws_ok($$ select public.create_native_sales_invoice(
    '05340000-0000-0000-0000-0000000000b3', '05340000-0000-0000-0000-0000000000b3', '[]'::jsonb) $$,
  'P0001', 'feature_off', 'FR-PLN-006 sales_invoices override off ⇒ create_native_sales_invoice refuses');
select throws_ok($$ select public.assemble_tm_claim('05340000-0000-0000-0000-0000000000b3',
    current_date, current_date) $$,
  'P0001', 'feature_off', 'FR-PLN-006 sales_invoices override off ⇒ assemble_tm_claim refuses');
select throws_ok($$ select public.create_procurement_receipt(
    '05340000-0000-0000-0000-0000000000e3', 'Partial', current_date) $$,
  'P0001', 'feature_off', 'FR-PLN-006 procurement override off ⇒ create_procurement_receipt refuses');
-- OQ-2: a receipt gates on `revenue` alone; it is NOT coupled to `sales_invoices`.
select throws_ok($$ select public.record_native_receipt('05340000-0000-0000-0000-0000000000e1') $$,
  'P0002', 'sales invoice not found',
  'OQ-2 sales_invoices off does not block the revenue receipt path (fails later, not feature_off)');

reset role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- FR-PLN-005a — an ERP-owned revenue org is display-off but entitlement-on.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"05340000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(public.org_has_feature('05340000-0000-0000-0000-000000000004', 'revenue'), false,
  'FR-PLN-005a an ERP-owned revenue org still hides the revenue screens (display rule)');
select is(public.org_feature_enabled('05340000-0000-0000-0000-000000000004', 'revenue'), true,
  'FR-PLN-005a the enforcement projection ignores the display rule');
select throws_ok($$ select public.record_native_receipt('05340000-0000-0000-0000-0000000000e1') $$,
  'P0002', 'sales invoice not found',
  'FR-PLN-005a the revenue RPC gate uses entitlement, not the display rule (fails later, not feature_off)');
select throws_ok($$ select public.create_native_sales_invoice(
    '05340000-0000-0000-0000-0000000000b4', '05340000-0000-0000-0000-0000000000b4', '[]'::jsonb) $$,
  '42501', null, 'FR-PLN-005a the ERP-owned org still refuses PMO-native invoicing (the ownership rule, not the switch)');

reset role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Jobs and edges — service reads, outbox enqueues, and the must-not-block terminal paths.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.service_feature_enabled('05340000-0000-0000-0000-000000000001', 'imprest'), false,
  'service_feature_enabled reports the off key to a sweep (fail-closed, no raise)');
select is(public.service_feature_enabled('05340000-0000-0000-0000-000000000002', 'imprest'), true,
  'service_feature_enabled reports the on key');
select is(public.service_feature_enabled('05340000-0000-0000-0000-0000000000ff', 'imprest'), false,
  'service_feature_enabled fails closed for an unknown org');
-- A command already minted must still reach a terminal state (0096's held/double-pay machinery).
select lives_ok($$ select * from public.claim_outbox_for_commit('05340000-0000-0000-0000-0000000000e4') $$,
  'the outbox claim path stays callable while a module is off (no strand mid-flight)');
select lives_ok($$ select public.confirm_outbox('05340000-0000-0000-0000-0000000000e4', 0) $$,
  'the outbox confirm path stays callable while a module is off');
select lives_ok($$ select public.release_outbox_hold('05340000-0000-0000-0000-0000000000e4', 'probe') $$,
  'the outbox hold-release path stays callable while a module is off');
reset role;

-- The enqueue definers refuse new commands for an off key (called here as the test owner, as a
-- service path would, so the entitlement check — not RLS — is what refuses).
select throws_ok($$ select public.insert_procurement_outbox_pending(
    '05340000-0000-0000-0000-000000000003', 'r1', 'k1', 'erpnext', 'create', '{}'::jsonb, 'd',
    '05340000-0000-0000-0000-0000000000a2', '05340000-0000-0000-0000-0000000000e3', '[]'::jsonb) $$,
  'P0001', 'feature_off', 'a feature-off org never mints a new procurement command');
select throws_ok($$ select public.insert_timesheet_outbox_pending(
    '05340000-0000-0000-0000-000000000003', 'timesheets', '05340000-0000-0000-0000-0000000000e2',
    'k1', 'erpnext', 'create', '{}'::jsonb, 'd', '05340000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'feature_off', 'a feature-off org never mints a new timesheet command');

-- service_feature_enabled is service-only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"05340000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.service_feature_enabled('05340000-0000-0000-0000-000000000001', 'imprest') $$,
  '42501', 'service_role_only', 'a client cannot call the service entitlement twin');
reset role;

select * from finish();
rollback;
