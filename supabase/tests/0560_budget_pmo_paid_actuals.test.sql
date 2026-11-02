-- AC-1530: project actuals keep the ERP ledger for ledger-reading orgs and use PMO paid payments otherwise.
begin;
create extension if not exists pgtap;
select plan(16);

insert into public.organizations (id, name, default_currency) values
  ('05600000-0000-0000-0000-000000000001', 'ERP actuals org', 'USD'),
  ('05600000-0000-0000-0000-000000000002', 'PMO actuals org', 'IDR'),
  ('05600000-0000-0000-0000-000000000003', 'Foreign actuals org', 'USD');
insert into auth.users (id, email) values
  ('05600000-0000-0000-0000-0000000000a1', 'budget-erp@example.test'),
  ('05600000-0000-0000-0000-0000000000a2', 'budget-pmo@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('05600000-0000-0000-0000-0000000000a1', '05600000-0000-0000-0000-000000000001', 'ERP Admin', 'budget-erp@example.test', 'Admin', 'active'),
  ('05600000-0000-0000-0000-0000000000a2', '05600000-0000-0000-0000-000000000002', 'PMO Admin', 'budget-pmo@example.test', 'Admin', 'active');
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount,
                             tax_rate, tax_base_numerator, tax_base_denominator, subject_to_vat) values
  ('05600000-0000-0000-0000-0000000000d1', '05600000-0000-0000-0000-000000000001', 'Ledger project', 'Ongoing Project', 'USD', 1000, 'exclusive', 0, 0, 1, 1, false),
  ('05600000-0000-0000-0000-0000000000d2', '05600000-0000-0000-0000-000000000002', 'PMO project', 'Ongoing Project', 'USD', 1000, 'exclusive', 0, 0, 1, 1, false),
  ('05600000-0000-0000-0000-0000000000d3', '05600000-0000-0000-0000-000000000003', 'Foreign project', 'Ongoing Project', 'USD', 1000, 'exclusive', 0, 0, 1, 1, false);
insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
values ('05600000-0000-0000-0000-000000000001', 'erpnext', 'https://erp.example.test', 'test-ref', 'active',
        '05600000-0000-0000-0000-0000000000a1', now());

set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target)
values ('05600000-0000-0000-0000-000000000001', 'Labor', '0560-LABOR', true);
insert into public.erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at)
values ('05600000-0000-0000-0000-000000000001', '05600000-0000-0000-0000-0000000000d1', '0560-LABOR', 'FY-2026', 125,
        '2026-10-01', '05600000-0000-0000-0000-0000000000e1', '2026-10-02');
insert into public.procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, origin) values
  ('05600000-0000-0000-0000-0000000000f1', '05600000-0000-0000-0000-000000000002', 'PMO paid procurement', 'Paid', 60,
   '05600000-0000-0000-0000-0000000000d2', 'USD', 'Labor', null),
  ('05600000-0000-0000-0000-0000000000f2', '05600000-0000-0000-0000-000000000001', 'ERP org PMO payment', 'Paid', 700,
   '05600000-0000-0000-0000-0000000000d1', 'USD', 'Labor', null),
  ('05600000-0000-0000-0000-0000000000f3', '05600000-0000-0000-0000-000000000003', 'Foreign payment attached to PMO project', 'Paid', 999,
   '05600000-0000-0000-0000-0000000000d2', 'USD', 'Labor', null);
insert into public.procurement_invoices (id, org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount)
values ('05600000-0000-0000-0000-0000000000b1', '05600000-0000-0000-0000-000000000002',
        '05600000-0000-0000-0000-0000000000f1', 'Paid', 60, 'USD', 'inclusive', 0),
       ('05600000-0000-0000-0000-0000000000b2', '05600000-0000-0000-0000-000000000001',
        '05600000-0000-0000-0000-0000000000f2', 'Paid', 700, 'USD', 'inclusive', 0);
insert into public.payments (id, org_id, procurement_id, invoice_id, status, date, amount, currency) values
  ('05600000-0000-0000-0000-0000000000c1', '05600000-0000-0000-0000-000000000002',
   '05600000-0000-0000-0000-0000000000f1', '05600000-0000-0000-0000-0000000000b1', 'Paid', '2026-10-10', 30, 'USD'),
  ('05600000-0000-0000-0000-0000000000c2', '05600000-0000-0000-0000-000000000002',
   '05600000-0000-0000-0000-0000000000f1', null, 'Paid', '2026-10-11', 30, 'USD'),
  ('05600000-0000-0000-0000-0000000000c3', '05600000-0000-0000-0000-000000000002',
   '05600000-0000-0000-0000-0000000000f1', null, 'Scheduled', '2026-10-12', 80, 'USD'),
  ('05600000-0000-0000-0000-0000000000c4', '05600000-0000-0000-0000-000000000001',
   '05600000-0000-0000-0000-0000000000f2', '05600000-0000-0000-0000-0000000000b2', 'Paid', '2026-10-11', 700, 'USD'),
  ('05600000-0000-0000-0000-0000000000c5', '05600000-0000-0000-0000-000000000003',
   '05600000-0000-0000-0000-0000000000f3', null, 'Paid', '2026-10-11', 999, 'USD');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"05600000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select public.procurement_open_commitment(p) from public.procurements p where p.id = '05600000-0000-0000-0000-0000000000f1'), 0::numeric, 'AC-1530 fully paid commitment is zero');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"05600000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('05600000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric, 125::numeric,
  'AC-1530 ledger org keeps its mapped ledger total when PMO payments also exist');
select is((select (c->>'amount')::numeric from jsonb_array_elements(public.get_project_finances('05600000-0000-0000-0000-0000000000d1')->'actuals'->'categories') c
           where c->>'category' = 'Labor'), 125::numeric,
  'AC-1530 ledger org keeps its mapped category amount');
select is((select public.procurement_open_commitment(p) from public.procurements p where p.id = '05600000-0000-0000-0000-0000000000f2'), 700::numeric, 'AC-1530 ledger commitment remains unchanged');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"05600000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select 100 - (public.get_project_finances(p.project_id)->'actuals'->>'total')::numeric - public.procurement_open_commitment(p) from public.procurements p where p.id = '05600000-0000-0000-0000-0000000000f1'), 40::numeric, 'AC-1530 fully paid spending and open commitment leave correct headroom');
select is((public.get_project_finances('05600000-0000-0000-0000-0000000000d2')->'actuals'->>'total')::numeric, 60::numeric,
  'AC-1530 PMO-only total sums paid payments once, excluding the invoice duplicate and scheduled payment');
select is((select (c->>'amount')::numeric from jsonb_array_elements(public.get_project_finances('05600000-0000-0000-0000-0000000000d2')->'actuals'->'categories') c
           where c->>'category' = 'Labor'), 60::numeric,
  'AC-1530 PMO-only paid payments are attributed through the procurement budget category');
select is((select (c->>'mapped')::boolean from jsonb_array_elements(public.get_project_finances('05600000-0000-0000-0000-0000000000d2')->'actuals'->'categories') c
           where c->>'category' = 'Labor'), true,
  'AC-1530 a categorized PMO payment makes its budget category known');
select is((select (c->>'amount')::numeric from jsonb_array_elements(public.get_project_finances('05600000-0000-0000-0000-0000000000d2')->'actuals'->'categories') c
           where c->>'category' = 'Materials'), 0::numeric,
  'AC-1530 a PMO category without paid payments is a known zero');
select is((select (c->>'mapped')::boolean from jsonb_array_elements(public.get_project_finances('05600000-0000-0000-0000-0000000000d2')->'actuals'->'categories') c
           where c->>'category' = 'Materials'), true,
  'AC-1530 the PMO read marks categories without payment rows as known');
select is(public.get_project_finances('05600000-0000-0000-0000-0000000000d2')->'actuals'->>'currency', 'USD',
  'AC-1530 PMO actuals use the project currency rather than the org default currency');
select throws_ok($$select public.get_project_finances('05600000-0000-0000-0000-0000000000d3')$$, 'P0002', null,
  'AC-1530 a project owned by another org exposes no finance rows');
reset role;
set local role service_role;
update public.payments set status = 'Scheduled' where id = '05600000-0000-0000-0000-0000000000c2';
reset role;
set local role authenticated;
select is((select public.procurement_open_commitment(p) from public.procurements p where p.id = '05600000-0000-0000-0000-0000000000f1'), 30::numeric, 'AC-1530 partially paid commitment is the remaining balance');
select is((select 100 - (public.get_project_finances(p.project_id)->'actuals'->>'total')::numeric - public.procurement_open_commitment(p) from public.procurements p where p.id = '05600000-0000-0000-0000-0000000000f1'), 40::numeric, 'AC-1530 partially paid spending and open commitment leave correct headroom');
reset role;

select ok(not has_function_privilege('anon', 'public.get_project_finances(uuid)', 'EXECUTE'),
  'AC-1530 project-finance RPC remains unavailable to anonymous callers');
select ok(not coalesce(has_function_privilege('anon', to_regprocedure('public.project_finance_actuals(uuid)'), 'EXECUTE'), false),
  'AC-1530 the supporting actuals reader remains unavailable to anonymous callers');
select * from finish();
rollback;
