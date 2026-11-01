-- equipment_project_actuals.test.sql — 0473 (#1519 S4). Owns AC-EQU-010/011/016 and the S4 rows of AC-EQU-012: the actual-cost
-- share reaches attributed_to_date, the hire-rate charge is its own field inside actuals_to_date, the existing figures are
-- unchanged without settings, the charge is an amounts-audience figure, and nothing is posted to the ERP.
-- Fixture F1 + F2 are docs/plans/2026-11-01-equipment-usage.md "Fixture F1" / "Ledger Fixture F2".
begin;
create extension if not exists pgtap;
select plan(59);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15190000-0000-0000-0000-00000000000a', 'EQU Org',   'IDR', 'Asia/Jakarta'),
  ('15190000-0000-0000-0000-00000000000b', 'EQU Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15190000-0000-0000-0000-0000000000a1', 'equ-admin@example.com'),
  ('15190000-0000-0000-0000-0000000000a2', 'equ-fin@example.com'),
  ('15190000-0000-0000-0000-0000000000a3', 'equ-pm1@example.com'),   -- manages P1 and P3
  ('15190000-0000-0000-0000-0000000000a4', 'equ-pm2@example.com'),   -- manages P2
  ('15190000-0000-0000-0000-0000000000a5', 'equ-exec@example.com'),
  ('15190000-0000-0000-0000-0000000000a6', 'equ-eng1@example.com'),
  ('15190000-0000-0000-0000-0000000000a7', 'equ-eng2@example.com'),
  ('15190000-0000-0000-0000-0000000000b1', 'equ-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15190000-0000-0000-0000-0000000000a1', '15190000-0000-0000-0000-00000000000a', 'EQU Admin', 'equ-admin@example.com', 'Admin', 'active'),
  ('15190000-0000-0000-0000-0000000000a2', '15190000-0000-0000-0000-00000000000a', 'EQU Fin',   'equ-fin@example.com',   'Finance', 'active'),
  ('15190000-0000-0000-0000-0000000000a3', '15190000-0000-0000-0000-00000000000a', 'EQU PM1',   'equ-pm1@example.com',   'Project Manager', 'active'),
  ('15190000-0000-0000-0000-0000000000a4', '15190000-0000-0000-0000-00000000000a', 'EQU PM2',   'equ-pm2@example.com',   'Project Manager', 'active'),
  ('15190000-0000-0000-0000-0000000000a5', '15190000-0000-0000-0000-00000000000a', 'EQU Exec',  'equ-exec@example.com',  'Executive', 'active'),
  ('15190000-0000-0000-0000-0000000000a6', '15190000-0000-0000-0000-00000000000a', 'EQU Eng1',  'equ-eng1@example.com',  'Engineer', 'active'),
  ('15190000-0000-0000-0000-0000000000a7', '15190000-0000-0000-0000-00000000000a', 'EQU Eng2',  'equ-eng2@example.com',  'Engineer', 'active'),
  ('15190000-0000-0000-0000-0000000000b1', '15190000-0000-0000-0000-00000000000b', 'EQU XOrg',  'equ-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15190000-0000-0000-0000-0000000000c1', '15190000-0000-0000-0000-00000000000a', 'EQU P1', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a3'),
  ('15190000-0000-0000-0000-0000000000c2', '15190000-0000-0000-0000-00000000000a', 'EQU P2', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a4'),
  ('15190000-0000-0000-0000-0000000000c3', '15190000-0000-0000-0000-00000000000a', 'EQU P3', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a3'),
  ('15190000-0000-0000-0000-0000000000cb', '15190000-0000-0000-0000-00000000000b', 'EQU PX', 'Ongoing Project', null);
-- A1 loader (hours), A2 truck (days), A3/A4 hire-rate machines (hours), A9 foreign (ids are hex: d1..d4, d9)
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('15190000-0000-0000-0000-0000000000d1', '15190000-0000-0000-0000-00000000000a', 'LDR-1', 'Loader 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d2', '15190000-0000-0000-0000-00000000000a', 'TRK-1', 'Truck 1',  'days'),
  ('15190000-0000-0000-0000-0000000000d3', '15190000-0000-0000-0000-00000000000a', 'GEN-1', 'Generator 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d4', '15190000-0000-0000-0000-00000000000a', 'EXC-1', 'Excavator 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d5', '15190000-0000-0000-0000-00000000000a', 'PMX-1', 'Payroll mix 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d6', '15190000-0000-0000-0000-00000000000a', 'SBY-1', 'Standby 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d7', '15190000-0000-0000-0000-00000000000a', 'TRP-1', 'Trips 1', 'days'),
  ('15190000-0000-0000-0000-0000000000d8', '15190000-0000-0000-0000-00000000000a', 'MID-1', 'Mid-month 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000da', '15190000-0000-0000-0000-00000000000a', 'ORD-1', 'Order 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000db', '15190000-0000-0000-0000-00000000000a', 'ORD-2', 'Order 2', 'hours'),
  ('15190000-0000-0000-0000-0000000000d9', '15190000-0000-0000-0000-00000000000b', 'LDR-X', 'Foreign loader', 'hours');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- approved usage straight into the table (superuser; allocation tests only — S1 tests drive the RPCs)
create or replace function pg_temp.usage(p_asset text, p_project text, p_date date, p_qty numeric, p_unit text,
                                         p_kind text default 'work', p_status text default 'Approved',
                                         p_fuel numeric default null, p_trips int default null) returns void language sql as $$
  insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, fuel_litres, trips,
                                       status, author_id, approver_id, approved_at)
  values ('15190000-0000-0000-0000-00000000000a', p_asset::uuid, p_project::uuid, p_date, p_qty, p_unit, p_kind, p_fuel, p_trips,
          p_status, '15190000-0000-0000-0000-0000000000a6',
          case when p_status in ('Approved','Rejected') then '15190000-0000-0000-0000-0000000000a3'::uuid end,
          case when p_status = 'Approved' then now() end);
$$;

insert into erp_account_mirror (org_id, company, erp_name, account_name, root_type, report_type, parent_account, is_group, account_currency, lft, rgt, refresh_id) values
  ('15190000-0000-0000-0000-00000000000a','EQ','Plant - EQ','Plant','Expense','Profit and Loss',null,true,'IDR',1,6,'15190000-0000-0000-0000-0000000000f0'),
  ('15190000-0000-0000-0000-00000000000a','EQ','Depreciation - EQ','Depreciation','Expense','Profit and Loss','Plant - EQ',false,'IDR',2,3,'15190000-0000-0000-0000-0000000000f0'),
  ('15190000-0000-0000-0000-00000000000a','EQ','Fuel - EQ','Fuel','Expense','Profit and Loss','Plant - EQ',false,'IDR',4,5,'15190000-0000-0000-0000-0000000000f0'),
  ('15190000-0000-0000-0000-00000000000a','EQ','Repairs - EQ','Repairs','Expense','Profit and Loss',null,false,'IDR',7,8,'15190000-0000-0000-0000-0000000000f0');
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('15190000-0000-0000-0000-00000000000a','Equipment','Depreciation - EQ',true),
  ('15190000-0000-0000-0000-00000000000a','Equipment','Fuel - EQ',false);
insert into erp_gl_entry_mirror (id, org_id, erp_name, company, account, cost_center, fiscal_year, project, party_type, party, posting_date, debit, credit, is_cancelled, erp_modified) values
  -- G1: Loader-1 September depreciation, 800.00 (AC-EQU-001)
  ('15190000-0000-0000-0000-0000000001a1','15190000-0000-0000-0000-00000000000a','EQ-GL-1','EQ','Depreciation - EQ','Loader-1 - EQ','2026',null,null,null,'2026-09-30',800.00,0,false,'1'),
  -- G2: Loader-1 July depreciation with no July usage (AC-EQU-005)
  ('15190000-0000-0000-0000-0000000001a2','15190000-0000-0000-0000-00000000000a','EQ-GL-2','EQ','Depreciation - EQ','Loader-1 - EQ','2026',null,null,null,'2026-07-31',500.00,0,false,'1'),
  -- G3: tagged to the ERP project of P1: never pooled
  ('15190000-0000-0000-0000-0000000001a3','15190000-0000-0000-0000-00000000000a','EQ-GL-3','EQ','Depreciation - EQ','Loader-1 - EQ','2026','PRJ-P1',null,null,'2026-09-30',300.00,0,false,'1'),
  -- G4: cancelled: never pooled
  ('15190000-0000-0000-0000-0000000001a4','15190000-0000-0000-0000-00000000000a','EQ-GL-4','EQ','Depreciation - EQ','Loader-1 - EQ','2026',null,null,null,'2026-09-15',9999.00,0,true,'1'),
  -- G5: Truck-1 August fuel, 100.00 split three ways (AC-EQU-004)
  ('15190000-0000-0000-0000-0000000001a5','15190000-0000-0000-0000-00000000000a','EQ-GL-5','EQ','Fuel - EQ','Truck-1 - EQ','2026',null,null,null,'2026-08-20',100.00,0,false,'1'),
  -- G6: office depreciation (no asset cost centre): a #1271 rule may take it (AC-EQU-009)
  ('15190000-0000-0000-0000-0000000001a6','15190000-0000-0000-0000-00000000000a','EQ-GL-6','EQ','Depreciation - EQ','Office - EQ','2026',null,null,null,'2026-09-30',200.00,0,false,'1');
insert into erp_actuals_snapshot (org_id, project_id, cost_center, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('15190000-0000-0000-0000-00000000000a','15190000-0000-0000-0000-0000000000c1','Loader-1 - EQ','Depreciation - EQ','2026',300.00,0,300,'15190000-0000-0000-0000-0000000000e1');

-- P2: a snapshot row whose net is null (rows exist, amount unknown): the 0376 `source_sum` null case that a coalesced
-- rewrite would turn into 0 (S4.2). Same snapshot generation as the P1 row.
insert into erp_actuals_snapshot (org_id, project_id, cost_center, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('15190000-0000-0000-0000-00000000000a','15190000-0000-0000-0000-0000000000c2','Loader-1 - EQ','Fuel - EQ','2026',null,null,null,'15190000-0000-0000-0000-0000000000e1');

-- verbatim 0376 body of project_mapped_actuals (8 columns): the oracle for AC-EQU-011
create or replace function pg_temp.pma_0376(p_project_id uuid,p_fiscal_year text default null)
returns table(category public.budget_category,mapped boolean,has_rows boolean,
              actuals_to_date numeric,actuals_as_of timestamptz,source_sum numeric,
              tagged_to_date numeric,attributed_to_date numeric)
language sql stable security invoker set search_path = public,pg_temp as $$
  with generation as (
    select s.snapshot_id from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id()
    order by s.created_at desc,s.id desc limit 1
  ), reading as (
    select s.* from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id() and s.project_id = p_project_id
      and s.snapshot_id = (select snapshot_id from generation)
      and (p_fiscal_year is null or s.fiscal_year = p_fiscal_year)
      and exists (select 1 from public.projects p where p.id = p_project_id)
  ), mapped_categories as (
    select distinct m.category from public.budget_category_account_map m
    where m.org_id = public.auth_org_id()
  ), actuals as (
    select m.category,count(*) as n,
      case when count(*) filter(where r.net is null or r.net::text in ('NaN','Infinity','-Infinity')) > 0
           then null else sum(r.net) end as amount,
      sum(r.net) as source_sum
    from reading r join public.budget_category_account_map m
      on m.org_id = r.org_id and m.erp_account = r.account
    group by m.category
  ), attributed as (
    -- #1271: rule-attributed untagged ledger lines, same category map (0376).
    select x.* from public.cost_attribution_project_actuals(p_project_id,p_fiscal_year) x
    where exists (select 1 from public.projects p where p.id = p_project_id)
  ), reading_as_of as (
    select greatest((select max(as_of) from reading),(select max(as_of) from attributed)) as v
  )
  select c.category,mc.category is not null,coalesce(a.n,0) + coalesce(t.n,0) > 0,
    case when mc.category is null or (select v from reading_as_of) is null then null
         when coalesce(a.n,0) + coalesce(t.n,0) = 0 then 0::numeric
         when (a.n > 0 and a.amount is null) or (t.n > 0 and t.amount is null) then null
         else coalesce(a.amount,0) + coalesce(t.amount,0) end,
    (select v from reading_as_of),
    case when a.n > 0 and t.n > 0 then a.source_sum + t.source_sum
         when a.n > 0 then a.source_sum
         when t.n > 0 then t.source_sum end,
    case when mc.category is null or (select v from reading_as_of) is null then null
         when a.n > 0 then a.amount else 0::numeric end,
    case when mc.category is null or (select v from reading_as_of) is null then null
         when t.n > 0 then t.amount else 0::numeric end
  from unnest(enum_range(null::public.budget_category)) c(category)
  left join mapped_categories mc on mc.category = c.category
  left join actuals a on a.category = c.category
  left join attributed t on t.category = c.category
$$;

-- the `actuals` object of get_project_finances exactly as 0410 builds it, over the 0376 body
create or replace function pg_temp.finances_0410_actuals(p_project uuid) returns jsonb language sql as $$
  with gl as (select * from pg_temp.pma_0376(p_project, null))
  select jsonb_build_object(
      'currency',o.default_currency,'as_of',(select max(actuals_as_of) from gl),
      'excludes_restricted_rows',not coalesce(public.holds_spend_approval_authority(public.auth_role()),false),
      'total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and actuals_to_date is null) > 0 then null
                          else sum(actuals_to_date) filter(where mapped) end::text from gl),
      'tagged_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and tagged_to_date is null) > 0 then null
                          else sum(tagged_to_date) filter(where mapped) end::text from gl),
      'attributed_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and attributed_to_date is null) > 0 then null
                          else sum(attributed_to_date) filter(where mapped) end::text from gl),
      'categories',(select jsonb_agg(jsonb_build_object('category',category,'mapped',mapped,
                                                       'amount',actuals_to_date::text,
                                                       'tagged_amount',tagged_to_date::text,
                                                       'attributed_amount',attributed_to_date::text) order by category) from gl))
    from public.projects p join public.organizations o on o.id = p.org_id where p.id = p_project;
$$;
-- the shipped `categories` array without the additive key
create or replace function pg_temp.finances_cats(p_project uuid) returns jsonb language sql as $$
  select jsonb_agg(c - 'equipment_charge_amount' order by n)
    from jsonb_array_elements(public.get_project_finances(p_project)->'actuals'->'categories') with ordinality t(c, n);
$$;
create or replace function pg_temp.col(p_project text, p_col text) returns numeric language plpgsql as $$
declare v numeric; begin
  execute format('select %I from public.project_mapped_actuals(%L::uuid, null) where category = ''Equipment''', p_col, p_project) into v;
  return v; end $$;

create temp table _dash (k text primary key, v jsonb) on commit drop;
create temp table _c (k text primary key, v numeric) on commit drop;
create temp table _s (k text primary key, v jsonb) on commit drop;
grant all on _dash, _c, _s to authenticated;
-- the ledger total on the two plant accounts, read as superuser (a Project Manager cannot read the mirror)
insert into _c select 'ledger', sum(debit - credit) from erp_gl_entry_mirror
  where org_id = '15190000-0000-0000-0000-00000000000a' and not is_cancelled and account in ('Depreciation - EQ','Fuel - EQ');

-- ── dashboards captured BEFORE any usage row exists ─────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a5');   -- Executive
insert into _dash select 'exec', get_executive_dashboard()::jsonb;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1
insert into _dash select 'pm', get_pm_dashboard_projects()::jsonb;
reset role;

-- usage: LDR-1 September (P1 6 h, P2 2 h approved; P3 Draft and Rejected never count), EXC-1 October (10 h work + 4 h standby on P1)
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c1','2026-09-10',6,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c2','2026-09-11',2,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c3','2026-09-12',5,'hours','work','Draft');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c3','2026-09-13',3,'hours','work','Rejected');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d4','15190000-0000-0000-0000-0000000000c1','2026-10-05',10,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d4','15190000-0000-0000-0000-0000000000c1','2026-10-05',4,'hours','standby');

-- ── AC-EQU-011: usage logged, no equipment setting ──────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1
select bag_eq(
  $$ select p.id, f.fy, x.category, x.mapped, x.has_rows, x.actuals_to_date, x.actuals_as_of, x.source_sum, x.tagged_to_date, x.attributed_to_date
       from public.projects p cross join (values (null::text), ('2026')) f(fy)
       cross join lateral public.project_mapped_actuals(p.id, f.fy) x $$,
  $$ select p.id, f.fy, x.* from public.projects p cross join (values (null::text), ('2026')) f(fy)
       cross join lateral pg_temp.pma_0376(p.id, f.fy) x $$,
  'AC-EQU-011 with usage logged but no equipment setting, project_mapped_actuals is identical to 0376');
select is((select count(*)::int from public.project_mapped_actuals('15190000-0000-0000-0000-0000000000c1', null)
            where equipment_charge_to_date is distinct from 0 and equipment_charge_to_date is not null), 0,
  'AC-EQU-011 the new column is 0 (or null where actuals are unknown) with no settings');
select is((select source_sum from public.project_mapped_actuals('15190000-0000-0000-0000-0000000000c2', null) where category = 'Equipment'),
  null::numeric, 'AC-EQU-011 a category whose snapshot nets are all null keeps a null source_sum (not 0)');
select is((get_project_finances('15190000-0000-0000-0000-0000000000c1')->'actuals') - 'equipment_charge_total' - 'categories',
  pg_temp.finances_0410_actuals('15190000-0000-0000-0000-0000000000c1') - 'categories',
  'AC-EQU-011 get_project_finances actuals keys are unchanged (the new key is additive)');
select is(pg_temp.finances_cats('15190000-0000-0000-0000-0000000000c1'),
  pg_temp.finances_0410_actuals('15190000-0000-0000-0000-0000000000c1')->'categories',
  'AC-EQU-011 get_project_finances categories are unchanged apart from the additive amount key');
select bag_eq($$ select project_id, category, mapped, has_rows, actuals_to_date, source_sum, tagged_to_date, attributed_to_date
                   from project_mapped_actuals_all(null) $$,
  $$ select p.id, x.category, x.mapped, x.has_rows, x.actuals_to_date, x.source_sum, x.tagged_to_date, x.attributed_to_date
       from projects p cross join lateral pg_temp.pma_0376(p.id, null) x $$,
  'AC-EQU-011 the dashboards'' one-pass read is identical to 0376');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a5');
select is(get_executive_dashboard()::jsonb, (select v from _dash where k = 'exec'), 'AC-EQU-011 the executive dashboard is byte-identical');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');
select is(get_pm_dashboard_projects()::jsonb, (select v from _dash where k = 'pm'), 'AC-EQU-011 the PM dashboard is byte-identical');

-- ── the costing saves (Finance) ─────────────────────────────────────────────────────────────────────
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');   -- Finance
insert into _s select 'ldr', save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d1","basis":"actual_cost",
  "driver":"units","rate_unit":"hours","account_group":"Plant - EQ","cost_center":"Loader-1 - EQ","effective_from":"2026-01-01"}');
insert into _s select 'exc', save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"hire_rate",
  "work_rate":50,"standby_rate":20,"rate_unit":"hours","effective_from":"2026-01-01"}');

-- ── AC-EQU-010: attributed path and the separate charge ─────────────────────────────────────────────
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','attributed_to_date'), 600.00::numeric,
  'AC-EQU-010 the actual-cost share reaches attributed_to_date in the mapped category');
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','tagged_to_date'), 300.00::numeric,
  'AC-EQU-010 tagged_to_date is unchanged (the ERP-tagged line)');
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','equipment_charge_to_date'), 580.00::numeric,
  'AC-EQU-010 the hire-rate charge is reported in its own field (FR-EQU-051)');
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','actuals_to_date'), 1480.00::numeric,
  'AC-EQU-010 OQ-3: actuals_to_date = tagged + attributed + internal charge');
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','source_sum'), 1480.00::numeric,
  'AC-EQU-010 the budget-vs-actual source sum carries the charge too (PQ-10)');
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c2','attributed_to_date'), 200.00::numeric,
  'AC-EQU-010 the second project''s share is attributed as well');
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c2','equipment_charge_to_date'), 0::numeric,
  'AC-EQU-010 a project with no hire usage has no charge');
select is((get_project_finances('15190000-0000-0000-0000-0000000000c1')->'actuals'->>'equipment_charge_total')::numeric,
  580.00::numeric, 'AC-EQU-010 project finances state the internal charge separately');
select is((get_project_finances('15190000-0000-0000-0000-0000000000c1')->'actuals'->>'total')::numeric,
  1480.00::numeric, 'AC-EQU-010 project finances total includes the charge');
select is((select c->>'equipment_charge_amount' from jsonb_array_elements(get_project_finances('15190000-0000-0000-0000-0000000000c1')->'actuals'->'categories') c
            where c->>'category' = 'Equipment'), '580.00', 'AC-EQU-010 the Equipment category states its charge');
select is((get_project_finances('15190000-0000-0000-0000-0000000000c1')->'actuals'->>'attributed_total')::numeric,
  600.00::numeric, 'AC-EQU-010 attributed_total never contains the charge (it is outside the ledger)');
select ok((select coalesce(sum(tagged_to_date), 0) + coalesce(sum(attributed_to_date), 0) from project_mapped_actuals_all(null)
            where category = 'Equipment') <= (select v from _c where k = 'ledger'),
  'AC-EQU-010 org-wide tagged + attributed never exceeds the ledger (the charge is outside both)');
select is((select equipment_charge_to_date from project_mapped_actuals_all(null)
            where project_id = '15190000-0000-0000-0000-0000000000c1' and category = 'Equipment'), 580.00::numeric,
  'AC-EQU-010 the dashboards'' one-pass read carries the charge');
select bag_eq($$ select project_id, category, mapped, has_rows, actuals_to_date, actuals_as_of, source_sum, tagged_to_date, attributed_to_date,
                        equipment_charge_to_date from project_mapped_actuals_all(null) $$,
  $$ select p.id, x.* from projects p cross join lateral project_mapped_actuals(p.id, null) x $$,
  'AC-EQU-010 the org-wide read equals the per-project read row for row');
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c3','actuals_to_date'), null::numeric,
  'AC-EQU-010 draft and rejected usage never reach a project''s actuals (P3 stays unknown, not attributed)');
select is((select has_rows from project_mapped_actuals('15190000-0000-0000-0000-0000000000c1', '2025') where category = 'Equipment'),
  false, 'AC-EQU-010 the charge follows the fiscal year of its work date (PQ-2): nothing in 2025');
select is((select equipment_charge_to_date from project_mapped_actuals('15190000-0000-0000-0000-0000000000c1', '2026') where category = 'Equipment'),
  580.00::numeric, 'AC-EQU-010 the charge follows the fiscal year of its work date (PQ-2): 580.00 in 2026');

-- ── S4.7 same-org visibility of the new columns (FR-EQU-062: the charge is an amount) ────────────────
select is((select count(*)::int from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')), 1,
  'AC-EQU-012 a Project Manager reads the charge helper for the project');
select is((select count(*)::int from equipment_charge_org_actuals()), 1, 'AC-EQU-012 a Project Manager reads the org-wide charge helper');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a4');   -- PM2 (does not manage P1; amounts audience is role-wide)
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','equipment_charge_to_date'), 580.00::numeric,
  'AC-EQU-012 any Project Manager reads the charge (the amounts audience is role-wide, as for ledger actuals)');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a5');   -- Executive
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','equipment_charge_to_date'), 580.00::numeric,
  'AC-EQU-012 an Executive reads the charge');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a1');   -- Admin
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','equipment_charge_to_date'), 580.00::numeric,
  'AC-EQU-012 an Admin reads the charge');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');   -- Engineer
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','equipment_charge_to_date'), 0::numeric,
  'AC-EQU-012 an Engineer sees no charge amount (FR-EQU-062)');
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','actuals_to_date'), 900.00::numeric,
  'AC-EQU-012 an Engineer''s actuals_to_date excludes the charge');
select is((select count(*)::int from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')), 0,
  'AC-EQU-012 an Engineer gets no charge rows for the project');
select is((select count(*)::int from equipment_charge_org_actuals()), 0, 'AC-EQU-012 an Engineer gets no org-wide charge rows');
select is((select count(*)::int from project_mapped_actuals_all(null)
            where equipment_charge_to_date is distinct from 0 and equipment_charge_to_date is not null), 0,
  'AC-EQU-012 an Engineer''s org-wide read carries no charge');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000b1');   -- Admin of the other org
select is((select count(*)::int from project_mapped_actuals('15190000-0000-0000-0000-0000000000c1', null)
            where equipment_charge_to_date is distinct from 0 and equipment_charge_to_date is not null), 0,
  'AC-EQU-012 another organisation''s Admin reads no charge of this organisation''s project');
select is((select count(*)::int from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')), 0,
  'AC-EQU-012 another organisation''s Admin gets no charge rows for this organisation''s project');
select is((select count(*)::int from equipment_charge_org_actuals()), 0, 'AC-EQU-012 another organisation''s Admin gets no org-wide charge rows');
reset role;
-- a disabled Finance user is not an active member: no charge rows and no figure
update profiles set status = 'disabled' where id = '15190000-0000-0000-0000-0000000000a2';
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')), 0,
  'AC-EQU-012 a disabled Finance user gets no charge rows for the project');
select is((select count(*)::int from equipment_charge_org_actuals()), 0, 'AC-EQU-012 a disabled Finance user gets no org-wide charge rows');
reset role;
update profiles set status = 'active' where id = '15190000-0000-0000-0000-0000000000a2';
-- DD-EQU-1: the actuals reads expose no pool, line count or driver total (Project Managers never read those)
select doesnt_match(pg_get_function_result('public.project_mapped_actuals(uuid,text)'::regprocedure), '(pool|line_count|driver_total)',
  'AC-EQU-012 project_mapped_actuals exposes no pool, line count or driver total (DD-EQU-1)');
select doesnt_match(pg_get_function_result('public.project_mapped_actuals_all(text)'::regprocedure), '(pool|line_count|driver_total)',
  'AC-EQU-012 project_mapped_actuals_all exposes no pool, line count or driver total (DD-EQU-1)');
select doesnt_match(pg_get_function_result('public.equipment_charge_project_actuals(uuid,text)'::regprocedure), '(pool|line_count|driver_total)',
  'AC-EQU-012 the charge helper exposes no pool, line count or driver total (DD-EQU-1)');
select ok(not ((select get_project_finances('15190000-0000-0000-0000-0000000000c1')->'actuals')::text ~ '(pool|line_count|driver_total)'),
  'AC-EQU-012 project finances state no pool, line count or driver total (DD-EQU-1)');

-- ── AC-EQU-016: no ERP write (OQ-1) ──────────────────────────────────────────────────────────────────
insert into _c values ('gl', (select count(*) from erp_gl_entry_mirror)), ('snap', (select count(*) from erp_actuals_snapshot)),
  ('outbox', (select count(*) from external_command_outbox)),
  ('gl_sum', (select coalesce(sum(debit - credit), 0) from erp_gl_entry_mirror)),
  ('snap_sum', (select coalesce(sum(net), 0) from erp_actuals_snapshot));
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');   -- Finance: save, preview, end costing
select lives_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d3","basis":"hire_rate",
  "work_rate":50,"rate_unit":"hours","effective_from":"2026-01-01"}') $$, 'AC-EQU-016 Finance saves a costing setting');
select lives_ok($$ select * from preview_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d2","basis":"hire_rate",
  "work_rate":60,"rate_unit":"days","effective_from":"2026-06-01"}') $$, 'AC-EQU-016 Finance previews a costing setting');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');   -- Eng1 logs and submits
insert into _s select 'u1', save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d3",
  "project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-10-20","quantity":3,"unit":"hours"}'::jsonb);
insert into _s select 'u2', save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d3",
  "project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-10-21","quantity":2,"unit":"hours"}'::jsonb);
select lives_ok($$ select transition_equipment_usage((select (v->>'id')::uuid from _s where k='u1'), 'Submitted') $$, 'AC-EQU-016 the author submits');
select lives_ok($$ select transition_equipment_usage((select (v->>'id')::uuid from _s where k='u2'), 'Submitted') $$, 'AC-EQU-016 the author submits a second entry');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1 approves one, bulk-approves the week
select lives_ok($$ select transition_equipment_usage((select (v->>'id')::uuid from _s where k='u1'), 'Approved') $$, 'AC-EQU-016 the PM approves');
select is((approve_equipment_usage_week('15190000-0000-0000-0000-0000000000d3', '2026-10-19')->>'approved')::int, 1, 'AC-EQU-016 the PM bulk-approves the week');
select lives_ok($$ select count(*) from list_equipment_allocations('15190000-0000-0000-0000-0000000000d3','2026-01-01','2026-12-31') $$,
  'AC-EQU-016 the allocation read runs');
select lives_ok($$ select count(*) from project_mapped_actuals_all(null) $$, 'AC-EQU-016 the dashboards'' actuals read runs');
select lives_ok($$ select get_project_finances('15190000-0000-0000-0000-0000000000c1') $$, 'AC-EQU-016 project finances read runs');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');
select lives_ok($$ select end_equipment_costing((select (v->>'setting_key')::uuid from _s where k='exc'), '2026-12-31', 1) $$, 'AC-EQU-016 Finance ends a costing setting');
reset role;
select is((select count(*) from erp_gl_entry_mirror)::numeric, (select v from _c where k = 'gl'), 'AC-EQU-016 no ledger mirror row is written');
select is((select count(*) from erp_actuals_snapshot)::numeric, (select v from _c where k = 'snap'), 'AC-EQU-016 no actuals snapshot row is written');
select is((select count(*) from external_command_outbox)::numeric, (select v from _c where k = 'outbox'),
  'AC-EQU-016 no ERP command is enqueued (OQ-1: nothing is posted)');
select is((select coalesce(sum(debit - credit), 0) from erp_gl_entry_mirror), (select v from _c where k = 'gl_sum'), 'AC-EQU-016 the mirrored ledger total is unchanged');
select is((select coalesce(sum(net), 0) from erp_actuals_snapshot), (select v from _c where k = 'snap_sum'), 'AC-EQU-016 the actuals snapshot total is unchanged');

select * from finish();
rollback;
