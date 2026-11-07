-- 0720_attribution_helpers_skip.test.sql — 0720 (Q12 perf). The two org-wide actuals helpers behind the dashboards skip their
-- engine when the org has no current attribution rule, no actual_cost setting (attribution) or no hire_rate setting (charge),
-- and return exactly what the 0376 / 0497 bodies returned in every case. Oracles = those bodies, verbatim, as pg_temp functions.
begin;
create extension if not exists pgtap;
select plan(12);

insert into organizations (id, name, default_currency, default_timezone) values
  ('07200000-0000-0000-0000-00000000000a', 'S0720 Plain', 'IDR', 'UTC'),
  ('07200000-0000-0000-0000-00000000000b', 'S0720 Rule',  'IDR', 'UTC'),
  ('07200000-0000-0000-0000-00000000000c', 'S0720 Equip',  'IDR', 'UTC');
insert into auth.users (id, email) values
  ('07200000-0000-0000-0000-0000000000a1', 's0720-plain@example.com'),
  ('07200000-0000-0000-0000-0000000000b1', 's0720-rule@example.com'),
  ('07200000-0000-0000-0000-0000000000c1', 's0720-equip@example.com'),
  ('07200000-0000-0000-0000-0000000000c2', 's0720-equip-approver@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07200000-0000-0000-0000-0000000000a1', '07200000-0000-0000-0000-00000000000a', 'S0720 Plain', 's0720-plain@example.com', 'Admin', 'active'),
  ('07200000-0000-0000-0000-0000000000b1', '07200000-0000-0000-0000-00000000000b', 'S0720 Rule',  's0720-rule@example.com',  'Admin', 'active'),
  ('07200000-0000-0000-0000-0000000000c1', '07200000-0000-0000-0000-00000000000c', 'S0720 Equip', 's0720-equip@example.com', 'Admin', 'active'),
  ('07200000-0000-0000-0000-0000000000c2', '07200000-0000-0000-0000-00000000000c', 'S0720 Equip approver', 's0720-equip-approver@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status) values
  ('07200000-0000-0000-0000-0000000000d1', '07200000-0000-0000-0000-00000000000b', 'S0720 P-rule',  'Ongoing Project'),
  ('07200000-0000-0000-0000-0000000000d2', '07200000-0000-0000-0000-00000000000c', 'S0720 P-equip', 'Ongoing Project');
insert into erp_account_mirror (org_id, company, erp_name, account_name, root_type, report_type, parent_account, is_group, account_currency, lft, rgt, refresh_id) values
  ('07200000-0000-0000-0000-00000000000b','S7','Rent - S7','Rent','Expense','Profit and Loss',null,false,'IDR',1,2,'07200000-0000-0000-0000-0000000000f0'),
  ('07200000-0000-0000-0000-00000000000c','S7','Fuel - S7','Fuel','Expense','Profit and Loss',null,false,'IDR',1,2,'07200000-0000-0000-0000-0000000000f0');
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('07200000-0000-0000-0000-00000000000b','Equipment','Rent - S7',false),
  ('07200000-0000-0000-0000-00000000000c','Equipment','Fuel - S7',false);
insert into erp_gl_entry_mirror (id, org_id, erp_name, company, account, cost_center, fiscal_year, project, party_type, party, posting_date, debit, credit, is_cancelled, erp_modified) values
  ('07200000-0000-0000-0000-0000000001a1','07200000-0000-0000-0000-00000000000b','S7-GL-1','S7','Rent - S7','Main - S7','2026',null,null,null,'2026-09-30',1000.00,0,false,'1'),
  ('07200000-0000-0000-0000-0000000001a2','07200000-0000-0000-0000-00000000000c','S7-GL-2','S7','Fuel - S7','Truck - S7','2026',null,null,null,'2026-09-30',600.00,0,false,'1');
-- org B: one current attribution rule, 100% to its project
insert into cost_attribution_rules (id, org_id, rule_key, version, name, match_account, effective_from, specificity) values
  ('07200000-0000-0000-0000-0000000002a1','07200000-0000-0000-0000-00000000000b','07200000-0000-0000-0000-0000000003a1',1,'S0720 rent','Rent - S7','2026-01-01',2);
insert into cost_attribution_rule_targets (rule_id, org_id, position, project_id, percent) values
  ('07200000-0000-0000-0000-0000000002a1','07200000-0000-0000-0000-00000000000b',0,'07200000-0000-0000-0000-0000000000d1',100);
-- org C: an actual_cost setting (fuel pool split by hours) and a hire_rate setting on a second asset, both with approved usage
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('07200000-0000-0000-0000-0000000000e1','07200000-0000-0000-0000-00000000000c','S7-TRK','Truck','hours'),
  ('07200000-0000-0000-0000-0000000000e2','07200000-0000-0000-0000-00000000000c','S7-GEN','Generator','hours');
insert into equipment_costing_settings (org_id, asset_id, setting_key, version, basis, driver, rate_unit, match_account, match_cost_center, specificity, effective_from) values
  ('07200000-0000-0000-0000-00000000000c','07200000-0000-0000-0000-0000000000e1','07200000-0000-0000-0000-0000000003c1',1,'actual_cost','units','hours','Fuel - S7','Truck - S7',12,'2026-01-01');
insert into equipment_costing_settings (org_id, asset_id, setting_key, version, basis, work_rate, rate_unit, charge_category, effective_from) values
  ('07200000-0000-0000-0000-00000000000c','07200000-0000-0000-0000-0000000000e2','07200000-0000-0000-0000-0000000003c2',1,'hire_rate',50,'hours','Equipment','2026-01-01');
insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, status, author_id, approver_id, approved_at) values
  ('07200000-0000-0000-0000-00000000000c','07200000-0000-0000-0000-0000000000e1','07200000-0000-0000-0000-0000000000d2','2026-09-10',8,'hours','work','Approved','07200000-0000-0000-0000-0000000000c1','07200000-0000-0000-0000-0000000000c2',now()),
  ('07200000-0000-0000-0000-00000000000c','07200000-0000-0000-0000-0000000000e2','07200000-0000-0000-0000-0000000000d2','2026-09-11',4,'hours','work','Approved','07200000-0000-0000-0000-0000000000c1','07200000-0000-0000-0000-0000000000c2',now());

-- oracles: the 0376 / 0497 bodies, verbatim (no guard)
create function pg_temp.org_actuals_0376(p_fiscal_year text default null)
returns table(project_id uuid, category public.budget_category, n bigint, amount numeric, source_sum numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.project_id, m.category, count(*),
         case when count(*) filter (where a.amount is null or a.amount::text in ('NaN','Infinity','-Infinity')) > 0
              then null else sum(a.amount) end,
         sum(a.amount), max(a.as_of)
    from public.cost_attribution_allocations(public.auth_org_id(), null, null, null) a
    join public.budget_category_account_map m on m.org_id = public.auth_org_id() and m.erp_account = a.account
   where public.is_active_member()
     and (p_fiscal_year is null or a.fiscal_year = p_fiscal_year)
     and (a.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))
   group by a.project_id, m.category
$$;
create function pg_temp.charge_0497(p_fiscal_year text default null)
returns table(project_id uuid, category public.budget_category, n bigint, amount numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.project_id, c.category, count(*), sum(c.amount), max(c.as_of)
    from public.equipment_hire_charges(public.auth_org_id(), null, null) c
   where public.is_active_member()
     and coalesce(public.auth_role()::text in ('Admin','Finance','Executive','Project Manager'), false)
     and (p_fiscal_year is null or c.fiscal_year = p_fiscal_year)
   group by c.project_id, c.category
$$;
create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- engine / hire-charge calls made so far in this transaction (SQL-language functions, tracked per transaction)
create function pg_temp.calls(p_fn text) returns bigint language sql as $$
  select coalesce(sum(calls), 0)::bigint from pg_stat_xact_user_functions where funcname = p_fn
$$;
set local track_functions = 'all';

-- plain org: nothing configured, so the engines are not run, and the answer is the empty one
select pg_temp.act_as('07200000-0000-0000-0000-0000000000a1'); set local role authenticated;
select is_empty($$ select * from public.cost_attribution_org_actuals(null) $$, '0720 unconfigured org: attribution helper returns nothing');
select is(pg_temp.calls('cost_attribution_engine'), 0::bigint, '0720 unconfigured org: the attribution engine is not run');
select is_empty($$ select * from public.equipment_charge_org_actuals(null) $$, '0720 unconfigured org: charge helper returns nothing');
select is(pg_temp.calls('equipment_hire_charges'), 0::bigint, '0720 unconfigured org: the hire-charge engine is not run');
reset role;

-- org with a current rule: the engine runs and the helper equals the 0376 body
select pg_temp.act_as('07200000-0000-0000-0000-0000000000b1'); set local role authenticated;
select results_eq($$ select * from public.cost_attribution_org_actuals(null) $$, $$ select * from pg_temp.org_actuals_0376(null) $$,
  '0720 rule org: attribution helper equals the 0376 body');
select is((select amount from public.cost_attribution_org_actuals(null) where project_id = '07200000-0000-0000-0000-0000000000d1'), 1000.00::numeric,
  '0720 rule org: the rent line reaches its project (the guard does not hide real rows)');
reset role;

-- org with equipment settings: the actual_cost share and the hire charge both equal the old bodies
select pg_temp.act_as('07200000-0000-0000-0000-0000000000c1'); set local role authenticated;
select results_eq($$ select * from public.cost_attribution_org_actuals(null) $$, $$ select * from pg_temp.org_actuals_0376(null) $$,
  '0720 equipment org: attribution helper (actual_cost share) equals the 0376 body');
select is((select amount from public.cost_attribution_org_actuals(null) where project_id = '07200000-0000-0000-0000-0000000000d2'), 600.00::numeric,
  '0720 equipment org: the fuel pool reaches the project that used the truck');
select results_eq($$ select * from public.equipment_charge_org_actuals(null) $$, $$ select * from pg_temp.charge_0497(null) $$,
  '0720 equipment org: charge helper equals the 0497 body');
select is((select amount from public.equipment_charge_org_actuals(null)), 200.00::numeric, '0720 equipment org: 4 hours at 50 are charged');
select results_eq($$ select * from public.cost_attribution_org_actuals('2026') $$, $$ select * from pg_temp.org_actuals_0376('2026') $$,
  '0720 fiscal-year filter still applies to the attribution helper');
select results_eq($$ select * from public.equipment_charge_org_actuals('2099') $$, $$ select * from pg_temp.charge_0497('2099') $$,
  '0720 fiscal-year filter still applies to the charge helper');
reset role;

select * from finish();
rollback;
