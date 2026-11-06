-- 0700_pmo_spend_split.test.sql — #1739: for an org without an accounting system the Projects collection, the
-- dashboards and the Budget tab split one purchase the same way: pre-tax paid is spent, the unpaid remainder is
-- committed (OD-1530-COMMIT). ERP-ledger orgs keep their ledger basis untouched.
--
-- The headline case is ONE half-paid purchase of 1,000: it reads 500 spent / 500 committed everywhere, not 1,000 actual
-- on the list and 500/500 on the budget tab.
begin;
create extension if not exists pgtap;
select plan(28);

insert into public.organizations (id, name, default_currency) values
  ('07000000-0000-0000-0000-000000000001', 'Split org', 'USD'),
  ('07000000-0000-0000-0000-000000000002', 'Ledger split org', 'USD');
insert into auth.users (id, email) values
  ('07000000-0000-0000-0000-0000000000a1', 'split-finance@example.test'),
  ('07000000-0000-0000-0000-0000000000b1', 'split-engineer@example.test'),
  ('07000000-0000-0000-0000-0000000000e1', 'split-ledger-finance@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('07000000-0000-0000-0000-0000000000a1', '07000000-0000-0000-0000-000000000001', 'Split Finance', 'split-finance@example.test', 'Finance', 'active'),
  ('07000000-0000-0000-0000-0000000000b1', '07000000-0000-0000-0000-000000000001', 'Split Engineer', 'split-engineer@example.test', 'Engineer', 'active'),
  ('07000000-0000-0000-0000-0000000000e1', '07000000-0000-0000-0000-000000000002', 'Ledger Finance', 'split-ledger-finance@example.test', 'Finance', 'active');
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount,
                             tax_rate, tax_base_numerator, tax_base_denominator, subject_to_vat, project_manager_id) values
  ('07000000-0000-0000-0000-0000000000d1', '07000000-0000-0000-0000-000000000001', 'Half-paid project', 'Ongoing Project', 'USD', 10000, 'exclusive', 0, 0, 1, 1, false, '07000000-0000-0000-0000-0000000000a1'),
  ('07000000-0000-0000-0000-0000000000d2', '07000000-0000-0000-0000-000000000001', 'Unpaid project', 'Ongoing Project', 'USD', 5000, 'exclusive', 0, 0, 1, 1, false, '07000000-0000-0000-0000-0000000000a1'),
  ('07000000-0000-0000-0000-0000000000d3', '07000000-0000-0000-0000-000000000002', 'Ledger project', 'Ongoing Project', 'USD', 10000, 'exclusive', 0, 0, 1, 1, false, null);
insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
values ('07000000-0000-0000-0000-000000000002', 'erpnext', 'https://erp.example.test', 'test-ref', 'active',
        '07000000-0000-0000-0000-0000000000e1', now());
insert into public.procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, origin) values
  ('07000000-0000-0000-0000-0000000000f1', '07000000-0000-0000-0000-000000000001', 'Half-paid purchase', 'Paid', 1000,
   '07000000-0000-0000-0000-0000000000d1', 'USD', 'Labor', null),
  ('07000000-0000-0000-0000-0000000000f2', '07000000-0000-0000-0000-000000000001', 'Unpaid purchase', 'Ordered', 900,
   '07000000-0000-0000-0000-0000000000d2', 'USD', 'Labor', null),
  ('07000000-0000-0000-0000-0000000000f3', '07000000-0000-0000-0000-000000000002', 'Ledger half-paid purchase', 'Paid', 1000,
   '07000000-0000-0000-0000-0000000000d3', 'USD', 'Labor', null);
insert into public.payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('07000000-0000-0000-0000-0000000000c1', '07000000-0000-0000-0000-000000000001',
   '07000000-0000-0000-0000-0000000000f1', 'Paid', '2026-10-10', 500, 'USD'),
  ('07000000-0000-0000-0000-0000000000c2', '07000000-0000-0000-0000-000000000002',
   '07000000-0000-0000-0000-0000000000f3', 'Paid', '2026-10-10', 500, 'USD');
insert into public.budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('07000000-0000-0000-0000-0000000000b1', '07000000-0000-0000-0000-000000000001', '07000000-0000-0000-0000-0000000000d1', 1, 'v1', 'Draft', 'USD'),
  ('07000000-0000-0000-0000-0000000000b2', '07000000-0000-0000-0000-000000000001', '07000000-0000-0000-0000-0000000000d2', 1, 'v1', 'Draft', 'USD'),
  ('07000000-0000-0000-0000-0000000000b3', '07000000-0000-0000-0000-000000000002', '07000000-0000-0000-0000-0000000000d3', 1, 'v1', 'Draft', 'USD');
insert into public.budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount) values
  ('07000000-0000-0000-0000-0000000000e1', '07000000-0000-0000-0000-000000000001', '07000000-0000-0000-0000-0000000000b1', 'Labor', 'half-paid', 5000),
  ('07000000-0000-0000-0000-0000000000e2', '07000000-0000-0000-0000-000000000001', '07000000-0000-0000-0000-0000000000b2', 'Labor', 'unpaid', 2000),
  ('07000000-0000-0000-0000-0000000000e3', '07000000-0000-0000-0000-000000000002', '07000000-0000-0000-0000-0000000000b3', 'Labor', 'ledger', 5000);
update public.budget_versions set status = 'Active'
 where id in ('07000000-0000-0000-0000-0000000000b1', '07000000-0000-0000-0000-0000000000b2', '07000000-0000-0000-0000-0000000000b3');

-- I3 / minor 6 fixtures: a paid purchase with no budget category, and a payment on a cancelled order.
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount,
                             tax_rate, tax_base_numerator, tax_base_denominator, subject_to_vat, project_manager_id) values
  ('07000000-0000-0000-0000-0000000000d4', '07000000-0000-0000-0000-000000000001', 'Uncategorized paid project', 'Ongoing Project', 'USD', 10000, 'exclusive', 0, 0, 1, 1, false, '07000000-0000-0000-0000-0000000000a1'),
  ('07000000-0000-0000-0000-0000000000d5', '07000000-0000-0000-0000-000000000001', 'Cancelled paid project', 'Ongoing Project', 'USD', 10000, 'exclusive', 0, 0, 1, 1, false, '07000000-0000-0000-0000-0000000000a1');
insert into public.procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, origin) values
  ('07000000-0000-0000-0000-0000000000f4', '07000000-0000-0000-0000-000000000001', 'Uncategorized paid purchase', 'Paid', 400,
   '07000000-0000-0000-0000-0000000000d4', 'USD', null, null),
  ('07000000-0000-0000-0000-0000000000f5', '07000000-0000-0000-0000-000000000001', 'Cancelled paid purchase', 'Cancelled', 200,
   '07000000-0000-0000-0000-0000000000d5', 'USD', 'Labor', null);
insert into public.payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('07000000-0000-0000-0000-0000000000c4', '07000000-0000-0000-0000-000000000001',
   '07000000-0000-0000-0000-0000000000f4', 'Paid', '2026-10-10', 400, 'USD'),
  ('07000000-0000-0000-0000-0000000000c5', '07000000-0000-0000-0000-000000000001',
   '07000000-0000-0000-0000-0000000000f5', 'Paid', '2026-10-10', 200, 'USD');
insert into public.budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('07000000-0000-0000-0000-0000000000b4', '07000000-0000-0000-0000-000000000001', '07000000-0000-0000-0000-0000000000d4', 1, 'v1', 'Draft', 'USD'),
  ('07000000-0000-0000-0000-0000000000b5', '07000000-0000-0000-0000-000000000001', '07000000-0000-0000-0000-0000000000d5', 1, 'v1', 'Draft', 'USD');
insert into public.budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount) values
  ('07000000-0000-0000-0000-0000000000e4', '07000000-0000-0000-0000-000000000001', '07000000-0000-0000-0000-0000000000b4', 'Labor', 'uncategorized', 5000),
  ('07000000-0000-0000-0000-0000000000e5', '07000000-0000-0000-0000-000000000001', '07000000-0000-0000-0000-0000000000b5', 'Labor', 'cancelled', 5000);
update public.budget_versions set status = 'Active'
 where id in ('07000000-0000-0000-0000-0000000000b4', '07000000-0000-0000-0000-0000000000b5');

set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target)
values ('07000000-0000-0000-0000-000000000002', 'Labor', '0700-LABOR', true);
insert into public.erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at)
values ('07000000-0000-0000-0000-000000000002', '07000000-0000-0000-0000-0000000000d3', '0700-LABOR', 'FY-2026', 300,
        '2026-10-01', '07000000-0000-0000-0000-0000000000b9', '2026-10-02');
reset role;

-- ── The position: one half-paid 1,000 purchase splits 500 spent / 500 committed ───────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select amount from public.project_pmo_spent_position('07000000-0000-0000-0000-0000000000d1')), 500::numeric,
  'AC-1739-01 the PMO spent position is the pre-tax paid amount (500), not the 1,000 order total');
select is((select complete from public.project_pmo_spent_position('07000000-0000-0000-0000-0000000000d1')), true,
  'AC-1739-01 a readable paid amount makes the spent position complete');
select is((select amount from public.project_pmo_commitment_position('07000000-0000-0000-0000-0000000000d1')), 500::numeric,
  'AC-1739-01 the PMO commitment position is the unpaid remainder (500), the Budget tab Committed figure');
select is((select complete from public.project_pmo_commitment_position('07000000-0000-0000-0000-0000000000d1')), true,
  'AC-1739-01 a readable purchase makes the commitment position complete');
select is((select s.amount + c.amount from public.project_pmo_spent_position('07000000-0000-0000-0000-0000000000d1') s
             cross join public.project_pmo_commitment_position('07000000-0000-0000-0000-0000000000d1') c), 1000::numeric,
  'AC-1739-01 spent plus committed is the order total: the purchase counts once, never twice');
select is((public.get_project_finances('07000000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric, 500::numeric,
  'AC-1739-01 the spent position equals the Budget tab Spent source (project finances actuals)');

-- ── Both screens read one figure ──────────────────────────────────────────────────────────────────────────────
select is((select (actuals->>'total')::numeric from public.get_projects_money_collection(array['07000000-0000-0000-0000-0000000000d1'::uuid])),
          (select (public.get_project_finances('07000000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric),
  'AC-1739-02 the Projects list Actual equals the Budget tab Spent for the same project (500 both)');
select is((select (actuals->>'committed_total')::numeric from public.get_projects_money_collection(array['07000000-0000-0000-0000-0000000000d1'::uuid])), 500::numeric,
  'AC-1739-02 the collection also carries the open commitment (500) so budget-used stays spent plus committed');
select is((select actuals->>'complete' from public.get_projects_money_collection(array['07000000-0000-0000-0000-0000000000d1'::uuid])), 'true',
  'AC-1739-02 a complete paid read is a known Actual');
select is((select (value->>'spent')::numeric from json_array_elements(public.get_executive_dashboard()->'top_projects') value
           where value->>'id' = '07000000-0000-0000-0000-0000000000d1'), 500::numeric,
  'AC-1739-03 the executive dashboard spent is the pre-tax paid amount');
select is((select (value->>'committed')::numeric from json_array_elements(public.get_executive_dashboard()->'top_projects') value
           where value->>'id' = '07000000-0000-0000-0000-0000000000d1'), 500::numeric,
  'AC-1739-03 the row also carries the open commitment so its at-risk signal stays on budget consumption');
select is((select (value->>'spent')::numeric from json_array_elements(public.get_pm_dashboard_projects()) value
           where value->>'id' = '07000000-0000-0000-0000-0000000000d1'), 500::numeric,
  'AC-1739-03 the PM dashboard spent is the pre-tax paid amount');
select is((select (value->>'ledger_owned')::boolean from json_array_elements(public.get_finance_budget_review()) value
           where value->>'id' = '07000000-0000-0000-0000-0000000000d1'), false,
  'AC-1739-04 a PMO-basis review row says so, so the Finance home labels its column "Committed + spent"');
select is((select (value->>'spent')::numeric from json_array_elements(public.get_finance_budget_review()) value
           where value->>'id' = '07000000-0000-0000-0000-0000000000d1'), 1000::numeric,
  'AC-1739-04 the finance review keeps ONE purchase-consumption figure (500 spent plus 500 committed), labelled as such');
select is((public.get_executive_dashboard()->>'projects_at_risk')::int, 0,
  'AC-1739-05 at-risk stays on budget consumption (1,000 of 5,000): a half-paid purchase is not double counted');
select is((public.get_executive_dashboard()->>'risk_unchecked_projects')::int, 0,
  'AC-1739-05 both figures complete: no delivery project is left unchecked');

-- ── An unpaid purchase is committed, never spent ──────────────────────────────────────────────────────────────
select is((select amount from public.project_pmo_spent_position('07000000-0000-0000-0000-0000000000d2')), 0::numeric,
  'AC-1739-06 an ordered-but-unpaid purchase contributes no spent');
select is((select amount from public.project_pmo_commitment_position('07000000-0000-0000-0000-0000000000d2')), 900::numeric,
  'AC-1739-06 an ordered-but-unpaid purchase is fully committed');

-- ── An uncategorized paid purchase still counts (I3) ──────────────────────────────────────────────────────────
select is((select amount from public.project_pmo_spent_position('07000000-0000-0000-0000-0000000000d4')), 400::numeric,
  'AC-1739-08 a paid purchase with no budget category counts as spent, so the list Actual is not blanked');
select is((select (actuals->>'total')::numeric from public.get_projects_money_collection(array['07000000-0000-0000-0000-0000000000d4'::uuid])), 400::numeric,
  'AC-1739-08 the Projects list shows the uncategorized paid amount');
select is((select (value->>'spent')::numeric from json_array_elements(public.get_executive_dashboard()->'top_projects') value
           where value->>'id' = '07000000-0000-0000-0000-0000000000d4'), 400::numeric,
  'AC-1739-08 the executive dashboard shows the uncategorized paid amount');

-- ── Documented exception: cash paid on a cancelled order is spent, with nothing left committed (minor 6) ────
select is((select s.amount || '/' || c.amount from public.project_pmo_spent_position('07000000-0000-0000-0000-0000000000d5') s
             cross join public.project_pmo_commitment_position('07000000-0000-0000-0000-0000000000d5') c), '200.00/0',
  'AC-1739-09 a payment on a cancelled order stays spent (cash is out) and leaves no commitment');

-- ── Server-bound agreement: the real list payload against the Budget tab sources ──────────────────────────────
select is((select (actuals->>'committed_total')::numeric from public.get_projects_money_collection(array['07000000-0000-0000-0000-0000000000d1'::uuid])),
          (select sum(public.procurement_open_commitment(pr)) from public.procurements pr
            where pr.project_id = '07000000-0000-0000-0000-0000000000d1' and pr.status::text = any(public.committed_procurement_statuses())),
  'AC-1739-02 the list commitment equals the sum of the per-purchase open commitments the Budget tab shows');
select is((select array_agg(k order by k) from jsonb_object_keys((select actuals from public.get_projects_money_collection(array['07000000-0000-0000-0000-0000000000d1'::uuid]))) k),
          array['as_of','categories','committed_complete','committed_total','complete','currency','excludes_restricted_rows','total'],
  'AC-1739-02 the collection actuals payload carries the keys the pmoSpendSplit.test.ts fixture mirrors');

-- ── An ERP-ledger org is untouched ────────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"07000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select (actuals->>'total')::numeric from public.get_projects_money_collection(array['07000000-0000-0000-0000-0000000000d3'::uuid])), 300::numeric,
  'AC-1739-07 an ERP-ledger org keeps its mapped ledger Actual (300), not the PMO paid amount');
select is((select ledger_basis from public.get_projects_money_collection(array['07000000-0000-0000-0000-0000000000d3'::uuid])), 'erp',
  'AC-1739-07 the ERP-ledger org still reads the ledger basis');
select is((select (value->>'spent')::numeric from json_array_elements(public.get_executive_dashboard()->'top_projects') value
           where value->>'id' = '07000000-0000-0000-0000-0000000000d3'), 300::numeric,
  'AC-1739-07 the executive dashboard keeps the ledger Actual for an ERP-ledger org');
select is((select (value->>'ledger_owned')::boolean from json_array_elements(public.get_finance_budget_review()) value
           where value->>'id' = '07000000-0000-0000-0000-0000000000d3'), true,
  'AC-1739-07 an ERP-ledger review row says so: its figure is the ledger Actual and stays labelled "Spent"');

reset role;
select * from finish();
rollback;
