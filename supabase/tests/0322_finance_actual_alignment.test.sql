begin;
select plan(36);

insert into public.organizations (id, name, default_currency) values
  ('03220000-0000-0000-0000-000000000001', 'Actual basis ERP org', 'IDR'),
  ('03220000-0000-0000-0000-000000000002', 'Actual basis PMO org', 'USD'),
  ('03220000-0000-0000-0000-000000000003', 'Actual basis disconnected org', 'USD'),
  ('03220000-0000-0000-0000-000000000004', 'Delivery comparison org', 'USD');
insert into auth.users (id, email) values
  ('03220000-0000-0000-0000-0000000000a1', 'finance-erp@example.test'),
  ('03220000-0000-0000-0000-0000000000a2', 'engineer-erp@example.test'),
  ('03220000-0000-0000-0000-0000000000a3', 'finance-pmo@example.test'),
  ('03220000-0000-0000-0000-0000000000a4', 'finance-disconnected@example.test'),
  ('03220000-0000-0000-0000-0000000000a5', 'finance-delivery@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('03220000-0000-0000-0000-0000000000a1', '03220000-0000-0000-0000-000000000001', 'Finance ERP', 'finance-erp@example.test', 'Finance', 'active'),
  ('03220000-0000-0000-0000-0000000000a2', '03220000-0000-0000-0000-000000000001', 'Engineer ERP', 'engineer-erp@example.test', 'Engineer', 'active'),
  ('03220000-0000-0000-0000-0000000000a3', '03220000-0000-0000-0000-000000000002', 'Finance PMO', 'finance-pmo@example.test', 'Finance', 'active'),
  ('03220000-0000-0000-0000-0000000000a4', '03220000-0000-0000-0000-000000000003', 'Finance disconnected', 'finance-disconnected@example.test', 'Finance', 'active'),
  ('03220000-0000-0000-0000-0000000000a5', '03220000-0000-0000-0000-000000000004', 'Finance delivery', 'finance-delivery@example.test', 'Finance', 'active');

insert into public.projects (id, org_id, name, status, currency, contract_value, budget, tax_treatment, tax_amount) values
  ('03220000-0000-0000-0000-000000000d01', '03220000-0000-0000-0000-000000000001', 'ERP poison fields', 'Ongoing Project', 'IDR', 1100, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d02', '03220000-0000-0000-0000-000000000002', 'PMO committed basis', 'Ongoing Project', 'USD', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d03', '03220000-0000-0000-0000-000000000003', 'Disconnected binding', 'Ongoing Project', 'USD', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d04', '03220000-0000-0000-0000-000000000002', 'Successful zero actual', 'Ongoing Project', 'USD', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d05', '03220000-0000-0000-0000-000000000002', 'Stored zero with Active budget', 'Ongoing Project', 'USD', 1000, 0, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d06', '03220000-0000-0000-0000-000000000002', 'Draft only', 'Ongoing Project', 'USD', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d07', '03220000-0000-0000-0000-000000000002', 'Empty Active budget', 'Ongoing Project', 'USD', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d08', '03220000-0000-0000-0000-000000000001', 'Missing current snapshot', 'Ongoing Project', 'IDR', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d09', '03220000-0000-0000-0000-000000000001', 'Unmapped Active category', 'Ongoing Project', 'IDR', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d10', '03220000-0000-0000-0000-000000000001', 'Null mapped amount', 'Ongoing Project', 'IDR', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d11', '03220000-0000-0000-0000-000000000001', 'Actual currency mismatch', 'Ongoing Project', 'USD', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d12', '03220000-0000-0000-0000-000000000001', 'Budget currency mismatch', 'Ongoing Project', 'IDR', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d13', '03220000-0000-0000-0000-000000000001', 'ERP actual zero', 'Ongoing Project', 'IDR', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d14', '03220000-0000-0000-0000-000000000001', 'Restricted actual visibility', 'Ongoing Project', 'IDR', 1000, 9999, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d20', '03220000-0000-0000-0000-000000000004', 'Won delivery', 'Won, Pending KoM', 'USD', 1000, 0, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d21', '03220000-0000-0000-0000-000000000004', 'Ongoing delivery one', 'Ongoing Project', 'USD', 900, 0, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d22', '03220000-0000-0000-0000-000000000004', 'On hold delivery', 'On Hold', 'USD', 800, 0, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d23', '03220000-0000-0000-0000-000000000004', 'Closed delivery', 'Close Out', 'USD', 700, 0, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d24', '03220000-0000-0000-0000-000000000004', 'Internal work', 'Internal Project', 'USD', 600, 0, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d25', '03220000-0000-0000-0000-000000000004', 'Ongoing delivery two', 'Ongoing Project', 'USD', 500, 0, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d26', '03220000-0000-0000-0000-000000000004', 'High value tender', 'Tender Submitted', 'USD', 9000, 0, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d27', '03220000-0000-0000-0000-000000000004', 'High value loss', 'Loss Tender', 'USD', 8000, 0, 'exclusive', 0),
  ('03220000-0000-0000-0000-000000000d28', '03220000-0000-0000-0000-000000000004', 'Open lead', 'Leads', 'USD', 7000, 0, 'exclusive', 0);
insert into public.projects (id, org_id, name, status, currency, contract_value, budget, tax_treatment, tax_amount) values
  ('03220000-0000-0000-0000-000000000d29', '03220000-0000-0000-0000-000000000001', 'Foreign high-value active project', 'Ongoing Project', 'IDR', 999999999, 0, 'exclusive', 0);

insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at) values
  ('03220000-0000-0000-0000-000000000001', 'erpnext', 'https://erp.example.test', 'test-ref', 'active', '03220000-0000-0000-0000-0000000000a1', now()),
  ('03220000-0000-0000-0000-000000000003', 'erpnext', 'https://erp.example.test', 'test-ref', 'disconnected', '03220000-0000-0000-0000-0000000000a4', now());
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('03220000-0000-0000-0000-000000000001', 'Labor', '0322-LABOR', true),
  ('03220000-0000-0000-0000-000000000001', 'Materials', '0322-MATERIALS', true);

insert into public.budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('03220000-0000-0000-0000-000000000c01', '03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d01', 1, 'Active ERP budget', 'Draft', 'IDR'),
  ('03220000-0000-0000-0000-000000000c02', '03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d01', 2, 'Draft ERP budget', 'Draft', 'IDR'),
  ('03220000-0000-0000-0000-000000000c08', '03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d08', 1, 'Active missing snapshot budget', 'Draft', 'IDR'),
  ('03220000-0000-0000-0000-000000000c09', '03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d09', 1, 'Active unmapped budget', 'Draft', 'IDR'),
  ('03220000-0000-0000-0000-000000000c10', '03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d10', 1, 'Active null amount budget', 'Draft', 'IDR'),
  ('03220000-0000-0000-0000-000000000c11', '03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d11', 1, 'Active currency mismatch budget', 'Draft', 'USD'),
  ('03220000-0000-0000-0000-000000000c12', '03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d12', 1, 'Active budget currency mismatch budget', 'Draft', 'USD'),
  ('03220000-0000-0000-0000-000000000c13', '03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d13', 1, 'Active zero actual budget', 'Draft', 'IDR'),
  ('03220000-0000-0000-0000-000000000c14', '03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d14', 1, 'Active restricted actual budget', 'Draft', 'IDR'),
  ('03220000-0000-0000-0000-000000000c20', '03220000-0000-0000-0000-000000000002', '03220000-0000-0000-0000-000000000d02', 1, 'Active PMO budget', 'Draft', 'USD'),
  ('03220000-0000-0000-0000-000000000c21', '03220000-0000-0000-0000-000000000003', '03220000-0000-0000-0000-000000000d03', 1, 'Active disconnected budget', 'Draft', 'USD'),
  ('03220000-0000-0000-0000-000000000c22', '03220000-0000-0000-0000-000000000002', '03220000-0000-0000-0000-000000000d04', 1, 'Active zero budget', 'Draft', 'USD'),
  ('03220000-0000-0000-0000-000000000c23', '03220000-0000-0000-0000-000000000002', '03220000-0000-0000-0000-000000000d05', 1, 'Active stored-zero budget', 'Draft', 'USD'),
  ('03220000-0000-0000-0000-000000000c24', '03220000-0000-0000-0000-000000000002', '03220000-0000-0000-0000-000000000d06', 1, 'Draft-only budget', 'Draft', 'USD'),
  ('03220000-0000-0000-0000-000000000c25', '03220000-0000-0000-0000-000000000002', '03220000-0000-0000-0000-000000000d07', 1, 'Empty Active version', 'Draft', 'USD');
insert into public.budget_line_items (org_id, budget_version_id, category, description, budgeted_amount) values
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000c01', 'Labor', 'Active amount', 100),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000c02', 'Labor', 'Draft poison', 900),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000c08', 'Labor', 'Missing snapshot amount', 100),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000c09', 'Subcontractors', 'Unmapped Active category', 100),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000c10', 'Materials', 'Null mapped amount', 100),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000c11', 'Labor', 'Currency comparison amount', 100),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000c12', 'Labor', 'Budget currency amount', 100),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000c13', 'Labor', 'Zero actual amount', 100),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000c14', 'Labor', 'Restricted actual amount', 100),
  ('03220000-0000-0000-0000-000000000002', '03220000-0000-0000-0000-000000000c20', 'Labor', 'PMO amount', 100),
  ('03220000-0000-0000-0000-000000000003', '03220000-0000-0000-0000-000000000c21', 'Labor', 'Disconnected amount', 100),
  ('03220000-0000-0000-0000-000000000002', '03220000-0000-0000-0000-000000000c22', 'Labor', 'Zero committed budget', 100),
  ('03220000-0000-0000-0000-000000000002', '03220000-0000-0000-0000-000000000c23', 'Labor', 'Stored zero actual budget', 100),
  ('03220000-0000-0000-0000-000000000002', '03220000-0000-0000-0000-000000000c24', 'Labor', 'Draft-only amount', 100),
  ('03220000-0000-0000-0000-000000000002', '03220000-0000-0000-0000-000000000c25', 'Labor', 'Empty Active amount', 0);

update public.budget_versions set status='Active', activated_at=now()
where id in (
  '03220000-0000-0000-0000-000000000c01','03220000-0000-0000-0000-000000000c08',
  '03220000-0000-0000-0000-000000000c09','03220000-0000-0000-0000-000000000c10',
  '03220000-0000-0000-0000-000000000c11','03220000-0000-0000-0000-000000000c12',
  '03220000-0000-0000-0000-000000000c13','03220000-0000-0000-0000-000000000c14',
  '03220000-0000-0000-0000-000000000c20','03220000-0000-0000-0000-000000000c21',
  '03220000-0000-0000-0000-000000000c22','03220000-0000-0000-0000-000000000c23',
  '03220000-0000-0000-0000-000000000c25'
);

insert into public.procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('03220000-0000-0000-0000-000000000f01', '03220000-0000-0000-0000-000000000001', 'ERP committed PO', 'Ordered', 75, '03220000-0000-0000-0000-000000000d01', '03220000-0000-0000-0000-0000000000a1'),
  ('03220000-0000-0000-0000-000000000f02', '03220000-0000-0000-0000-000000000001', 'ERP uncommitted PR', 'Requested', 9999, '03220000-0000-0000-0000-000000000d01', '03220000-0000-0000-0000-0000000000a1'),
  ('03220000-0000-0000-0000-000000000f03', '03220000-0000-0000-0000-000000000002', 'PMO committed PO', 'Paid', 75, '03220000-0000-0000-0000-000000000d02', '03220000-0000-0000-0000-0000000000a3'),
  ('03220000-0000-0000-0000-000000000f04', '03220000-0000-0000-0000-000000000003', 'Disconnected committed PO', 'Received', 75, '03220000-0000-0000-0000-000000000d03', '03220000-0000-0000-0000-0000000000a4'),
  ('03220000-0000-0000-0000-000000000f05', '03220000-0000-0000-0000-000000000002', 'PMO uncommitted PR', 'Requested', 9999, '03220000-0000-0000-0000-000000000d02', '03220000-0000-0000-0000-0000000000a3');
insert into public.erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at) values
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d01', '0322-LABOR', 'FY-2026', 9999, '2026-10-17T00:00:00Z', '03220000-0000-0000-0000-000000000b02', '2026-10-17T01:00:00Z'),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d01', '0322-LABOR', 'FY-2026', 120, '2026-10-18T00:00:00Z', '03220000-0000-0000-0000-000000000b01', '2026-10-18T01:00:00Z'),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d09', '0322-LABOR', 'FY-2026', 30, '2026-10-18T00:00:00Z', '03220000-0000-0000-0000-000000000b01', '2026-10-18T01:00:00Z'),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d10', '0322-MATERIALS', 'FY-2026', null, '2026-10-18T00:00:00Z', '03220000-0000-0000-0000-000000000b01', '2026-10-18T01:00:00Z'),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d11', '0322-LABOR', 'FY-2026', 120, '2026-10-18T00:00:00Z', '03220000-0000-0000-0000-000000000b01', '2026-10-18T01:00:00Z'),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d12', '0322-LABOR', 'FY-2026', 120, '2026-10-18T00:00:00Z', '03220000-0000-0000-0000-000000000b01', '2026-10-18T01:00:00Z'),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d13', '0322-LABOR', 'FY-2026', 0, '2026-10-18T00:00:00Z', '03220000-0000-0000-0000-000000000b01', '2026-10-18T01:00:00Z'),
  ('03220000-0000-0000-0000-000000000001', '03220000-0000-0000-0000-000000000d14', '0322-LABOR', 'FY-2026', 33, '2026-10-18T00:00:00Z', '03220000-0000-0000-0000-000000000b01', '2026-10-18T01:00:00Z');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03220000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select (entry->>'budget')::numeric from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d01'),
          100::numeric, 'AC-FAA-001: Active lines replace stored and Draft budget amounts');
select is((select entry->>'budget_currency' from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d01'),
          'IDR', 'AC-FAA-001: Active budget currency is reported with the amount');
select is((select (entry->>'spent')::numeric from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d01'),
          120::numeric, 'AC-FAA-001: active ERP binding uses current mapped Actual, not the committed PO');
select is((select (entry->>'variance')::numeric from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d01'),
          20::numeric, 'AC-FAA-001: compatible Actual less Active budget is the displayed variance');
select ok(not exists(select 1 from json_array_elements(public.get_finance_budget_review()) as facts(entry)
                     where entry->>'id' in ('03220000-0000-0000-0000-000000000d02','03220000-0000-0000-0000-000000000d03')),
          'AC-FAA-009: Finance reader cannot return rows from a different organization');
select is((select entry->>'spent' from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d01'),
          public.get_project_finances('03220000-0000-0000-0000-000000000d01'::uuid)->'actuals'->>'total',
          'AC-FAA-002: ERP source amount agrees with the caller-visible project-finances Actual');
select is((select entry->>'actual_currency' from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d01'),
          'IDR', 'AC-FAA-002: ERP Actual retains source currency');
select is((select entry->>'actual_as_of' from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d01')::timestamptz,
          '2026-10-18T00:00:00Z'::timestamptz, 'AC-FAA-002: ERP Actual retains current-generation freshness');
select is((select (entry->>'actual_coverage_count')::int from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d01'),
          2, 'AC-FAA-002: coverage counts mapped categories with known source amounts');
select is((select (entry->>'actual_coverage_total')::int from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d01'),
          2, 'AC-FAA-002: coverage total counts mapped categories');
select is((select entry->>'actual_complete' from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d01'),
          'true', 'AC-FAA-002: complete visible ERP Actual is marked complete');
set local request.jwt.claims = '{"sub":"03220000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select (entry->>'spent')::numeric from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d02'),
          75::numeric, 'AC-FAA-001: org with no ERP binding uses committed PMO POs including Paid');
set local request.jwt.claims = '{"sub":"03220000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select (entry->>'spent')::numeric from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d03'),
          75::numeric, 'AC-FAA-001: disconnected ERP binding uses committed PMO POs');
set local request.jwt.claims = '{"sub":"03220000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select (entry->>'spent')::numeric from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d04'),
          0::numeric, 'AC-FAA-002: successful no-PO PMO read preserves a genuine zero Actual');
select ok(exists(select 1 from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d05'),
          'AC-FAA-001: stored zero does not hide a positive Active-line budget');
select ok(not exists(select 1 from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id' in ('03220000-0000-0000-0000-000000000d06','03220000-0000-0000-0000-000000000d07')),
          'AC-FAA-001: Draft-only and empty Active budgets are excluded');
set local request.jwt.claims = '{"sub":"03220000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select entry->>'spent' from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d08'),
          null, 'AC-FAA-002: absent current-generation project rows do not become zero');
select is((select (entry->>'actual_coverage_count')::int from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d08'),
          0, 'AC-FAA-002: absent current-generation project rows retain zero known coverage');
select is((select entry->>'spent' from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d09'),
          null, 'AC-FAA-002: an unmapped required Active category makes the whole Actual unavailable');
select is((select entry->>'spent' from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d10'),
          null, 'AC-FAA-002: a mapped null source amount remains unknown');
select is((select (entry->>'spent')::numeric from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d11'),
          120::numeric, 'AC-FAA-002: a complete cross-currency source amount remains displayable');
select ok(not exists(select 1 from json_array_elements(public.get_finance_budget_review()) as facts(entry)
                     where entry->>'id' in ('03220000-0000-0000-0000-000000000d11','03220000-0000-0000-0000-000000000d12')
                       and entry->>'variance' is not null),
          'AC-FAA-002: project or Active-budget currency mismatch withholds variance for both projects');
select is((select (entry->>'spent')::numeric from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d13'),
          0::numeric, 'AC-FAA-002: mapped ledger zero remains a known Actual');
select is((select (entry->>'variance')::numeric from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d13'),
          -100::numeric, 'AC-FAA-002: known zero Actual has a valid negative variance');
set local request.jwt.claims = '{"sub":"03220000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select entry->>'spent' from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d14'),
          null, 'AC-FAA-002: role-restricted Actual rows are not presented as complete');
select is((select entry->>'actual_complete' from json_array_elements(public.get_finance_budget_review()) as facts(entry) where entry->>'id'='03220000-0000-0000-0000-000000000d14'),
          'false', 'AC-FAA-002: restricted source visibility is included in completeness');

set local request.jwt.claims = '{"sub":"03220000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(array(select value->>'id' from json_array_elements(public.get_executive_dashboard()->'top_projects') with ordinality as result(value, ord) order by ord),
          array['03220000-0000-0000-0000-000000000d20','03220000-0000-0000-0000-000000000d21','03220000-0000-0000-0000-000000000d22','03220000-0000-0000-0000-000000000d23','03220000-0000-0000-0000-000000000d24']::text[],
          'AC-FAA-005: eligible delivery rows are filtered before the five-row limit');
select ok(not exists(
  select 1 from json_array_elements(public.get_executive_dashboard()->'top_projects') as project
   where project->>'id'='03220000-0000-0000-0000-000000000d29'),
  'AC-FAA-009: delivery Finance dashboard excludes a foreign high-value project');
select is((public.get_executive_dashboard()->>'pipeline_total_value')::numeric, 16000::numeric,
          'AC-FAA-005: pipeline aggregate still includes the high-value open stages');
select is((public.get_executive_dashboard()->>'on_hand_value')::numeric, 3900::numeric,
          'AC-FAA-005: on-hand aggregate remains limited to its original status set');
select is((public.get_executive_dashboard()->>'active_projects')::int, 2,
          'AC-FAA-005: active-project aggregate remains independent of chart population');

select ok(not (select prosecdef from pg_proc where oid='public.get_executive_dashboard()'::regprocedure),
          'AC-FAA-009: executive RPC remains SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid='public.get_finance_budget_review()'::regprocedure),
          'AC-FAA-009: finance RPC remains SECURITY INVOKER');
select ok((select provolatile = 's' and proconfig @> array['search_path=public']
           from pg_proc where oid='public.get_executive_dashboard()'::regprocedure),
          'AC-FAA-009: executive RPC remains stable with its fixed search path');
select ok((select provolatile = 's' and proconfig @> array['search_path=public']
           from pg_proc where oid='public.get_finance_budget_review()'::regprocedure),
          'AC-FAA-009: finance RPC remains stable with its fixed search path');
select ok(has_function_privilege('authenticated','public.get_executive_dashboard()','EXECUTE')
          and has_function_privilege('authenticated','public.get_finance_budget_review()','EXECUTE')
          and not has_function_privilege('anon','public.get_executive_dashboard()','EXECUTE')
          and not has_function_privilege('anon','public.get_finance_budget_review()','EXECUTE'),
          'AC-FAA-009: existing authenticated-only read audience remains unchanged');

reset role;
select * from finish();
rollback;
