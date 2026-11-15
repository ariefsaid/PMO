-- 0897_budget_comparison_no_ledger.test.sql — #2325: the Budget tab's comparison for an org with no accounting system.
-- With no ledger read the recorded figure is the PMO paid-purchase position (pre-tax paid purchases per budget category
-- plus the internal hire charge), the same figure the header and the lists show. An org that reads an accounting system
-- keeps the ledger figure and never gets the PMO purchases added. Fiscal-year scopes stay unknown (no fiscal calendar).
--
-- Mutation commitments (each turns this file red, then is restored):
--   M1 basis — drop the `not` on the PMO branch (it then runs for a ledger org too): AC-BCNL-006 → red.
--   M2 helper — drop the NULL-category group from project_pmo_paid_by_category: AC-BCNL-002/003 → red.
--   M3 unbudgeted category — leave a named category with spend but no budget line at NULL budget: AC-BCNL-003 → red.
begin;
create extension if not exists pgtap;
select plan(38);

insert into public.organizations (id, name, default_currency, default_timezone) values
  ('08970000-0000-0000-0000-000000000001', 'BCNL no ledger', 'USD', 'UTC'),
  ('08970000-0000-0000-0000-000000000002', 'BCNL other org', 'USD', 'UTC'),
  ('08970000-0000-0000-0000-000000000003', 'BCNL ledger org', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('08970000-0000-0000-0000-0000000000a1', 'bcnl-finance@example.test'),
  ('08970000-0000-0000-0000-0000000000a2', 'bcnl-engineer@example.test'),
  ('08970000-0000-0000-0000-0000000000b1', 'bcnl-other-finance@example.test'),
  ('08970000-0000-0000-0000-0000000000c1', 'bcnl-ledger-finance@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('08970000-0000-0000-0000-0000000000a1', '08970000-0000-0000-0000-000000000001', 'BCNL Finance', 'bcnl-finance@example.test', 'Finance', 'active'),
  ('08970000-0000-0000-0000-0000000000a2', '08970000-0000-0000-0000-000000000001', 'BCNL Engineer', 'bcnl-engineer@example.test', 'Engineer', 'active'),
  ('08970000-0000-0000-0000-0000000000b1', '08970000-0000-0000-0000-000000000002', 'BCNL Other Finance', 'bcnl-other-finance@example.test', 'Finance', 'active'),
  ('08970000-0000-0000-0000-0000000000c1', '08970000-0000-0000-0000-000000000003', 'BCNL Ledger Finance', 'bcnl-ledger-finance@example.test', 'Finance', 'active');
insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
values ('08970000-0000-0000-0000-000000000003', 'erpnext', 'https://erp.example.test', 'test-ref', 'active',
        '08970000-0000-0000-0000-0000000000c1', now());

-- P1 the fixture project; P2 the other-currency case; P3 a per-year budget; P4 the ledger org's project; P5 a EUR project
-- (org default USD) with a taxed paid purchase and a hire charge.
insert into public.projects (id, org_id, name, status, currency, start_date, end_date) values
  ('08970000-0000-0000-0000-0000000000d1', '08970000-0000-0000-0000-000000000001', 'BCNL fixture', 'Ongoing Project', 'USD', '2026-01-01', '2026-12-31'),
  ('08970000-0000-0000-0000-0000000000d2', '08970000-0000-0000-0000-000000000001', 'BCNL other currency', 'Ongoing Project', 'USD', '2026-01-01', '2026-12-31'),
  ('08970000-0000-0000-0000-0000000000d3', '08970000-0000-0000-0000-000000000001', 'BCNL per year', 'Ongoing Project', 'USD', '2026-01-01', '2026-12-31'),
  ('08970000-0000-0000-0000-0000000000d4', '08970000-0000-0000-0000-000000000003', 'BCNL ledger', 'Ongoing Project', 'USD', '2026-01-01', '2026-12-31'),
  ('08970000-0000-0000-0000-0000000000d5', '08970000-0000-0000-0000-000000000001', 'BCNL tax and charge', 'Ongoing Project', 'EUR', '2026-01-01', '2026-12-31');

insert into public.budget_versions (id, org_id, project_id, version, name, status, currency, budget_mode) values
  ('08970000-0000-0000-0000-0000000000e1', '08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000d1', 1, 'v1', 'Draft', 'USD', 'whole_project'),
  ('08970000-0000-0000-0000-0000000000e2', '08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000d2', 1, 'v1', 'Draft', 'USD', 'whole_project'),
  ('08970000-0000-0000-0000-0000000000e3', '08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000d3', 1, 'v1', 'Draft', 'USD', 'per_year'),
  ('08970000-0000-0000-0000-0000000000e4', '08970000-0000-0000-0000-000000000003', '08970000-0000-0000-0000-0000000000d4', 1, 'v1', 'Draft', 'USD', 'whole_project');
insert into public.budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, fiscal_year) values
  ('08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000e1', 'Labor', 'labor', 5000, null),
  ('08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000e1', 'Materials', 'materials', 2000, null),
  ('08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000e2', 'Labor', 'labor', 5000, null),
  ('08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000e2', 'Materials', 'materials', 2000, null),
  ('08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000e3', 'Labor', 'phased labor', 400, 'FY-A'),
  ('08970000-0000-0000-0000-000000000003', '08970000-0000-0000-0000-0000000000e4', 'Labor', 'labor', 5000, null);
update public.budget_versions set status = 'Active', activated_at = now()
 where id in ('08970000-0000-0000-0000-0000000000e1', '08970000-0000-0000-0000-0000000000e2',
              '08970000-0000-0000-0000-0000000000e3', '08970000-0000-0000-0000-0000000000e4');

-- The fixture: Labor paid 1,000; Labor Ordered 2,000 (unpaid); uncategorised paid 300. P2 repeats it with the Labor
-- payment in EUR. P3 has a paid purchase too (the year scope must not use it). P4: Labor paid 1,000 in a ledger org.
insert into public.procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, origin) values
  ('08970000-0000-0000-0000-0000000000f1', '08970000-0000-0000-0000-000000000001', 'Labor paid', 'Paid', 1000, '08970000-0000-0000-0000-0000000000d1', 'USD', 'Labor', null),
  ('08970000-0000-0000-0000-0000000000f2', '08970000-0000-0000-0000-000000000001', 'Labor ordered', 'Ordered', 2000, '08970000-0000-0000-0000-0000000000d1', 'USD', 'Labor', null),
  ('08970000-0000-0000-0000-0000000000f3', '08970000-0000-0000-0000-000000000001', 'Uncategorised paid', 'Paid', 300, '08970000-0000-0000-0000-0000000000d1', 'USD', null, null),
  ('08970000-0000-0000-0000-0000000000f4', '08970000-0000-0000-0000-000000000001', 'Labor paid EUR', 'Paid', 1000, '08970000-0000-0000-0000-0000000000d2', 'EUR', 'Labor', null),
  ('08970000-0000-0000-0000-0000000000f5', '08970000-0000-0000-0000-000000000001', 'Uncategorised paid', 'Paid', 300, '08970000-0000-0000-0000-0000000000d2', 'USD', null, null),
  ('08970000-0000-0000-0000-0000000000f6', '08970000-0000-0000-0000-000000000001', 'Year paid', 'Paid', 1000, '08970000-0000-0000-0000-0000000000d3', 'USD', 'Labor', null),
  ('08970000-0000-0000-0000-0000000000f7', '08970000-0000-0000-0000-000000000003', 'Ledger org paid', 'Paid', 1000, '08970000-0000-0000-0000-0000000000d4', 'USD', 'Labor', null),
  ('08970000-0000-0000-0000-0000000000f8', '08970000-0000-0000-0000-000000000001', 'Taxed paid', 'Paid', 1100, '08970000-0000-0000-0000-0000000000d5', 'EUR', 'Materials', null);
insert into public.procurement_invoices (id, org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount)
values ('08970000-0000-0000-0000-0000000000b8', '08970000-0000-0000-0000-000000000001',
        '08970000-0000-0000-0000-0000000000f8', 'Paid', 1000, 'EUR', 'exclusive', 100);
insert into public.payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('08970000-0000-0000-0000-0000000000c1', '08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000f1', 'Paid', '2026-10-10', 1000, 'USD'),
  ('08970000-0000-0000-0000-0000000000c3', '08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000f3', 'Paid', '2026-10-10', 300, 'USD'),
  ('08970000-0000-0000-0000-0000000000c4', '08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000f4', 'Paid', '2026-10-10', 1000, 'EUR'),
  ('08970000-0000-0000-0000-0000000000c5', '08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000f5', 'Paid', '2026-10-10', 300, 'USD'),
  ('08970000-0000-0000-0000-0000000000c6', '08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000f6', 'Paid', '2026-10-10', 1000, 'USD'),
  ('08970000-0000-0000-0000-0000000000c7', '08970000-0000-0000-0000-000000000003', '08970000-0000-0000-0000-0000000000f7', 'Paid', '2026-10-10', 1000, 'USD'),
  ('08970000-0000-0000-0000-0000000000c8', '08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000f8', 'Paid', '2026-10-10', 1100, 'EUR');

-- A hire charge on P1: 4 hours at 50 = 200 Equipment (the internal term of the spent position).
insert into public.equipment_assets (id, org_id, code, name, default_unit) values
  ('08970000-0000-0000-0000-0000000000a9', '08970000-0000-0000-0000-000000000001', 'BCNL-GEN', 'BCNL generator', 'hours');
insert into public.equipment_costing_settings (org_id, asset_id, setting_key, version, basis, work_rate, rate_unit,
                                                charge_category, effective_from) values
  ('08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000a9',
   '08970000-0000-0000-0000-0000000000a8', 1, 'hire_rate', 50, 'hours', 'Equipment', '2026-01-01');
insert into public.equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, status,
                                             author_id, approver_id, approved_at) values
  ('08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000a9',
   '08970000-0000-0000-0000-0000000000d1', '2026-10-10', 4, 'hours', 'work', 'Approved',
   '08970000-0000-0000-0000-0000000000a2', '08970000-0000-0000-0000-0000000000a1', now()),
  ('08970000-0000-0000-0000-000000000001', '08970000-0000-0000-0000-0000000000a9',
   '08970000-0000-0000-0000-0000000000d5', '2026-10-11', 4, 'hours', 'work', 'Approved',
   '08970000-0000-0000-0000-0000000000a2', '08970000-0000-0000-0000-0000000000a1', now());

-- The ledger org reads an accounting system: Labor 700 on its snapshot.
set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target)
values ('08970000-0000-0000-0000-000000000003', 'Labor', '0897-LABOR', true);
insert into public.erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at)
values ('08970000-0000-0000-0000-000000000003', '08970000-0000-0000-0000-0000000000d4', '0897-LABOR', 'FY-2026', 700,
        '2026-10-01', '08970000-0000-0000-0000-0000000000b9', '2026-10-02');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"08970000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-BCNL-001 ─ no accounting system: the paid Labor purchase is the recorded figure.
select is((select recorded from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category = 'Labor'),
  1000::numeric, 'AC-BCNL-001 Labor recorded is the paid purchase (1,000)');
select is((select remaining from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category = 'Labor'),
  4000::numeric, 'AC-BCNL-001 Labor remaining is 4,000');
select is((select percent_used from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category = 'Labor'),
  0.2::numeric, 'AC-BCNL-001 Labor percent used is 0.2 as a fraction');
select is((select mapped from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category = 'Labor'),
  true, 'AC-BCNL-001 Labor is mapped: PMO reads its own purchases completely');
select is((select has_ledger from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category = 'Labor'),
  true, 'AC-BCNL-001 Labor says it has rows behind it');

-- AC-BCNL-002 ─ the rows add up to the header figure; the helper adds up to it too (one definition, held by this test).
select is((select amount from public.project_pmo_spent_position('08970000-0000-0000-0000-0000000000d1')),
  1500::numeric, 'AC-BCNL-002 the spent position is 1,500: paid Labor 1,000 + uncategorised 300 + hire charge 200');
select is((select sum(recorded) from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null)),
  (select amount from public.project_pmo_spent_position('08970000-0000-0000-0000-0000000000d1')),
  'AC-BCNL-002 the comparison rows add up to the header Spent');
select is((select sum(amount) from public.project_pmo_paid_by_category('08970000-0000-0000-0000-0000000000d1')),
  (select amount from public.project_pmo_spent_position('08970000-0000-0000-0000-0000000000d1')),
  'AC-BCNL-002 the helper groups add up to the spent position');

-- AC-BCNL-003 ─ an uncategorised paid purchase is its own row, never dropped, never spread.
select is((select count(*)::int from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category is null),
  1, 'AC-BCNL-003 one uncategorised row');
select is((select recorded from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category is null),
  300::numeric, 'AC-BCNL-003 the uncategorised row records 300');
select is((select budget_total from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category is null),
  0::numeric, 'AC-BCNL-003 the uncategorised row has no budget (0), so the budget total stays the real categories');
select is((select sum(budget_total) from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null)),
  7000::numeric, 'AC-BCNL-003 budget total is Labor 5,000 + Materials 2,000');
-- SQL sum() skips NULL, so the total above cannot see an unknown budget; the strip's approved total needs none.
select is((select count(*)::int from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where budget_total is null),
  0, 'AC-BCNL-003 no row has an unknown budget (the strip total stays known)');
select is((select budget_total from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category = 'Equipment'),
  0::numeric, 'AC-BCNL-003 a category with spend and no budget line is budgeted 0, not unknown');
select is((select recorded from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category = 'Equipment'),
  200::numeric, 'AC-BCNL-003 the hire charge shows on its category');

-- AC-BCNL-010 ─ the helper takes paid purchases before tax, and a hire charge on a project in another currency is unknown.
select is((select amount from public.project_pmo_paid_by_category('08970000-0000-0000-0000-0000000000d5') where category = 'Materials'),
  1000::numeric, 'AC-BCNL-010 a taxed paid purchase counts before tax (1,100 paid, 100 tax)');
select is((select amount from public.project_pmo_paid_by_category('08970000-0000-0000-0000-0000000000d5') where category = 'Equipment'),
  null::numeric, 'AC-BCNL-010 a hire charge priced in the org currency is unknown on a project in another currency');
select is((select n from public.project_pmo_paid_by_category('08970000-0000-0000-0000-0000000000d5') where category = 'Equipment'),
  1, 'AC-BCNL-010 and the unknown group still counts its charge');

-- AC-BCNL-004 ─ a budget category with no paid purchase is a known zero; an unpaid order adds nothing.
select is((select recorded from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category = 'Materials'),
  0::numeric, 'AC-BCNL-004 Materials recorded is a known 0');
select is((select remaining from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category = 'Materials'),
  2000::numeric, 'AC-BCNL-004 Materials remaining is the whole budget');
select is((select recorded from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where category = 'Labor'),
  1000::numeric, 'AC-BCNL-004 the unpaid 2,000 Ordered Labor purchase adds nothing to recorded');

-- AC-BCNL-005 ─ another currency is unknown for its category only; nothing is converted.
select is((select recorded from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d2', null) where category = 'Labor'),
  null::numeric, 'AC-BCNL-005 a EUR payment on a USD project makes Labor recorded unknown');
select is((select remaining from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d2', null) where category = 'Labor'),
  null::numeric, 'AC-BCNL-005 and its remaining unknown');
select is((select recorded from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d2', null) where category = 'Materials'),
  0::numeric, 'AC-BCNL-005 Materials stays a known 0');
select is((select recorded from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d2', null) where category is null),
  300::numeric, 'AC-BCNL-005 the uncategorised row stays known');

-- AC-BCNL-007 ─ a fiscal-year scope has no fiscal calendar without an accounting system: budget known, recorded unknown.
select is((select budget_total from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d3', 'FY-A') where category = 'Labor'),
  400::numeric, 'AC-BCNL-007 the year scope keeps the phased budget');
select is((select recorded from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d3', 'FY-A') where category = 'Labor'),
  null::numeric, 'AC-BCNL-007 the year scope never places a paid purchase in a year');
select is((select has_ledger from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d3', 'FY-A') where category = 'Labor'),
  false, 'AC-BCNL-007 the year scope has no rows behind recorded');
select is((select count(*)::int from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d3', 'FY-A') where category is null),
  0, 'AC-BCNL-007 no uncategorised row in a year scope');
select is((select actuals_to_date from public.get_budget_projection('08970000-0000-0000-0000-0000000000d3', 'FY-A') where category = 'Labor'),
  null::numeric, 'AC-BCNL-007 the forecast reads the same unknown year figure');

-- AC-BCNL-008 ─ a role outside Admin/Finance/Executive/Project Manager reads no recorded figure.
set local request.jwt.claims = '{"sub":"08970000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.project_pmo_paid_by_category('08970000-0000-0000-0000-0000000000d1')),
  0, 'AC-BCNL-008 the helper returns no rows to an Engineer');
select is((select count(*)::int from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null) where recorded is not null),
  0, 'AC-BCNL-008 the comparison shows an Engineer no recorded figure');

-- AC-BCNL-009 ─ another organisation sees nothing.
set local request.jwt.claims = '{"sub":"08970000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d1', null)),
  0, 'AC-BCNL-009 a caller in another organisation gets no comparison rows');
select is((select count(*)::int from public.project_pmo_paid_by_category('08970000-0000-0000-0000-0000000000d1')),
  0, 'AC-BCNL-009 nor helper rows');

-- AC-BCNL-006 ─ an org that reads an accounting system keeps the ledger figure; the PMO purchase is not added.
set local request.jwt.claims = '{"sub":"08970000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select recorded from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d4', null) where category = 'Labor'),
  700::numeric, 'AC-BCNL-006 a ledger org records the ledger 700, not its 1,000 purchase and not the sum');
select is((select count(*)::int from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d4', null) where category is null),
  0, 'AC-BCNL-006 a ledger org gets no uncategorised row');
select is((select has_ledger from public.get_budget_comparison('08970000-0000-0000-0000-0000000000d4', null) where category = 'Labor'),
  true, 'AC-BCNL-006 a ledger org keeps its ledger flag');

-- AC-BCNL-011 ─ the helper is closed to anon and open to signed-in callers and the service (an invoker, so RLS still decides rows).
select ok(not has_function_privilege('anon', 'public.project_pmo_paid_by_category(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.project_pmo_paid_by_category(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.project_pmo_paid_by_category(uuid)', 'execute'),
  'AC-BCNL-011 the helper is executable by authenticated and service_role, never anon');

select * from finish();
rollback;
