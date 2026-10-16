begin;
select plan(15);

insert into public.organizations (id,name) values
  ('02970000-0000-0000-0000-000000000001','Dashboard money language test org');
insert into auth.users (id,email) values
  ('02970000-0000-0000-0000-0000000000a1','dashboard-money@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
  ('02970000-0000-0000-0000-0000000000a1','02970000-0000-0000-0000-000000000001',
   'Dashboard Reader','dashboard-money@example.test','Executive','active');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,
                             tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat)
values
  ('02970000-0000-0000-0000-0000000000d1','02970000-0000-0000-0000-000000000001',
   'Ledger without snapshot','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false),
  ('02970000-0000-0000-0000-0000000000d2','02970000-0000-0000-0000-000000000001',
   'Pipeline with draft budget','Negotiation','USD',5000,'exclusive',0,0,1,1,false);
insert into public.budget_versions (id,org_id,project_id,version,name,status)
values ('02970000-0000-0000-0000-0000000000b1','02970000-0000-0000-0000-000000000001',
        '02970000-0000-0000-0000-0000000000d2',1,'Draft only','Draft');
insert into public.budget_line_items (id,org_id,budget_version_id,category,description,budgeted_amount)
values ('02970000-0000-0000-0000-0000000000c1','02970000-0000-0000-0000-000000000001',
        '02970000-0000-0000-0000-0000000000b1','Labor','Draft estimate',1000);
insert into public.external_domain_ownership (org_id,external_tier,domain)
values ('02970000-0000-0000-0000-000000000001','erpnext','ledger::gl_entries');
insert into public.organizations (id,name)
values ('02970000-0000-0000-0000-000000000002','Foreign dashboard org');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,
                             tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat)
values ('02970000-0000-0000-0000-0000000000df','02970000-0000-0000-0000-000000000002',
        'Foreign project','Ongoing Project','USD',900000,'exclusive',0,0,1,1,false);
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,
                             tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat)
values
  ('02970000-0000-0000-0000-0000000000d3','02970000-0000-0000-0000-000000000001',
   'Known mapped actual','Ongoing Project','USD',2000,'exclusive',0,0,1,1,false),
  ('02970000-0000-0000-0000-0000000000d4','02970000-0000-0000-0000-000000000001',
   'Other currency','Ongoing Project','IDR',3000,'exclusive',0,0,1,1,false);
insert into public.budget_category_account_map (org_id,category,erp_account,is_push_target)
values ('02970000-0000-0000-0000-000000000001','Labor','0297-LABOR',true);
insert into public.erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at)
values ('02970000-0000-0000-0000-000000000001','02970000-0000-0000-0000-0000000000d3',
        '0297-LABOR','FY-2026',120,'2026-10-01','02970000-0000-0000-0000-0000000000b1','2026-10-02');
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,tax_treatment,tax_amount,
                                  currency,status,erp_docstatus)
values ('02970000-0000-0000-0000-0000000000e1','02970000-0000-0000-0000-000000000001',
        '02970000-0000-0000-0000-0000000000d3','SI-0297','2026-10-03',300,'exclusive',0,
        'USD','Submitted',1);

set local role authenticated;
set local request.jwt.claims to '{"sub":"02970000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select value->>'spent' from json_array_elements(get_executive_dashboard()->'top_projects') value
           where value->>'name'='Ledger without snapshot'), null,
  'AC-UX-S03-01: missing ERP ledger coverage stays unknown, not zero');
select is((select value->>'currency' from json_array_elements(get_executive_dashboard()->'top_projects') value
           where value->>'name'='Ledger without snapshot'), 'USD',
  'AC-UX-S03-02: project money retains its currency');
select ok((get_executive_dashboard()::jsonb ? 'on_hand_contract_remaining'),
  'AC-UX-S03-03: contract remaining is named distinctly from profit');
select ok((get_executive_dashboard()::jsonb ? 'on_hand_actual_coverage_count'),
  'AC-UX-S03-04: aggregate reports Actual coverage');
select is((get_executive_dashboard()->>'pipeline_projected_margin'),null,
  'AC-UX-S03-05: Draft budget does not create a pipeline forecast margin (DD-MONEY-4)');
select is((select (value->>'spent')::numeric from json_array_elements(get_executive_dashboard()->'top_projects') value
           where value->>'name'='Known mapped actual'),120::numeric,
  'AC-UX-S03-06: ERP-ledger Actual is the known mapped ledger sum');
select is((select (value->>'realized_margin')::numeric from json_array_elements(get_executive_dashboard()->'top_projects') value
           where value->>'name'='Known mapped actual'),180::numeric,
  'AC-UX-S03-07: realized margin is billed-work revenue less mapped Actual');
select is((select (value->>'known_amount')::numeric
           from json_array_elements(get_executive_dashboard()->'on_hand_realized_margin_by_currency') value
           where value->>'currency'='USD'),180::numeric,
  'AC-UX-S03-08: per-currency aggregate preserves known realized margin subtotal');
select is((get_executive_dashboard()->>'on_hand_actual_coverage_count')::int,1,
  'AC-UX-S03-09: aggregate coverage count includes only known Actual');
select is((get_executive_dashboard()->>'on_hand_actual_coverage_total')::int,3,
  'AC-UX-S03-10: aggregate coverage total exposes unknown project Actuals');
select is((select (value->>'unknown_projects')::int
           from json_array_elements(get_executive_dashboard()->'on_hand_realized_margin_by_currency') value
           where value->>'currency'='USD'),1,
  'AC-UX-S03-11: unavailable project profit is counted, not silently treated as zero');
select is((get_executive_dashboard()->>'on_hand_value'),null,
  'AC-UX-S03-12: mixed-currency contract values are never summed');
select is(json_array_length(get_executive_dashboard()->'on_hand_value_by_currency'),2,
  'AC-UX-S03-13: mixed-currency contract totals remain available by currency');
select ok(not has_function_privilege('anon','public.get_executive_dashboard()','EXECUTE')
          and has_function_privilege('authenticated','public.get_executive_dashboard()','EXECUTE'),
  'AC-UX-S03-14: dashboard RPC execute grants preserve 0286 authorization boundary');
select is((get_executive_dashboard()->>'active_projects')::int,3,
  'AC-UX-S03-15: security-invoker dashboard remains scoped to the caller organization as in 0286');

reset role;
select * from finish();
rollback;
