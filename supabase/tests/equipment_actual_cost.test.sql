-- equipment_actual_cost.test.sql — 0471 (#1519 S3). Owns AC-EQU-001/004/005/006/009/014: `actual_cost` inside the cost
-- attribution engine, the symmetric tie refusal, and the delete guard on approved usage. Fixture F1 + F2 are
-- docs/plans/2026-11-01-equipment-usage.md "Fixture F1" / "Ledger Fixture F2".
begin;
create extension if not exists pgtap;
select plan(32);

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
-- G7: Loader-1 October depreciation, 1000.00 (a version change mid-year, PQ-5 / FR-EQU-045); inserted superuser
insert into erp_gl_entry_mirror (id, org_id, erp_name, company, account, cost_center, fiscal_year, project, party_type, party, posting_date, debit, credit, is_cancelled, erp_modified) values
  ('15190000-0000-0000-0000-0000000001a7','15190000-0000-0000-0000-00000000000a','EQ-GL-7','EQ','Depreciation - EQ','Loader-1 - EQ','2026',null,null,null,'2026-10-15',1000.00,0,false,'1');

-- G8: ANOTHER org's ledger line on the same account and cost-centre text: must never enter org A's pool
insert into erp_gl_entry_mirror (id, org_id, erp_name, company, account, cost_center, fiscal_year, project, party_type, party, posting_date, debit, credit, is_cancelled, erp_modified) values
  ('15190000-0000-0000-0000-0000000001a8','15190000-0000-0000-0000-00000000000b','EQ-GL-8','EQ','Depreciation - EQ','Loader-1 - EQ','2026',null,null,null,'2026-09-30',777.00,0,false,'1');

-- LDR-1 September: P1 6 h and P2 2 h approved; P3 5 h Draft and 3 h Rejected (AC-EQU-006); a standby row that must not count (OQ-6)
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c1','2026-09-10',6,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c2','2026-09-11',2,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c3','2026-09-12',5,'hours','work','Draft');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c3','2026-09-13',3,'hours','work','Rejected');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c2','2026-09-14',4,'hours','standby');
-- LDR-1 October: litres decide the share once the driver changes to fuel
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c1','2026-10-05',1,'hours','work','Approved',30);
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c2','2026-10-06',3,'hours','work','Approved',10);
-- TRK-1 August: one day on each of P1, P2, P3 (AC-EQU-004)
select pg_temp.usage('15190000-0000-0000-0000-0000000000d2','15190000-0000-0000-0000-0000000000c1','2026-08-03',1,'days');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d2','15190000-0000-0000-0000-0000000000c2','2026-08-04',1,'days');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d2','15190000-0000-0000-0000-0000000000c3','2026-08-05',1,'days');
-- GEN-1 has approved usage and no costing at all (the delete guard leaves it alone)
select pg_temp.usage('15190000-0000-0000-0000-0000000000d3','15190000-0000-0000-0000-0000000000c1','2026-09-20',2,'hours');
create temp table _pv as select * from (values (null::uuid, null::date, null::numeric)) t(project_id, month, amount) where false;
grant all on _pv to authenticated;
create or replace function pg_temp.rows(p_sql text) returns int language plpgsql as $$
declare n int; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
create temp table _s (k text primary key, v jsonb) on commit drop;  grant all on _s to authenticated;
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');   -- Finance

-- ── AC-EQU-014: preview first (the unallocated July pool is shown before saving, AC-EQU-005) ─────────
insert into _pv select project_id, month, amount from preview_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d1",
  "basis":"actual_cost","driver":"units","rate_unit":"hours","account_group":"Plant - EQ","cost_center":"Loader-1 - EQ",
  "effective_from":"2026-01-01"}') where project_id is not null;
select is((select amount from preview_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d1",
  "basis":"actual_cost","driver":"units","rate_unit":"hours","account_group":"Plant - EQ","cost_center":"Loader-1 - EQ",
  "effective_from":"2026-01-01"}') where project_id is null and month = '2026-07-01'), 500.00::numeric,
  'AC-EQU-005 the preview shows the unallocated July pool before the setting is saved');

-- ── AC-EQU-001 the issue acceptance ──────────────────────────────────────────────────────────────────
insert into _s select 'ldr', save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d1","basis":"actual_cost",
  "driver":"units","rate_unit":"hours","account_group":"Plant - EQ","cost_center":"Loader-1 - EQ","effective_from":"2026-01-01"}');
select ok((select v ? 'setting_key' from _s where k = 'ldr'), 'AC-EQU-001 an actual-cost setting with no rate is saved');
select is(array(select project_id::text || '=' || amount::text from list_equipment_allocations(
    '15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30') where status = 'allocated' order by project_id),
  array['15190000-0000-0000-0000-0000000000c1=600.00','15190000-0000-0000-0000-0000000000c2=200.00'],
  'AC-EQU-001 an 800.00 pool on 6 h / 2 h allocates 600.00 and 200.00 with no rate');
select is((select row(pool, driver, driver_value, driver_total, version, entry_count, line_count)::text
             from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30')
            where project_id = '15190000-0000-0000-0000-0000000000c1'), '(800.00,units,6.00,8.00,1,1,1)',
  'AC-EQU-001 the drill-down shows pool, driver, shares, version and counts (FR-EQU-044)');
select is((select pool from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30')
            where project_id = '15190000-0000-0000-0000-0000000000c1'), 800.00::numeric,
  'AC-EQU-012 another org''s ledger line on the same account and cost centre never enters the pool');
select is((select driver_total from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30')
            where project_id = '15190000-0000-0000-0000-0000000000c2'), 8.00::numeric,
  'AC-EQU-001 standby usage does not enter the driver while count-standby is off (OQ-6)');
select is((select sum(amount) from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30')
            where project_id = '15190000-0000-0000-0000-0000000000c3'), null::numeric,
  'AC-EQU-006 draft and rejected usage never count');
select is((select count(*)::int from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30')
            where status = 'unallocated'), 0, 'AC-EQU-005 a month whose pool is fully shared has no unallocated remainder');
select set_eq($$ select project_id, month, amount from _pv $$,
  $$ select project_id, month, sum(amount) from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-01-01','2026-12-31')
       where status = 'allocated' group by 1, 2 $$,
  'AC-EQU-014 preview rows equal the saved allocations per project per month');
select is((select row(status, pool, reason)::text from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-07-01','2026-07-31')),
  '(unallocated,500.00,no_approved_usage)', 'AC-EQU-005 a pool with zero approved driver allocates nothing and shows as unallocated');

-- ── AC-EQU-004 the cent split ────────────────────────────────────────────────────────────────────────
select lives_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d2","basis":"actual_cost",
  "driver":"units","rate_unit":"days","account":"Fuel - EQ","cost_center":"Truck-1 - EQ","effective_from":"2026-01-01"}') $$,
  'AC-EQU-004 the TRK-1 actual-cost setting saves');
select is(array(select amount::text from list_equipment_allocations('15190000-0000-0000-0000-0000000000d2','2026-08-01','2026-08-31')
                 where status = 'allocated' order by project_id),
  array['33.33','33.33','33.34'], 'AC-EQU-004 a 1/3 split rounds to the cent, the last project takes the remainder');
select is((select sum(amount) from list_equipment_allocations('15190000-0000-0000-0000-0000000000d2','2026-08-01','2026-08-31')
            where status = 'allocated'), 100.00::numeric, 'AC-EQU-004 allocations sum exactly to the pool');
-- the per-project read (the project panel's) equals the per-asset reads, and the attributed path carries the share
select is((select sum(amount) from list_equipment_allocations(null, '2026-08-01', '2026-09-30', '15190000-0000-0000-0000-0000000000c1')
            where status = 'allocated'), 633.33::numeric, 'AC-EQU-001 the per-project read equals the per-asset reads (600.00 + 33.33)');
select is((select amount from cost_attribution_project_actuals('15190000-0000-0000-0000-0000000000c1', '2026') where category = 'Equipment'),
  883.33::numeric, 'AC-EQU-001 the actual-cost share reaches the attributed path in the mapped category (600.00 + 33.33 + October 250.00)');

-- ── AC-EQU-009 one winner per line ───────────────────────────────────────────────────────────────────
select lives_ok($$ select save_cost_attribution_rule('{"name":"Depreciation to P3","account":"Depreciation - EQ",
  "effective_from":"2026-01-01","targets":[{"project_id":"15190000-0000-0000-0000-0000000000c3","percent":100}]}') $$,
  'AC-EQU-009 a cost attribution rule below the equipment setting saves');
reset role;
select is((select array_agg(source || ':' || project_id::text order by source, project_id)
             from cost_attribution_engine('15190000-0000-0000-0000-00000000000a', null, null, null, null)
            where status = 'allocated' and account = 'Depreciation - EQ' and posting_date between '2026-09-01' and '2026-09-30'),
  array['equipment:15190000-0000-0000-0000-0000000000c1','equipment:15190000-0000-0000-0000-0000000000c2','rule:15190000-0000-0000-0000-0000000000c3'],
  'AC-EQU-009 a ledger line goes to one winner only');
select is((select count(*)::int from cost_attribution_allocations('15190000-0000-0000-0000-00000000000a', null, null)
            where gl_id = '15190000-0000-0000-0000-0000000001a1'), 0, 'AC-EQU-009 the rule does not also place the line the equipment setting won');
select is((select sum(amount) from cost_attribution_engine('15190000-0000-0000-0000-00000000000a', null, null, null, null)
            where status = 'allocated' and posting_date < '2026-10-01'), 1100.00::numeric,
  'AC-EQU-009 everything allocated equals the matched untagged lines (G1 + G5 + G6; the unallocated G2 is excluded)');
select is((select count(*)::int from cost_attribution_allocations('15190000-0000-0000-0000-00000000000a', null, null)
            where account = 'Depreciation - EQ' and posting_date between '2026-07-01' and '2026-07-31'), 0,
  'AC-EQU-005 an unallocated pool reaches no project figure');
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"actual_cost",
  "driver":"units","rate_unit":"hours","account":"Depreciation - EQ","effective_from":"2026-01-01"}') $$,
  '23505', null, 'AC-EQU-009 a setting that ties a cost attribution rule is refused');
select throws_ok($$ select save_cost_attribution_rule('{"name":"Plant to P3","account_group":"Plant - EQ","cost_center":"Loader-1 - EQ",
  "effective_from":"2026-01-01","targets":[{"project_id":"15190000-0000-0000-0000-0000000000c3","percent":100}]}') $$,
  '23505', null, 'AC-EQU-009 a rule that ties an equipment setting is refused (spec delta 4)');

-- ── AC-EQU-008 (actual_cost): the older version keeps its dates, the newer one drives from its start ──
select lives_ok($$ select save_equipment_costing(jsonb_build_object('setting_key', (select v->>'setting_key' from _s where k = 'ldr'),
  'expected_version', 1, 'asset_id', '15190000-0000-0000-0000-0000000000d1', 'basis', 'actual_cost', 'driver', 'fuel',
  'account_group', 'Plant - EQ', 'cost_center', 'Loader-1 - EQ', 'effective_from', '2026-10-01')) $$,
  'AC-EQU-008 a v2 actual-cost setting driven by fuel saves from 2026-10-01');
select is(array(select version::text || '=' || amount::text from list_equipment_allocations(
    '15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-10-31') where status = 'allocated' order by month, project_id),
  array['1=600.00','1=200.00','2=750.00','2=250.00'],
  'AC-EQU-008 September keeps v1 (hours), October uses v2 (litres): 30 L / 10 L shares 1000.00 as 750.00 / 250.00');

-- ── FR-EQU-064 / FR-EQU-012: an Admin cannot hard-delete approved usage inside an allocated month ───────
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a1');   -- Admin
select throws_ok($$ delete from equipment_usage_entries where asset_id = '15190000-0000-0000-0000-0000000000d1'
    and project_id = '15190000-0000-0000-0000-0000000000c1' and work_date = '2026-09-10' $$,
  '22023', null, 'AC-EQU-012 approved usage inside an allocated month cannot be hard-deleted (reopen, then archive)');
select is(pg_temp.rows($$ delete from equipment_usage_entries where asset_id = '15190000-0000-0000-0000-0000000000d1'
    and project_id = '15190000-0000-0000-0000-0000000000c3' and work_date = '2026-09-12' $$), 1,
  'AC-EQU-012 a Draft entry in an allocated month is still deletable by an Admin');
select is(pg_temp.rows($$ delete from equipment_usage_entries where asset_id = '15190000-0000-0000-0000-0000000000d3'
    and work_date = '2026-09-20' $$), 1,
  'AC-EQU-012 approved usage on an asset with no costing is still deletable by an Admin');
select lives_ok($$ select transition_equipment_usage((select id from equipment_usage_entries where asset_id = '15190000-0000-0000-0000-0000000000d1'
    and project_id = '15190000-0000-0000-0000-0000000000c1' and work_date = '2026-09-10'), 'Draft', 'correction') $$,
  'AC-EQU-012 an Admin reopens approved usage');
select is(array(select project_id::text || '=' || amount::text from list_equipment_allocations(
    '15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30') where status = 'allocated' order by project_id),
  array['15190000-0000-0000-0000-0000000000c2=800.00'], 'AC-EQU-006 reopened usage stops counting at once: P2 now carries the whole pool');
select is(pg_temp.rows($$ delete from equipment_usage_entries where asset_id = '15190000-0000-0000-0000-0000000000d1'
    and project_id = '15190000-0000-0000-0000-0000000000c1' and work_date = '2026-09-10' $$), 1,
  'AC-EQU-012 after the reopen the Admin can delete the entry');

-- ── AC-EQU-009: a MORE specific rule is allowed and takes the line; the equipment pool shrinks ─────────
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');
select lives_ok($$ select save_cost_attribution_rule('{"name":"Loader depreciation to P3","account":"Depreciation - EQ","cost_center":"Loader-1 - EQ",
  "effective_from":"2026-01-01","targets":[{"project_id":"15190000-0000-0000-0000-0000000000c3","percent":100}]}') $$,
  'AC-EQU-009 a more specific rule than the equipment setting saves');
reset role;
select is((select array_agg(source || ':' || project_id::text order by source, project_id)
             from cost_attribution_engine('15190000-0000-0000-0000-00000000000a', null, null, null, null)
            where status = 'allocated' and account = 'Depreciation - EQ' and posting_date between '2026-09-01' and '2026-09-30'),
  array['rule:15190000-0000-0000-0000-0000000000c3','rule:15190000-0000-0000-0000-0000000000c3'],
  'AC-EQU-009 the more specific rule takes both depreciation lines and no equipment share remains');

select * from finish();
rollback;
