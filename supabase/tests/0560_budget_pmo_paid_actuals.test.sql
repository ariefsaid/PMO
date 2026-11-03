-- AC-1530: project actuals keep the ERP ledger for ledger-reading orgs and use PMO paid payments otherwise.
begin;
create extension if not exists pgtap;
select plan(23);

insert into public.organizations (id, name, default_currency) values
  ('05600000-0000-0000-0000-000000000001', 'ERP actuals org', 'USD'),
  ('05600000-0000-0000-0000-000000000002', 'PMO actuals org', 'IDR'),
  ('05600000-0000-0000-0000-000000000003', 'Foreign actuals org', 'USD'),
  ('05600000-0000-0000-0000-000000000004', 'Disconnected ledger org', 'IDR');
insert into auth.users (id, email) values
  ('05600000-0000-0000-0000-0000000000a1', 'budget-erp@example.test'),
  ('05600000-0000-0000-0000-0000000000a2', 'budget-pmo@example.test'),
  ('05600000-0000-0000-0000-0000000000a3', 'budget-disconnected@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('05600000-0000-0000-0000-0000000000a1', '05600000-0000-0000-0000-000000000001', 'ERP Admin', 'budget-erp@example.test', 'Admin', 'active'),
  ('05600000-0000-0000-0000-0000000000a2', '05600000-0000-0000-0000-000000000002', 'PMO Admin', 'budget-pmo@example.test', 'Admin', 'active'),
  ('05600000-0000-0000-0000-0000000000a3', '05600000-0000-0000-0000-000000000004', 'Disconnected Admin', 'budget-disconnected@example.test', 'Admin', 'active');
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount,
                             tax_rate, tax_base_numerator, tax_base_denominator, subject_to_vat) values
  ('05600000-0000-0000-0000-0000000000d1', '05600000-0000-0000-0000-000000000001', 'Ledger project', 'Ongoing Project', 'USD', 1000, 'exclusive', 0, 0, 1, 1, false),
  ('05600000-0000-0000-0000-0000000000d2', '05600000-0000-0000-0000-000000000002', 'PMO project', 'Ongoing Project', 'USD', 1000, 'exclusive', 0, 0, 1, 1, false),
  ('05600000-0000-0000-0000-0000000000d3', '05600000-0000-0000-0000-000000000003', 'Foreign project', 'Ongoing Project', 'USD', 1000, 'exclusive', 0, 0, 1, 1, false),
  ('05600000-0000-0000-0000-0000000000d4', '05600000-0000-0000-0000-000000000004', 'Disconnected project', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0, 0, 1, 1, false),
  ('05600000-0000-0000-0000-0000000000d5', '05600000-0000-0000-0000-000000000002', 'PMO VAT project', 'Ongoing Project', 'USD', 1000, 'exclusive', 0, 0, 1, 1, false);
insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
values ('05600000-0000-0000-0000-000000000001', 'erpnext', 'https://erp.example.test', 'test-ref', 'active',
        '05600000-0000-0000-0000-0000000000a1', now()),
       ('05600000-0000-0000-0000-000000000004', 'erpnext', 'https://erp.example.test', 'test-ref', 'disconnected',
        '05600000-0000-0000-0000-0000000000a3', now());

set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target)
values ('05600000-0000-0000-0000-000000000001', 'Labor', '0560-LABOR', true),
       ('05600000-0000-0000-0000-000000000004', 'Labor', '0560-LABOR', true);
insert into public.erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at)
values ('05600000-0000-0000-0000-000000000001', '05600000-0000-0000-0000-0000000000d1', '0560-LABOR', 'FY-2026', 125,
        '2026-10-01', '05600000-0000-0000-0000-0000000000e1', '2026-10-02'),
       ('05600000-0000-0000-0000-000000000004', '05600000-0000-0000-0000-0000000000d4', '0560-LABOR', 'FY-2026', 1000,
        '2026-10-01', '05600000-0000-0000-0000-0000000000e4', '2026-10-02');
insert into public.procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, origin) values
  ('05600000-0000-0000-0000-0000000000f1', '05600000-0000-0000-0000-000000000002', 'PMO paid procurement', 'Paid', 60,
   '05600000-0000-0000-0000-0000000000d2', 'USD', 'Labor', null),
  ('05600000-0000-0000-0000-0000000000f2', '05600000-0000-0000-0000-000000000001', 'ERP org PMO payment', 'Paid', 700,
   '05600000-0000-0000-0000-0000000000d1', 'USD', 'Labor', null),
  ('05600000-0000-0000-0000-0000000000f3', '05600000-0000-0000-0000-000000000003', 'Foreign payment attached to PMO project', 'Paid', 999,
   '05600000-0000-0000-0000-0000000000d2', 'USD', 'Labor', null),
  ('05600000-0000-0000-0000-0000000000f4', '05600000-0000-0000-0000-000000000004', 'Ledger-posted purchase after disconnect', 'Paid', 1000,
   '05600000-0000-0000-0000-0000000000d4', 'IDR', 'Labor', null),
  ('05600000-0000-0000-0000-0000000000f5', '05600000-0000-0000-0000-000000000002', 'PMO purchase with exclusive VAT', 'Paid', 1000,
   '05600000-0000-0000-0000-0000000000d5', 'USD', 'Materials', null);
insert into public.procurement_invoices (id, org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount)
values ('05600000-0000-0000-0000-0000000000b1', '05600000-0000-0000-0000-000000000002',
        '05600000-0000-0000-0000-0000000000f1', 'Paid', 60, 'USD', 'inclusive', 0),
       ('05600000-0000-0000-0000-0000000000b2', '05600000-0000-0000-0000-000000000001',
        '05600000-0000-0000-0000-0000000000f2', 'Paid', 700, 'USD', 'inclusive', 0),
       ('05600000-0000-0000-0000-0000000000b4', '05600000-0000-0000-0000-000000000004',
        '05600000-0000-0000-0000-0000000000f4', 'Paid', 1000, 'IDR', 'inclusive', 0),
       ('05600000-0000-0000-0000-0000000000b5', '05600000-0000-0000-0000-000000000002',
        '05600000-0000-0000-0000-0000000000f5', 'Paid', 1000, 'USD', 'exclusive', 110);
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
   '05600000-0000-0000-0000-0000000000f3', null, 'Paid', '2026-10-11', 999, 'USD'),
  ('05600000-0000-0000-0000-0000000000c7', '05600000-0000-0000-0000-000000000002',
   '05600000-0000-0000-0000-0000000000f5', '05600000-0000-0000-0000-0000000000b5', 'Paid', '2026-10-11', 1110, 'USD');
-- An ERP-mirrored payment (submitted in the ERP, no PMO origin) whose invoice the old ledger snapshot already holds.
insert into public.payments (id, org_id, procurement_id, invoice_id, status, date, amount, currency, erp_docstatus) values
  ('05600000-0000-0000-0000-0000000000c6', '05600000-0000-0000-0000-000000000004',
   '05600000-0000-0000-0000-0000000000f4', '05600000-0000-0000-0000-0000000000b4', 'Paid', '2026-10-11', 1000, 'IDR', 1);
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

-- A disconnected binding selects the PMO basis (0307): the old ledger snapshot is not read, so the paid
-- 1,000 invoice counts once.
set local role authenticated;
set local request.jwt.claims = '{"sub":"05600000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((public.get_project_finances('05600000-0000-0000-0000-0000000000d4')->'actuals'->>'total')::numeric, 1000::numeric,
  'AC-1530 a disconnected org counts a ledger-posted, paid 1,000 purchase once, not snapshot plus payment');
select is((select (c->>'amount')::numeric from jsonb_array_elements(public.get_project_finances('05600000-0000-0000-0000-0000000000d4')->'actuals'->'categories') c
           where c->>'category' = 'Labor'), 1000::numeric,
  'AC-1530 the disconnected org''s category amount is the paid purchase only');
reset role;

-- Paid spend is compared on the pre-tax basis of the budget and the order total: a 1,000 invoice with 110
-- exclusive VAT paid in full (1,110) is 1,000 spent.
set local role authenticated;
set local request.jwt.claims = '{"sub":"05600000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((public.get_project_finances('05600000-0000-0000-0000-0000000000d5')->'actuals'->>'total')::numeric, 1000::numeric,
  'AC-1530 a fully paid invoice with exclusive VAT is spent at its pre-tax amount');
select is((select public.procurement_open_commitment(p) from public.procurements p where p.id = '05600000-0000-0000-0000-0000000000f5'), 0::numeric,
  'AC-1530 a fully paid invoice with exclusive VAT leaves no open commitment');
reset role;
set local role service_role;
update public.payments set amount = 555 where id = '05600000-0000-0000-0000-0000000000c7';
reset role;
set local role authenticated;
select is((public.get_project_finances('05600000-0000-0000-0000-0000000000d5')->'actuals'->>'total')::numeric, 500::numeric,
  'AC-1530 half of a VAT-bearing invoice paid is half its pre-tax amount spent');
select is((select public.procurement_open_commitment(p) from public.procurements p where p.id = '05600000-0000-0000-0000-0000000000f5'), 500::numeric,
  'AC-1530 half of a VAT-bearing invoice paid leaves half its pre-tax amount committed');
reset role;
set local role service_role;
update public.payments set currency = 'IDR' where id = '05600000-0000-0000-0000-0000000000c7';
reset role;
set local role authenticated;
select is((select public.procurement_open_commitment(p) from public.procurements p where p.id = '05600000-0000-0000-0000-0000000000f5'), 1000::numeric,
  'AC-1530 a paid amount in another currency keeps the full order total committed rather than dropping it');
reset role;

select ok(not has_function_privilege('anon', 'public.get_project_finances(uuid)', 'EXECUTE'),
  'AC-1530 project-finance RPC remains unavailable to anonymous callers');
select ok(not coalesce(has_function_privilege('anon', to_regprocedure('public.project_finance_actuals(uuid)'), 'EXECUTE'), false),
  'AC-1530 the supporting actuals reader remains unavailable to anonymous callers');
select * from finish();
rollback;
