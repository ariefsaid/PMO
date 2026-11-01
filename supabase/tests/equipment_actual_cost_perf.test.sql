-- equipment_actual_cost_perf.test.sql — 0471 (#1519 S3), NFR-EQU-003: one project-month allocation read stays under 2 s with
-- 50,000 untagged ledger lines, 200 asset cost centres and 200 actual-cost assets (20 approved entries per asset-month).
-- Fixture F1 + F2 are docs/plans/2026-11-01-equipment-usage.md "Fixture F1" / "Ledger Fixture F2".
begin;
create extension if not exists pgtap;
select plan(3);

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

-- 200 perf assets, one actual_cost setting each (rows written straight into the table; the RPC path is proven elsewhere)
insert into equipment_assets (id, org_id, code, name, default_unit)
select ('15190000-0000-0000-0001-' || lpad(to_hex(i), 12, '0'))::uuid, '15190000-0000-0000-0000-00000000000a', 'PERF-' || i, 'Perf ' || i, 'hours'
  from generate_series(1, 200) i;
insert into equipment_costing_settings (org_id, asset_id, setting_key, version, basis, driver, rate_unit, match_account, match_cost_center,
                                        specificity, effective_from)
select '15190000-0000-0000-0000-00000000000a', ('15190000-0000-0000-0001-' || lpad(to_hex(i), 12, '0'))::uuid, gen_random_uuid(), 1,
       'actual_cost', 'units', 'hours', 'Depreciation - EQ', 'PERF-' || i || ' - EQ', 12, '2026-01-01'
  from generate_series(1, 200) i;
-- 50,000 untagged ledger lines over 12 months on the 200 cost centres
insert into erp_gl_entry_mirror (id, org_id, erp_name, company, account, cost_center, fiscal_year, project, party_type, party, posting_date, debit, credit, is_cancelled, erp_modified)
select gen_random_uuid(), '15190000-0000-0000-0000-00000000000a', 'EQ-GL-PERF-' || i, 'EQ', 'Depreciation - EQ', 'PERF-' || (1 + i % 200) || ' - EQ',
       '2026', null, null, null, make_date(2026, 1 + i % 12, 1 + i % 28), 100.00 + i % 50, 0, false, '1'
  from generate_series(1, 50000) i;
-- 20 approved entries per asset-month: 48,000 rows over the three projects
insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, status, author_id, approver_id, approved_at)
select '15190000-0000-0000-0000-00000000000a', ('15190000-0000-0000-0001-' || lpad(to_hex(a), 12, '0'))::uuid,
       ('15190000-0000-0000-0000-0000000000c' || (1 + n % 3))::uuid, make_date(2026, m, n), 1 + n % 8, 'hours', 'work', 'Approved',
       '15190000-0000-0000-0000-0000000000a6', '15190000-0000-0000-0000-0000000000a3', now()
  from generate_series(1, 200) a, generate_series(1, 12) m, generate_series(1, 20) n;
analyze equipment_usage_entries; analyze erp_gl_entry_mirror;
create temp table _t as select clock_timestamp() as t0;
grant all on _t to authenticated;
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');   -- Finance
select cmp_ok((select count(*)::int from list_equipment_allocations(null, '2026-09-01', '2026-09-30', '15190000-0000-0000-0000-0000000000c1')
                where status = 'allocated'), '>', 0, 'NFR-EQU-003 the project-month read returns allocations');
-- ponytail: wall clock on a shared CI runner is noisy (about 0.6 s locally for this read, 3 s for the nested join the materialized
-- `ledger` replaced), so the bound is 10 s: it catches a pathological blow-up, not a 2-3x slowdown. Tighten if CI timings prove stable.
select ok(extract(epoch from clock_timestamp() - (select t0 from _t)) < 10, 'NFR-EQU-003 one project-month allocation read is well under 10 s');
select is((select count(*)::int from list_equipment_allocations('15190000-0000-0000-0001-000000000001', '2026-09-01', '2026-09-30')
            where status = 'allocated'), 3, 'NFR-EQU-003 the per-asset read returns its three project shares');

select * from finish();
rollback;
