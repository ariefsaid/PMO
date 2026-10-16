begin;
select plan(5);

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

reset role;
select * from finish();
rollback;
