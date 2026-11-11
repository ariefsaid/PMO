-- Round trip for 0381 (dashboard Actual completeness for a project with no Active budget): down, then up again.
-- Run by scripts/test-dashboard-unbudgeted-actual-rollback.sh, which inlines the migration files at the markers.
-- The down half is the mutation check: on the 0376 rule an unbudgeted project with complete coverage is withheld.
begin;
select plan(10);
insert into organizations (id,name,default_currency) values ('03819100-0000-0000-0000-00000000000a','UNB RT','IDR');
insert into auth.users (id,email) values ('03819100-0000-0000-0000-0000000000a1','unb-rt@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values
  ('03819100-0000-0000-0000-0000000000a1','03819100-0000-0000-0000-00000000000a','RT Exec','unb-rt@example.test','Executive','active');
insert into external_org_bindings (org_id,external_tier,site_url,secret_ref,status,connected_by,connected_at)
values ('03819100-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref','active',
        '03819100-0000-0000-0000-0000000000a1',now());
insert into projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,
                      tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat,project_manager_id) values
  ('03819100-0000-0000-0000-0000000000d1','03819100-0000-0000-0000-00000000000a','RT unbudgeted','Ongoing Project','IDR',5000,'exclusive',0,0,1,1,false,'03819100-0000-0000-0000-0000000000a1');
insert into budget_category_account_map (org_id,category,erp_account,is_push_target)
select '03819100-0000-0000-0000-00000000000a',c,'0381RT-'||c::text,true from unnest(enum_range(null::budget_category)) c;
insert into erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at) values
  ('03819100-0000-0000-0000-00000000000a','03819100-0000-0000-0000-0000000000d1','0381RT-Labor','FY-2026',700,'2026-10-01','03819100-0000-0000-0000-0000000000e1','2026-10-02');
-- @0381_DOWN@
set local role authenticated;
set local request.jwt.claims = '{"sub":"03819100-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select value->>'actual_complete' from json_array_elements(get_executive_dashboard()->'top_projects') value), 'false',
  'down 0381 (mutation check): the 0376 executive rule withholds the unbudgeted Actual');
select is((select value->>'actual_complete' from json_array_elements(get_pm_dashboard_projects()) value), 'false',
  'down 0381 (mutation check): the 0376 PM rule withholds the unbudgeted Actual');
reset role;
select ok(pg_get_functiondef('public.get_executive_dashboard()'::regprocedure) not like '%0381%', 'down 0381: the 0376 executive body');
select ok(pg_get_functiondef('public.get_pm_dashboard_projects()'::regprocedure) not like '%0381%', 'down 0381: the 0376 PM body');
-- @0381_UP@
set local role authenticated;
set local request.jwt.claims = '{"sub":"03819100-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select value->>'actual_complete' from json_array_elements(get_executive_dashboard()->'top_projects') value), 'true',
  'up again: the executive dashboard shows the unbudgeted Actual');
select is((select value->>'actual_complete' from json_array_elements(get_pm_dashboard_projects()) value), 'true',
  'up again: the PM dashboard shows the unbudgeted Actual');
reset role;
select ok(has_function_privilege('authenticated', 'public.get_executive_dashboard()', 'execute'), 'up again: authenticated reads the executive dashboard');
select ok(not has_function_privilege('anon', 'public.get_executive_dashboard()', 'execute'), 'up again: anon cannot read the executive dashboard');
select ok(has_function_privilege('authenticated', 'public.get_pm_dashboard_projects()', 'execute'), 'up again: authenticated reads the PM dashboard');
select ok(not has_function_privilege('anon', 'public.get_pm_dashboard_projects()', 'execute'), 'up again: anon cannot read the PM dashboard');
select * from finish();
rollback;
