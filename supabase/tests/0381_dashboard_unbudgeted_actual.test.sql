-- 0381 (#1374): a project with no Active budget judges Actual completeness on mapped ledger coverage — the rule the
-- project header uses (every cost category mapped and read) — on the executive and PM dashboards. A project with an
-- Active budget keeps the budgeted-categories rule. Mutation check: restore the 0376 actual_complete (no budget →
-- always false) and the AC-DASH-UNB-001 rows go red (also proven by scripts/test-dashboard-unbudgeted-actual-rollback.sh).
begin;
select plan(12);

insert into organizations (id,name,default_currency) values ('03810000-0000-0000-0000-00000000000a','Unbudgeted actual org','IDR');
insert into auth.users (id,email) values ('03810000-0000-0000-0000-0000000000a1','unb-exec@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values
  ('03810000-0000-0000-0000-0000000000a1','03810000-0000-0000-0000-00000000000a','Unb Exec','unb-exec@example.test','Executive','active');
insert into external_org_bindings (org_id,external_tier,site_url,secret_ref,status,connected_by,connected_at)
values ('03810000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref','active',
        '03810000-0000-0000-0000-0000000000a1',now());
insert into projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,
                      tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat,project_manager_id) values
  ('03810000-0000-0000-0000-0000000000d1','03810000-0000-0000-0000-00000000000a','Unbudgeted read','Ongoing Project','IDR',5000,'exclusive',0,0,1,1,false,'03810000-0000-0000-0000-0000000000a1'),
  ('03810000-0000-0000-0000-0000000000d2','03810000-0000-0000-0000-00000000000a','Unbudgeted unread','Ongoing Project','IDR',4000,'exclusive',0,0,1,1,false,'03810000-0000-0000-0000-0000000000a1'),
  ('03810000-0000-0000-0000-0000000000d3','03810000-0000-0000-0000-00000000000a','Budgeted','Ongoing Project','IDR',3000,'exclusive',0,0,1,1,false,'03810000-0000-0000-0000-0000000000a1');
insert into budget_versions (id,org_id,project_id,version,name,status,currency) values
  ('03810000-0000-0000-0000-0000000000b1','03810000-0000-0000-0000-00000000000a','03810000-0000-0000-0000-0000000000d3',1,'Active','Draft','IDR');
insert into budget_line_items (id,org_id,budget_version_id,category,description,budgeted_amount) values
  ('03810000-0000-0000-0000-0000000000c1','03810000-0000-0000-0000-00000000000a','03810000-0000-0000-0000-0000000000b1','Labor','Labor line',1000);
update budget_versions set status='Active' where id='03810000-0000-0000-0000-0000000000b1';
-- every cost category is mapped: complete category coverage for any project with a ledger reading
insert into budget_category_account_map (org_id,category,erp_account,is_push_target)
select '03810000-0000-0000-0000-00000000000a',c,'0381-'||c::text,true from unnest(enum_range(null::budget_category)) c;
insert into erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at) values
  ('03810000-0000-0000-0000-00000000000a','03810000-0000-0000-0000-0000000000d1','0381-Labor','FY-2026',1200,'2026-10-01','03810000-0000-0000-0000-0000000000e1','2026-10-02'),
  ('03810000-0000-0000-0000-00000000000a','03810000-0000-0000-0000-0000000000d3','0381-Labor','FY-2026',300,'2026-10-01','03810000-0000-0000-0000-0000000000e1','2026-10-02');

create or replace function pg_temp.exec_row(p_name text) returns jsonb language sql as $$
  select value::jsonb from json_array_elements(public.get_executive_dashboard()->'top_projects') value where value->>'name' = p_name $$;
create or replace function pg_temp.pm_row(p_name text) returns jsonb language sql as $$
  select value::jsonb from json_array_elements(public.get_pm_dashboard_projects()) value where value->>'name' = p_name $$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"03810000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(pg_temp.exec_row('Unbudgeted read')->>'actual_complete', 'true',
  'AC-DASH-UNB-001: executive — no Active budget, complete mapped ledger coverage → Actual is complete');
select is((pg_temp.exec_row('Unbudgeted read')->>'spent')::numeric, 1200::numeric,
  'AC-DASH-UNB-001: executive — the unbudgeted project shows its spending');
select is(pg_temp.exec_row('Unbudgeted read')->>'budget', null,
  'AC-DASH-UNB-001: executive — no budget, so no budget-risk basis');
select is(pg_temp.pm_row('Unbudgeted read')->>'actual_complete', 'true',
  'AC-DASH-UNB-001: PM — no Active budget, complete mapped ledger coverage → Actual is complete');
select is((pg_temp.pm_row('Unbudgeted read')->>'contract_remaining')::numeric, 3800::numeric,
  'AC-DASH-UNB-001: PM — contract remaining follows the complete Actual');
select is(pg_temp.exec_row('Unbudgeted unread')->>'actual_complete', 'false',
  'AC-DASH-UNB-002: executive — no budget and no ledger reading stays withheld');
select is(pg_temp.pm_row('Unbudgeted unread')->>'actual_complete', 'false',
  'AC-DASH-UNB-002: PM — no budget and no ledger reading stays withheld');
select is((get_executive_dashboard()->>'risk_unchecked_projects')::int, 2,
  'AC-DASH-UNB-001: budgetless projects stay risk-unchecked (the budget-risk indicator stays off)');
select is(pg_temp.exec_row('Budgeted')->>'actual_complete', 'true',
  'AC-DASH-UNB-003: executive — an Active budget keeps the budgeted-categories rule');

-- one category loses its mapping: the unbudgeted project's coverage is now partial; the budgeted one only needs Labor
reset role;
delete from budget_category_account_map where org_id='03810000-0000-0000-0000-00000000000a' and category='Overheads';
set local role authenticated;
select is(pg_temp.exec_row('Unbudgeted read')->>'actual_complete', 'false',
  'AC-DASH-UNB-002: executive — no budget and an unmapped category stays withheld');
select is(pg_temp.pm_row('Unbudgeted read')->>'actual_complete', 'false',
  'AC-DASH-UNB-002: PM — no budget and an unmapped category stays withheld');
select is(pg_temp.pm_row('Budgeted')->>'actual_complete', 'true',
  'AC-DASH-UNB-003: PM — an Active budget keeps the budgeted-categories rule');
reset role;
select * from finish();
rollback;
