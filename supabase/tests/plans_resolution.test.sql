-- AC-PLN-001/002/004 [pgTAP]: the shared resolver applies global → override → plan, keeps core on,
-- scopes the authenticated wrappers, and separates revenue display from policy enforcement.
begin;
create extension if not exists pgtap;
select plan(60);

select ok(to_regprocedure('public.resolve_feature_internal(uuid,text)') is not null,
  'the shared resolver exists');

insert into organizations (id, name) values
  ('05320000-0000-0000-0000-000000000001', 'Plans Resolution A'),
  ('05320000-0000-0000-0000-000000000002', 'Plans Resolution B'),
  ('05320000-0000-0000-0000-000000000003', 'Plans Resolution C');
insert into auth.users (id, email) values
  ('05320000-0000-0000-0000-0000000000a1', 'plans-resolution-operator@example.invalid'),
  ('05320000-0000-0000-0000-0000000000a2', 'plans-resolution-disabled@example.invalid'),
  ('05320000-0000-0000-0000-0000000000a3', 'plans-resolution-member@example.invalid'),
  ('05320000-0000-0000-0000-0000000000a4', 'plans-resolution-finance@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('05320000-0000-0000-0000-0000000000a1', '05320000-0000-0000-0000-000000000001', 'Plan Fixture Operator', 'plans-resolution-operator@example.invalid', 'Admin', 'active'),
  ('05320000-0000-0000-0000-0000000000a2', '05320000-0000-0000-0000-000000000001', 'Plan Fixture Disabled Operator', 'plans-resolution-disabled@example.invalid', 'Admin', 'disabled'),
  ('05320000-0000-0000-0000-0000000000a3', '05320000-0000-0000-0000-000000000002', 'Plan Fixture Member', 'plans-resolution-member@example.invalid', 'Finance', 'active'),
  ('05320000-0000-0000-0000-0000000000a4', '05320000-0000-0000-0000-000000000003', 'Plan Fixture Finance', 'plans-resolution-finance@example.invalid', 'Finance', 'active');
insert into platform_operators (user_id) values
  ('05320000-0000-0000-0000-0000000000a1'),
  ('05320000-0000-0000-0000-0000000000a2');
insert into org_plans (org_id, plan_id) values
  ('05320000-0000-0000-0000-000000000002', 'starter');
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('05320000-0000-0000-0000-000000000003', 'erpnext', 'revenue');
insert into sales_invoices (tax_treatment, tax_amount, id, org_id, si_number, invoice_date, amount, status) values
  ('exclusive', 0, '05320000-0000-0000-0000-0000000000e1', '05320000-0000-0000-0000-000000000003', 'PLAN-ERP-REVENUE-1', '2026-11-01', 100, 'Submitted');

-- The plan catalogue stays private to the resolver; inspect its seeded feedback rows as the test owner.
select is((select count(*)::int from public.global_features where feature_key = 'feedback_surveys'),
  0, 'feedback_surveys has no global switch');
select is((select count(*)::int from public.plan_features where feature_key = 'feedback_surveys' and enabled),
  4, 'feedback_surveys plan rows stay on without controlling the Admin switch');

set local role authenticated;
set local request.jwt.claims = '{"sub":"05320000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.operator_toggle_feature('05320000-0000-0000-0000-000000000001', 'stock', true) $$,
  'AC-PLN-001 Operator can store an org stock override');
select lives_ok($$ select public.operator_set_global_feature('stock', false) $$,
  'AC-PLN-001 Operator can switch stock off globally');
select is((select enabled from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000001') where feature_key = 'stock'),
  false, 'AC-PLN-001 a global off beats an org override on');
select is((select source from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000001') where feature_key = 'stock'),
  'global', 'AC-PLN-001 global off is reported as the source');
select is(public.org_has_feature('05320000-0000-0000-0000-000000000001', 'stock'),
  false, 'AC-PLN-001 org_has_feature returns the display resolution');
select is(public.org_feature_enabled('05320000-0000-0000-0000-000000000001', 'stock'),
  false, 'AC-PLN-001 the policy wrapper returns the same entitlement');

select lives_ok($$ select public.operator_set_global_feature('stock', true) $$,
  'Operator can restore the all-org switch');
select is((select enabled from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000002') where feature_key = 'stock'),
  false, 'AC-PLN-002 Starter resolves stock off without an override');
select is((select source from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000002') where feature_key = 'stock'),
  'plan', 'AC-PLN-002 plan is reported as the source');
select lives_ok($$ select public.operator_toggle_feature('05320000-0000-0000-0000-000000000002', 'stock', true) $$,
  'Operator can override one org feature');
select is((select enabled from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000002') where feature_key = 'stock'),
  true, 'AC-PLN-002 an explicit org override beats the Starter value');
select is((select source from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000002') where feature_key = 'stock'),
  'override', 'AC-PLN-002 override is reported as the source');
select lives_ok($$ select public.operator_clear_feature_override('05320000-0000-0000-0000-000000000002', 'stock') $$,
  'Operator can clear an org override');
select is((select enabled from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000002') where feature_key = 'stock'),
  false, 'AC-PLN-002 clearing the override restores the Starter value');
select is((select source from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000002') where feature_key = 'stock'),
  'plan', 'AC-PLN-002 cleared override returns source to plan');
select is((select enabled from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000003') where feature_key = 'stock'),
  true, 'an org with no assignment resolves to Enterprise');
select is((select source from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000003') where feature_key = 'stock'),
  'plan', 'an unassigned org reports the Enterprise plan source');
select is((select count(*)::int from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000003')
            where feature_key in ('projects', 'dashboard', 'approvals', 'administration')
              and enabled and source = 'core'),
  4, 'all four established core keys resolve on with source core');
select is(public.org_has_feature('05320000-0000-0000-0000-000000000001', 'feedback_surveys'),
  true, 'feedback_surveys defaults on through its independent Admin path');
select lives_ok($$ select public.admin_set_feedback_surveys(false) $$,
  'an active org Admin still controls feedback_surveys');
select is(public.org_has_feature('05320000-0000-0000-0000-000000000001', 'feedback_surveys'),
  false, 'feedback_surveys follows its Admin-owned row independently of plan defaults');
select is((select enabled from public.resolved_org_features() where feature_key = 'stock'),
  true, 'AC-PLN-001 the own-org projection uses the shared resolver');
select is((select source from public.resolved_org_features() where feature_key = 'stock'),
  'override', 'the own-org projection reports the resolved source');
select is(public.org_has_feature('05320000-0000-0000-0000-000000000001', 'stock'),
  true, 'an active member can resolve their own org');
select throws_ok($$ select public.org_has_feature('05320000-0000-0000-0000-000000000002', 'stock') $$,
  '42501', 'org_mismatch', 'AC-PLN-001 org_has_feature refuses another org');
select is(public.org_feature_enabled('05320000-0000-0000-0000-000000000002', 'stock'),
  false, 'AC-PLN-001 the RLS-safe wrapper refuses another org without raising');

set local request.jwt.claims = '{"sub":"05320000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.org_has_feature('05320000-0000-0000-0000-000000000001', 'stock') $$,
  '42501', 'inactive', 'inactive members cannot read the display projection');
select is(public.org_feature_enabled('05320000-0000-0000-0000-000000000001', 'stock'),
  false, 'inactive members receive false from the RLS-safe wrapper');
select throws_ok($$ select * from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000002') $$,
  '42501', 'inactive', 'an inactive Operator cannot read another org projection');

set local request.jwt.claims = '{"sub":"05320000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select * from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000001') $$,
  '42501', 'operator_only', 'an active non-Operator cannot read another org projection');
select is((select enabled from public.resolved_org_features() where feature_key = 'stock'),
  false, 'an active member reads only the member org plan result');

set local request.jwt.claims = '{"sub":"05320000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(public.org_has_feature('05320000-0000-0000-0000-000000000003', 'revenue'),
  false, 'AC-PLN-016 ERP ownership hides revenue when no override exists');
select is(public.org_feature_enabled('05320000-0000-0000-0000-000000000003', 'revenue'),
  true, 'AC-PLN-016 ERP ownership does not disable revenue policy enforcement');
select is((select (public.set_sales_invoice_received_date('05320000-0000-0000-0000-0000000000e1', '2026-11-02')).received_date),
  '2026-11-02'::date, 'AC-PLN-016 ERP-owned revenue still accepts an authorized ERP invoice write');
set local request.jwt.claims = '{"sub":"05320000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.operator_toggle_feature('05320000-0000-0000-0000-000000000003', 'revenue', true) $$,
  'Operator can set an explicit revenue override');
select is((select display_enabled from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000003')
            where feature_key = 'revenue'),
  true, 'an explicit revenue override controls display despite ERP ownership');
select lives_ok($$ select public.operator_set_global_feature('revenue', false) $$,
  'Operator can disable revenue globally');
select is((select display_enabled from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000003')
            where feature_key = 'revenue'),
  false, 'a global revenue off still beats an explicit on override');
select is((select enabled from public.operator_resolved_org_features('05320000-0000-0000-0000-000000000003')
            where feature_key = 'revenue'),
  false, 'the policy resolution also follows global revenue off');

select throws_ok($$ select public.operator_toggle_feature('05320000-0000-0000-0000-000000000001', 'projects', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 project core cannot be overridden');
select throws_ok($$ select public.operator_toggle_feature('05320000-0000-0000-0000-000000000001', 'dashboard', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 dashboard core cannot be overridden');
select throws_ok($$ select public.operator_toggle_feature('05320000-0000-0000-0000-000000000001', 'approvals', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 approvals core cannot be overridden');
select throws_ok($$ select public.operator_toggle_feature('05320000-0000-0000-0000-000000000001', 'administration', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 administration core cannot be overridden');
select throws_ok($$ select public.operator_clear_feature_override('05320000-0000-0000-0000-000000000001', 'projects') $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 project core override cannot be cleared');
select throws_ok($$ select public.operator_clear_feature_override('05320000-0000-0000-0000-000000000001', 'dashboard') $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 dashboard core override cannot be cleared');
select throws_ok($$ select public.operator_clear_feature_override('05320000-0000-0000-0000-000000000001', 'approvals') $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 approvals core override cannot be cleared');
select throws_ok($$ select public.operator_clear_feature_override('05320000-0000-0000-0000-000000000001', 'administration') $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 administration core override cannot be cleared');
select throws_ok($$ select public.operator_clear_feature_override('05320000-0000-0000-0000-000000000001', 'feedback_surveys') $$,
  'P0001', 'admin_owned_feature', 'feedback_surveys override remains Admin-owned');
select throws_ok($$ select public.operator_set_global_feature('projects', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 project core global switch cannot be written');
select throws_ok($$ select public.operator_set_global_feature('dashboard', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 dashboard core global switch cannot be written');
select throws_ok($$ select public.operator_set_global_feature('approvals', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 approvals core global switch cannot be written');
select throws_ok($$ select public.operator_set_global_feature('administration', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 administration core global switch cannot be written');
select throws_ok($$ select public.operator_set_plan_feature('starter', 'projects', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 project core plan value cannot be written');
select throws_ok($$ select public.operator_set_plan_feature('starter', 'dashboard', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 dashboard core plan value cannot be written');
select throws_ok($$ select public.operator_set_plan_feature('starter', 'approvals', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 approvals core plan value cannot be written');
select throws_ok($$ select public.operator_set_plan_feature('starter', 'administration', false) $$,
  'P0001', 'core_not_gatable', 'AC-PLN-004 administration core plan value cannot be written');
select throws_ok($$ select public.operator_set_global_feature('not_a_feature', false) $$,
  'P0001', 'unknown_feature', 'unknown feature keys are rejected');

select * from finish();
rollback;
