-- S03 canonical project budget positions: exact, set-based actual + open-commitment facts.
begin;
create extension if not exists pgtap;
select plan(38);

insert into public.organizations (id, name, default_currency, default_timezone) values
  ('a0300000-0000-0000-0000-000000000001', 'S03 PMO', 'USD', 'UTC'),
  ('a0300000-0000-0000-0000-000000000002', 'S03 ERP', 'USD', 'UTC'),
  ('a0300000-0000-0000-0000-000000000003', 'S03 Other', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('a0300000-0000-0000-0000-0000000000a1', 's03-finance@example.test'),
  ('a0300000-0000-0000-0000-0000000000a2', 's03-engineer@example.test'),
  ('a0300000-0000-0000-0000-0000000000a3', 's03-erp-finance@example.test'),
  ('a0300000-0000-0000-0000-0000000000a4', 's03-other-finance@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('a0300000-0000-0000-0000-0000000000a1', 'a0300000-0000-0000-0000-000000000001', 'S03 Finance', 's03-finance@example.test', 'Finance', 'active'),
  ('a0300000-0000-0000-0000-0000000000a2', 'a0300000-0000-0000-0000-000000000001', 'S03 Engineer', 's03-engineer@example.test', 'Engineer', 'active'),
  ('a0300000-0000-0000-0000-0000000000a3', 'a0300000-0000-0000-0000-000000000002', 'S03 ERP Finance', 's03-erp-finance@example.test', 'Finance', 'active'),
  ('a0300000-0000-0000-0000-0000000000a4', 'a0300000-0000-0000-0000-000000000003', 'S03 Other Finance', 's03-other-finance@example.test', 'Finance', 'active');

insert into public.projects (id, org_id, name, status, currency) values
  ('a0300000-0000-0000-0000-0000000000d1', 'a0300000-0000-0000-0000-000000000001', 'S03 half paid', 'Ongoing Project', 'USD'),
  ('a0300000-0000-0000-0000-0000000000d2', 'a0300000-0000-0000-0000-000000000001', 'S03 hire and cancelled payment', 'Ongoing Project', 'USD'),
  ('a0300000-0000-0000-0000-0000000000d3', 'a0300000-0000-0000-0000-000000000001', 'S03 currency mismatch', 'Ongoing Project', 'USD'),
  ('a0300000-0000-0000-0000-0000000000d4', 'a0300000-0000-0000-0000-000000000001', 'S03 missing Active', 'Ongoing Project', 'USD'),
  ('a0300000-0000-0000-0000-0000000000d5', 'a0300000-0000-0000-0000-000000000002', 'S03 ERP actual', 'Ongoing Project', 'USD'),
  ('a0300000-0000-0000-0000-0000000000d6', 'a0300000-0000-0000-0000-000000000002', 'S03 ERP unknown actual', 'Ongoing Project', 'USD'),
  ('a0300000-0000-0000-0000-0000000000d7', 'a0300000-0000-0000-0000-000000000003', 'S03 other org', 'Ongoing Project', 'USD'),
  ('a0300000-0000-0000-0000-0000000000d8', 'a0300000-0000-0000-0000-000000000001', 'S03 Close Out', 'Close Out', 'USD'),
  ('a0300000-0000-0000-0000-0000000000d9', 'a0300000-0000-0000-0000-000000000001', 'S03 primary PMO position', 'Ongoing Project', 'USD'),
  ('a0300000-0000-0000-0000-0000000000da', 'a0300000-0000-0000-0000-000000000002', 'S03 primary ERP position', 'Ongoing Project', 'USD'),
  ('a0300000-0000-0000-0000-0000000000db', 'a0300000-0000-0000-0000-000000000001', 'S03 below threshold', 'Ongoing Project', 'USD'),
  ('a0300000-0000-0000-0000-0000000000dc', 'a0300000-0000-0000-0000-000000000001', 'S03 nonintegral percent', 'Ongoing Project', 'USD'),
  ('a0300000-0000-0000-0000-0000000000dd', 'a0300000-0000-0000-0000-000000000001', 'S03 zero Active budget', 'Ongoing Project', 'USD');

insert into public.budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('a0300000-0000-0000-0000-0000000000b1', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000d1', 1, 'S03 half budget', 'Draft', 'USD'),
  ('a0300000-0000-0000-0000-0000000000b2', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000d2', 1, 'S03 hire budget', 'Draft', 'USD'),
  ('a0300000-0000-0000-0000-0000000000b3', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000d3', 1, 'S03 EUR budget', 'Draft', 'EUR'),
  ('a0300000-0000-0000-0000-0000000000b5', 'a0300000-0000-0000-0000-000000000002', 'a0300000-0000-0000-0000-0000000000d5', 1, 'S03 ERP budget', 'Draft', 'USD'),
  ('a0300000-0000-0000-0000-0000000000b6', 'a0300000-0000-0000-0000-000000000002', 'a0300000-0000-0000-0000-0000000000d6', 1, 'S03 ERP unknown budget', 'Draft', 'USD'),
  ('a0300000-0000-0000-0000-0000000000b7', 'a0300000-0000-0000-0000-000000000003', 'a0300000-0000-0000-0000-0000000000d7', 1, 'S03 other budget', 'Draft', 'USD'),
  ('a0300000-0000-0000-0000-0000000000b8', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000d8', 1, 'S03 Close Out budget', 'Draft', 'USD'),
  ('a0300000-0000-0000-0000-0000000000b9', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000d9', 1, 'S03 primary PMO budget', 'Draft', 'USD'),
  ('a0300000-0000-0000-0000-0000000000ba', 'a0300000-0000-0000-0000-000000000002', 'a0300000-0000-0000-0000-0000000000da', 1, 'S03 primary ERP budget', 'Draft', 'USD'),
  ('a0300000-0000-0000-0000-0000000000bb', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000db', 1, 'S03 below threshold budget', 'Draft', 'USD'),
  ('a0300000-0000-0000-0000-0000000000bc', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000dc', 1, 'S03 nonintegral budget', 'Draft', 'USD'),
  ('a0300000-0000-0000-0000-0000000000bd', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000dd', 1, 'S03 zero Active budget', 'Draft', 'USD');
insert into public.budget_line_items (org_id, budget_version_id, category, description, budgeted_amount) values
  ('a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000b1', 'Labor', 'S03 half budget line', 1000),
  ('a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000b2', 'Labor', 'S03 hire budget line', 500),
  ('a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000b3', 'Labor', 'S03 EUR budget line', 1000),
  ('a0300000-0000-0000-0000-000000000002', 'a0300000-0000-0000-0000-0000000000b5', 'Labor', 'S03 ERP budget line', 1000),
  ('a0300000-0000-0000-0000-000000000002', 'a0300000-0000-0000-0000-0000000000b6', 'Labor', 'S03 ERP unknown budget line', 1000),
  ('a0300000-0000-0000-0000-000000000003', 'a0300000-0000-0000-0000-0000000000b7', 'Labor', 'S03 other budget line', 1000),
  ('a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000b8', 'Labor', 'S03 Close Out budget line', 1000),
  ('a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000b9', 'Labor', 'S03 primary PMO budget line', 1000),
  ('a0300000-0000-0000-0000-000000000002', 'a0300000-0000-0000-0000-0000000000ba', 'Labor', 'S03 primary ERP budget line', 1000),
  ('a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000bb', 'Labor', 'S03 below threshold budget line', 1000),
  ('a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000bc', 'Labor', 'S03 nonintegral budget line', 1000),
  ('a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000bd', 'Labor', 'S03 zero Active budget line', 0);
update public.budget_versions set status = 'Active'
 where id = any(array[
   'a0300000-0000-0000-0000-0000000000b1'::uuid,
   'a0300000-0000-0000-0000-0000000000b2'::uuid,
   'a0300000-0000-0000-0000-0000000000b3'::uuid,
   'a0300000-0000-0000-0000-0000000000b5'::uuid,
   'a0300000-0000-0000-0000-0000000000b6'::uuid,
   'a0300000-0000-0000-0000-0000000000b7'::uuid,
   'a0300000-0000-0000-0000-0000000000b8'::uuid,
   'a0300000-0000-0000-0000-0000000000b9'::uuid,
   'a0300000-0000-0000-0000-0000000000ba'::uuid,
   'a0300000-0000-0000-0000-0000000000bb'::uuid,
   'a0300000-0000-0000-0000-0000000000bc'::uuid,
   'a0300000-0000-0000-0000-0000000000bd'::uuid
 ]);

insert into public.procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, origin) values
  ('a0300000-0000-0000-0000-0000000000f1', 'a0300000-0000-0000-0000-000000000001', 'S03 half purchase', 'Ordered', 1000, 'a0300000-0000-0000-0000-0000000000d1', 'USD', 'Labor', null),
  ('a0300000-0000-0000-0000-0000000000f2', 'a0300000-0000-0000-0000-000000000001', 'S03 cancelled payments', 'Ordered', 1000, 'a0300000-0000-0000-0000-0000000000d2', 'USD', 'Labor', null),
  ('a0300000-0000-0000-0000-0000000000f5', 'a0300000-0000-0000-0000-000000000002', 'S03 ERP open order', 'Ordered', 200, 'a0300000-0000-0000-0000-0000000000d5', 'USD', 'Labor', null),
  ('a0300000-0000-0000-0000-0000000000f9', 'a0300000-0000-0000-0000-000000000001', 'S03 primary PMO purchase', 'Ordered', 900, 'a0300000-0000-0000-0000-0000000000d9', 'USD', 'Labor', null),
  ('a0300000-0000-0000-0000-0000000000fa', 'a0300000-0000-0000-0000-000000000002', 'S03 primary ERP purchase', 'Ordered', 900, 'a0300000-0000-0000-0000-0000000000da', 'USD', 'Labor', null),
  ('a0300000-0000-0000-0000-0000000000fb', 'a0300000-0000-0000-0000-000000000001', 'S03 below threshold purchase', 'Ordered', 800, 'a0300000-0000-0000-0000-0000000000db', 'USD', 'Labor', null),
  ('a0300000-0000-0000-0000-0000000000fc', 'a0300000-0000-0000-0000-000000000001', 'S03 nonintegral purchase', 'Ordered', 899.99, 'a0300000-0000-0000-0000-0000000000dc', 'USD', 'Labor', null);
insert into public.payments (id, org_id, procurement_id, status, date, amount, currency, erp_docstatus, erp_cancelled_at) values
  ('a0300000-0000-0000-0000-0000000000c1', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000f1', 'Paid', '2026-10-10', 500, 'USD', null, null),
  ('a0300000-0000-0000-0000-0000000000c2', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000f2', 'Paid', '2026-10-10', 100, 'USD', null, null),
  ('a0300000-0000-0000-0000-0000000000c3', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000f2', 'Paid', '2026-10-10', 400, 'USD', 2, null),
  ('a0300000-0000-0000-0000-0000000000c4', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000f2', 'Paid', '2026-10-10', 200, 'USD', null, now()),
  ('a0300000-0000-0000-0000-0000000000c9', 'a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000f9', 'Paid', '2026-10-10', 500, 'USD', null, null),
  ('a0300000-0000-0000-0000-0000000000ca', 'a0300000-0000-0000-0000-000000000002', 'a0300000-0000-0000-0000-0000000000fa', 'Paid', '2026-10-10', 500, 'USD', null, null);

-- The PMO project total includes internal hire charges, but cancelled ERP payments do not count as paid or reduce open commitment.
insert into public.equipment_assets (id, org_id, code, name, default_unit) values
  ('a0300000-0000-0000-0000-0000000000e1', 'a0300000-0000-0000-0000-000000000001', 'S03-GEN', 'S03 generator', 'hours');
insert into public.equipment_costing_settings (org_id, asset_id, setting_key, version, basis, work_rate, rate_unit,
                                                charge_category, effective_from) values
  ('a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000e1',
   'a0300000-0000-0000-0000-0000000000e2', 1, 'hire_rate', 50, 'hours', 'Equipment', '2026-01-01');
insert into public.equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, status,
                                             author_id, approver_id, approved_at) values
  ('a0300000-0000-0000-0000-000000000001', 'a0300000-0000-0000-0000-0000000000e1',
   'a0300000-0000-0000-0000-0000000000d2', '2026-10-10', 4, 'hours', 'work', 'Approved',
   'a0300000-0000-0000-0000-0000000000a2', 'a0300000-0000-0000-0000-0000000000a1', now());

insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
values ('a0300000-0000-0000-0000-000000000002', 'erpnext', 'https://s03.example.test', 's03-test-ref', 'active',
        'a0300000-0000-0000-0000-0000000000a3', now());
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target)
values ('a0300000-0000-0000-0000-000000000002', 'Equipment', 'S03 actual account', false);
insert into public.erp_actuals_snapshot (org_id, project_id, cost_center, account, fiscal_year, debit, credit, net, snapshot_id)
values
  ('a0300000-0000-0000-0000-000000000002', 'a0300000-0000-0000-0000-0000000000d5', 'S03 cost center', 'S03 actual account', '2026', 700, 0, 700, 'a0300000-0000-0000-0000-0000000000e5'),
  ('a0300000-0000-0000-0000-000000000002', 'a0300000-0000-0000-0000-0000000000d6', 'S03 cost center', 'S03 actual account', '2026', null, null, null, 'a0300000-0000-0000-0000-0000000000e5'),
  ('a0300000-0000-0000-0000-000000000002', 'a0300000-0000-0000-0000-0000000000da', 'S03 cost center', 'S03 actual account', '2026', 500, 0, 500, 'a0300000-0000-0000-0000-0000000000e5');

select is((select prosecdef from pg_catalog.pg_proc where oid = 'public.project_budget_positions(uuid[])'::regprocedure), false,
          'S03 function runs as invoker so source-table RLS remains in force');
select is((select provolatile::text from pg_catalog.pg_proc where oid = 'public.project_budget_positions(uuid[])'::regprocedure), 's',
          'S03 function is stable and cannot write');
select ok(has_function_privilege('authenticated', 'public.project_budget_positions(uuid[])', 'EXECUTE'),
          'S03 authenticated callers can use the same read surface');
select ok(not has_function_privilege('anon', 'public.project_budget_positions(uuid[])', 'EXECUTE'),
          'S03 anonymous callers gain no read grant');
select ok(position('category' in lower(pg_get_function_result('public.project_budget_positions(uuid[])'::regprocedure))) = 0,
          'S03 project totals do not replace category-coverage facts');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('a0300000-0000-0000-0000-0000000000a1');
select is((select spent::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d1'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d1'), 500::numeric,
          'S03 half-paid order reports paid spend once');
select is((select open_commitment::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d1'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d1'), 500::numeric,
          'S03 half-paid order reports only the unpaid remainder');
select is((select consumption::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d1'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d1'), 1000::numeric,
          'S03 half-paid project consumption sums spent and unpaid remainder once');
select is((select used_percent::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d1'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d1'), 100::numeric,
          'S03 used percentage uses the whole-percent convention');
select is((select consumption_variance::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d1'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d1'), 0::numeric,
          'S03 consumption variance is consumption minus Active budget');
select is((select at_risk from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d1'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d1'), true,
          'S03 active-delivery project at 100 percent is at risk');
select results_eq(
  $$select active_budget_amount::numeric, spent::numeric, open_commitment::numeric, consumption::numeric,
           used_ratio::numeric, used_percent::numeric, consumption_variance::numeric, risk_eligible, at_risk
      from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d9'::uuid])
     where project_id = 'a0300000-0000-0000-0000-0000000000d9'$$,
  $$values (1000::numeric, 500::numeric, 400::numeric, 900::numeric, 0.9::numeric, 90::numeric, -100::numeric, true, true)$$,
  'S03 primary PMO fixture counts paid 500 plus unpaid 400 against Active 1000');
select results_eq(
  $$select consumption::numeric, used_ratio::numeric, used_percent::numeric, risk_eligible, at_risk
      from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000db'::uuid])
     where project_id = 'a0300000-0000-0000-0000-0000000000db'$$,
  $$values (800::numeric, 0.8::numeric, 80::numeric, true, false)$$,
  'S03 known eligible consumption below 90 percent is not at risk');
select results_eq(
  $$select consumption::numeric, used_ratio::numeric, used_percent::numeric, risk_eligible, at_risk
      from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000dc'::uuid])
     where project_id = 'a0300000-0000-0000-0000-0000000000dc'$$,
  $$values (899.99::numeric, 0.89999::numeric, 90::numeric, true, false)$$,
  'S03 899.99 of 1000 rounds to 90 percent without crossing the risk threshold');
select is((select spent::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d2'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d2'), 300::numeric,
          'S03 PMO spent includes a 200 hire charge and excludes cancelled ERP payments');
select is((select open_commitment::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d2'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d2'), 900::numeric,
          'S03 cancelled ERP payments do not reduce open commitment');
select is((select consumption::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d2'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d2'), 1200::numeric,
          'S03 hire charge is counted alongside the unpaid purchase remainder');
select is((select consumption::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d3'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d3'), 0::numeric,
          'S03 known PMO consumption remains available when budget currency differs');
select is((select used_ratio::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d3'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d3'), null::numeric,
          'S03 mismatched budget currency withholds the ratio');
select is((select consumption_variance::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d3'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d3'), null::numeric,
          'S03 mismatched budget currency withholds variance');
select results_eq(
  $$select used_ratio, used_percent, consumption_variance, at_risk
      from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d3'::uuid])
     where project_id = 'a0300000-0000-0000-0000-0000000000d3'$$,
  $$values (null::text, null::text, null::text, null::boolean)$$,
  'S03 mismatched budget currency withholds the full dependent tuple');
select is((select active_budget_amount::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d4'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d4'), null::numeric,
          'S03 missing Active budget is unavailable');
select is((select used_percent::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d4'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d4'), null::numeric,
          'S03 missing Active budget does not produce a reassuring percent');
select results_eq(
  $$select used_ratio, used_percent, consumption_variance, at_risk
      from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d4'::uuid])
     where project_id = 'a0300000-0000-0000-0000-0000000000d4'$$,
  $$values (null::text, null::text, null::text, null::boolean)$$,
  'S03 missing Active budget withholds the full dependent tuple');
select results_eq(
  $$select used_ratio, used_percent, consumption_variance, at_risk
      from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000dd'::uuid])
     where project_id = 'a0300000-0000-0000-0000-0000000000dd'$$,
  $$values (null::text, null::text, null::text, null::boolean)$$,
  'S03 zero Active budget withholds the full dependent tuple');
select is((select risk_eligible from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d8'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d8'), false,
          'S03 Close Out is outside the canonical active-delivery risk population');
select is((select at_risk from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d8'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d8'), false,
          'S03 an ineligible project is explicitly not at risk');
select is((select count(*)::int from public.project_budget_positions(array[
             'a0300000-0000-0000-0000-0000000000d1'::uuid,
             'a0300000-0000-0000-0000-0000000000d7'::uuid])), 1,
          'S03 a requested project from another org is not returned');
select is((select count(*)::int from public.project_budget_positions() where project_id = 'a0300000-0000-0000-0000-0000000000d7'), 0,
          'S03 an unfiltered collection remains scoped to the caller org');

select pg_temp.act_as('a0300000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d1'::uuid])), 0,
          'S03 Engineer reads no financial position, matching the existing money readers');
reset role;
set local role authenticated;
select pg_temp.act_as('a0300000-0000-0000-0000-0000000000a3');
select is((select ledger_basis from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d5'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d5'), 'erp',
          'S03 ERP project reports its ledger basis');
select is((select spent::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d5'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d5'), 700::numeric,
          'S03 ERP project reads mapped ledger Actual');
select is((select open_commitment::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d5'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d5'), null::numeric,
          'S03 ERP basis does not add unreconciled PMO commitments');
select is((select consumption::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d5'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d5'), 700::numeric,
          'S03 ERP consumption remains the ledger Actual alone');
select results_eq(
  $$select active_budget_amount::numeric, spent::numeric, open_commitment::numeric, consumption::numeric, used_percent::numeric
      from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000da'::uuid])
     where project_id = 'a0300000-0000-0000-0000-0000000000da'$$,
  $$values (1000::numeric, 500::numeric, null::numeric, 500::numeric, 50::numeric)$$,
  'S03 ERP variant uses mapped actual 500 without adding the purchase remainder');
select is((select complete from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d6'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d6'), false,
          'S03 mapped ERP actual with unknown amount keeps consumption incomplete');
select is((select consumption::numeric from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d6'::uuid])
            where project_id = 'a0300000-0000-0000-0000-0000000000d6'), null::numeric,
          'S03 unknown ERP actual is not coerced to zero');
select results_eq(
  $$select used_ratio, used_percent, consumption_variance, at_risk
      from public.project_budget_positions(array['a0300000-0000-0000-0000-0000000000d6'::uuid])
     where project_id = 'a0300000-0000-0000-0000-0000000000d6'$$,
  $$values (null::text, null::text, null::text, null::boolean)$$,
  'S03 unknown ERP actual withholds the full dependent tuple');
select * from finish();
rollback;
