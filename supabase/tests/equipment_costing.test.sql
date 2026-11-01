-- equipment_costing.test.sql — 0460 (#1519 S2). Owns AC-EQU-002/003/008/015 and the hire-rate half of AC-EQU-006
-- (docs/specs/equipment-usage.spec.md): costing settings (versioned, windowed), hire-rate charges, reads, the unit lock.
-- Fixture F1 is docs/plans/2026-11-01-equipment-usage.md "Fixture F1".
begin;
create extension if not exists pgtap;
select plan(52);

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


-- two more assets (CRN-1: basis none, CRN-2: actual-cost tie partner) and the account chart the match checks read
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('15190000-0000-0000-0000-0000000000d5', '15190000-0000-0000-0000-00000000000a', 'CRN-1', 'Crane 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d6', '15190000-0000-0000-0000-00000000000a', 'CRN-2', 'Crane 2', 'hours');
insert into erp_account_mirror (org_id, company, erp_name, account_name, root_type, report_type, parent_account, is_group, account_currency, lft, rgt, refresh_id) values
  ('15190000-0000-0000-0000-00000000000a','EQ','Plant - EQ','Plant','Expense','Profit and Loss',null,true,'IDR',1,6,'15190000-0000-0000-0000-0000000000f0'),
  ('15190000-0000-0000-0000-00000000000a','EQ','Depreciation - EQ','Depreciation','Expense','Profit and Loss','Plant - EQ',false,'IDR',2,3,'15190000-0000-0000-0000-0000000000f0'),
  ('15190000-0000-0000-0000-00000000000a','EQ','Fuel - EQ','Fuel','Expense','Profit and Loss','Plant - EQ',false,'IDR',4,5,'15190000-0000-0000-0000-0000000000f0');
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('15190000-0000-0000-0000-00000000000a','Equipment','Depreciation - EQ',true);

-- approved usage: EXC-1 (AC-EQU-003/006), GEN-1 (AC-EQU-008), CRN-1 (AC-EQU-002), TRK-1 days on P1/P2 with no setting
select pg_temp.usage('15190000-0000-0000-0000-0000000000d4','15190000-0000-0000-0000-0000000000c1','2026-10-05',10,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d4','15190000-0000-0000-0000-0000000000c1','2026-10-05',4,'hours','standby');
-- AC-EQU-006: Submitted, Rejected and an archived Approved row on EXC-1 must charge nothing
select pg_temp.usage('15190000-0000-0000-0000-0000000000d4','15190000-0000-0000-0000-0000000000c1','2026-10-06',3,'hours','work','Submitted');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d4','15190000-0000-0000-0000-0000000000c1','2026-10-07',5,'hours','work','Rejected');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d4','15190000-0000-0000-0000-0000000000c1','2026-10-08',5,'hours');
update equipment_usage_entries set archived_at = now() where asset_id = '15190000-0000-0000-0000-0000000000d4' and work_date = '2026-10-08';
select pg_temp.usage('15190000-0000-0000-0000-0000000000d3','15190000-0000-0000-0000-0000000000c1','2026-03-10',10,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d3','15190000-0000-0000-0000-0000000000c1','2026-03-11',4,'hours','standby');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d3','15190000-0000-0000-0000-0000000000c1','2026-08-10',10,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c1','2026-10-12',8,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c2','2026-10-13',6,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d2','15190000-0000-0000-0000-0000000000c1','2026-08-03',1,'days');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d2','15190000-0000-0000-0000-0000000000c2','2026-08-04',1,'days');
-- AC-EQU-015: LDR-1 holds a days entry on 2026-09-15; TRK-1 holds an hours entry on 2026-09-15 (actual-cost month start)
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c1','2026-09-15',1,'days');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d2','15190000-0000-0000-0000-0000000000c1','2026-09-15',5,'hours');

create temp table _s (k text primary key, v jsonb) on commit drop;  grant all on _s to authenticated;
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');   -- Finance

-- ── AC-EQU-003 hire rate with a standby rate; AC-EQU-006 hire-rate half ──────────────────────────────
insert into _s select 'exc', save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"hire_rate",
  "work_rate":50,"standby_rate":20,"rate_unit":"hours","effective_from":"2026-01-01"}');
select is((select amount from list_equipment_allocations('15190000-0000-0000-0000-0000000000d4','2026-10-01','2026-10-31')
            where project_id = '15190000-0000-0000-0000-0000000000c1'), 580.00::numeric,
  'AC-EQU-003 10 h work × 50 + 4 h standby × 20 = 580.00');
select is((select row(work_units, standby_units, work_rate, standby_rate, entry_count)::text
             from list_equipment_allocations('15190000-0000-0000-0000-0000000000d4','2026-10-01','2026-10-31')),
  '(10.00,4.00,50.00,20.00,2)', 'AC-EQU-003 the drill-down exposes units, rates and entry count (FR-EQU-044)');
select is((select sum(amount) from list_equipment_allocations('15190000-0000-0000-0000-0000000000d4','2026-10-01','2026-10-31')),
  580.00::numeric, 'AC-EQU-006 Submitted, Rejected and archived rows leave the hire charge at 580.00');
select is((select status from list_equipment_allocations('15190000-0000-0000-0000-0000000000d4','2026-10-01','2026-10-31')),
  'allocated', 'AC-EQU-003 a hire-rate charge reads as allocated');
select is((select driver from list_equipment_allocations('15190000-0000-0000-0000-0000000000d4','2026-10-01','2026-10-31')),
  null::text, 'FR-EQU-044 a hire-rate row names no driver (driver is an actual-cost input)');

-- ── AC-EQU-008 versions keep their own dates; a stale expected_version is refused ────────────────────
insert into _s select 'gen', save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d3","basis":"hire_rate",
  "work_rate":50,"rate_unit":"hours","effective_from":"2026-01-01"}');
select lives_ok($$ select save_equipment_costing(jsonb_build_object('setting_key',(select v->>'setting_key' from _s where k='gen'),
  'expected_version',1,'asset_id','15190000-0000-0000-0000-0000000000d3','basis','hire_rate','work_rate',60,'rate_unit','hours',
  'effective_from','2026-07-01')) $$, 'AC-EQU-008 v2 from mid-year is saved');
select is(array(select month::text || '=' || amount::text || '@v' || version from list_equipment_allocations(
  '15190000-0000-0000-0000-0000000000d3','2026-01-01','2026-12-31') order by month),
  array['2026-03-01=500.00@v1','2026-08-01=600.00@v2'], 'AC-EQU-008 periods before the change keep v1, after use v2 (standby with no standby rate charges nothing)');
select throws_ok($$ select save_equipment_costing(jsonb_build_object('setting_key',(select v->>'setting_key' from _s where k='gen'),
  'expected_version',1,'asset_id','15190000-0000-0000-0000-0000000000d3','basis','hire_rate','work_rate',70,'rate_unit','hours',
  'effective_from','2026-09-01')) $$, '40001', null, 'AC-EQU-008 a stale expected_version is refused');
select throws_ok($$ select save_equipment_costing(jsonb_build_object('setting_key',(select v->>'setting_key' from _s where k='gen'),
  'asset_id','15190000-0000-0000-0000-0000000000d3','basis','hire_rate','work_rate',70,'rate_unit','hours',
  'effective_from','2026-09-01')) $$, '40001', null, 'AC-EQU-008 a missing expected_version is refused');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a1');   -- audit_events is Admin-readable
select is((select count(*)::int from audit_events where action like 'equipment_costing.%'), 3,
  'AC-EQU-008 each saved version wrote an audit row');
select ok((select detail ? 'before' and detail ? 'after' and detail ? 'version' from audit_events
            where action = 'equipment_costing.update'), 'AC-EQU-008 the audit row carries before and after');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from list_equipment_costing(true) where setting_key = (select (v->>'setting_key')::uuid from _s where k='gen')), 2,
  'AC-EQU-008 the history lists both versions');
select is((select count(*)::int from list_equipment_costing(false) where setting_key = (select (v->>'setting_key')::uuid from _s where k='gen')), 1,
  'AC-EQU-008 the default list holds only the current version');
select is((select changed from jsonb_to_record(save_equipment_costing(jsonb_build_object('setting_key',(select v->>'setting_key' from _s where k='gen'),
  'expected_version',2,'asset_id','15190000-0000-0000-0000-0000000000d3','basis','hire_rate','work_rate',60,'rate_unit','hours',
  'effective_from','2026-07-01'))) as x(changed boolean)), false, 'AC-EQU-008 an identical save writes no new version');

-- preview = save: a v2 on EXC-1 from 2026-10-01 previews the same figure the saved list then shows
select is((select amount from preview_equipment_costing(jsonb_build_object('setting_key',(select v->>'setting_key' from _s where k='exc'),
  'expected_version',1,'asset_id','15190000-0000-0000-0000-0000000000d4','basis','hire_rate','work_rate',55,'standby_rate',20,
  'rate_unit','hours','effective_from','2026-10-01'))), 630.00::numeric, 'AC-EQU-003 a draft previews its own charge (10 × 55 + 4 × 20)');
select lives_ok($$ select save_equipment_costing(jsonb_build_object('setting_key',(select v->>'setting_key' from _s where k='exc'),
  'expected_version',1,'asset_id','15190000-0000-0000-0000-0000000000d4','basis','hire_rate','work_rate',55,'standby_rate',20,
  'rate_unit','hours','effective_from','2026-10-01')) $$, 'AC-EQU-008 EXC-1 v2 saved from 2026-10-01');
select is((select amount from list_equipment_allocations('15190000-0000-0000-0000-0000000000d4','2026-10-01','2026-10-31')),
  630.00::numeric, 'AC-EQU-003 the saved figure equals the preview');

-- ── AC-EQU-002 basis none: usage only, no amount ─────────────────────────────────────────────────────
insert into _s select 'crn', save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d5","basis":"none","effective_from":"2026-01-01"}');
select is((select count(*)::int from list_equipment_allocations('15190000-0000-0000-0000-0000000000d5','2026-10-01','2026-10-31')
            where status = 'usage_only' and amount is null), 2,
  'AC-EQU-002 basis none shows usage per project and no amount');
select is(array(select project_id::text || '=' || work_units::text from list_equipment_usage_totals(null,'15190000-0000-0000-0000-0000000000d5','2026-10-01','2026-10-31') order by project_id),
  array['15190000-0000-0000-0000-0000000000c1=8.00','15190000-0000-0000-0000-0000000000c2=6.00'], 'AC-EQU-002 usage totals show both projects');
select is((select count(*)::int from preview_equipment_costing(jsonb_build_object('asset_id','15190000-0000-0000-0000-0000000000d5','basis','none',
  'effective_from','2026-01-01','setting_key',(select v->>'setting_key' from _s where k='crn'),'expected_version',1))), 0,
  'AC-EQU-002 previewing a none draft returns zero rows');
select is((select count(*)::int from list_equipment_allocations('15190000-0000-0000-0000-0000000000d2','2026-08-01','2026-08-31')
            where status = 'usage_only' and amount is null and basis = 'none'), 2,
  'AC-EQU-002 an asset with no setting at all reads the same way');
select is((select sum(amount) from list_equipment_allocations('15190000-0000-0000-0000-0000000000d2','2026-08-01','2026-08-31')), null::numeric,
  'AC-EQU-002 no amount is computed for an asset with no setting');
select is((select (v->>'version')::int from (select end_equipment_costing((select (v->>'setting_key')::uuid from _s where k='crn'),'2026-10-31',1) v) x), 2,
  'AC-EQU-008 ending a setting writes a new version');
select is((select effective_to from list_equipment_costing(false) where setting_key = (select (v->>'setting_key')::uuid from _s where k='crn')),
  '2026-10-31'::date, 'AC-EQU-008 the ended setting lists its end date');
select throws_ok($$ select end_equipment_costing((select (v->>'setting_key')::uuid from _s where k='crn'),'2026-09-30',1) $$,
  '40001', null, 'AC-EQU-008 ending with a stale expected_version is refused');

-- ── AC-EQU-015 mixed units ───────────────────────────────────────────────────────────────────────────
select throws_like($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d1","basis":"hire_rate",
  "work_rate":40,"rate_unit":"hours","effective_from":"2026-09-01"}') $$, '%mixed units%',
  'AC-EQU-015 a units setting after a day entry in the window is refused (mixed units)');
select lives_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d1","basis":"hire_rate",
  "work_rate":40,"rate_unit":"hours","effective_from":"2026-10-01"}') $$, 'AC-EQU-015 the same setting from after the day entry is saved');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');   -- Eng1
select throws_like($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1","project_id":"15190000-0000-0000-0000-0000000000c1",
  "work_date":"2026-10-15","quantity":1,"unit":"days"}') $$, '%costed per hours%',
  'AC-EQU-015 logging a day entry on a date an hours setting covers is refused');
select lives_ok($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1","project_id":"15190000-0000-0000-0000-0000000000c1",
  "work_date":"2026-09-20","quantity":1,"unit":"days"}') $$, 'AC-EQU-015 a day entry before the setting''s window still saves');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');
select throws_like($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d2","basis":"actual_cost","driver":"units",
  "rate_unit":"days","account":"Fuel - EQ","effective_from":"2026-09-16"}') $$, '%mixed units%',
  'AC-EQU-015 an actual-cost units setting checks from the first day of its first month (PQ-5)');

-- ── conflicts (FR-EQU-034) ───────────────────────────────────────────────────────────────────────────
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"none","effective_from":"2026-06-01"}') $$,
  '23505', null, 'FR-EQU-034 a second setting on the same asset over overlapping dates is refused');
select lives_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"none","effective_from":"2025-01-01","effective_to":"2025-12-31"}') $$,
  'FR-EQU-034 a second setting on the same asset over a disjoint window is saved');
insert into _s select 'rule', save_cost_attribution_rule('{"name":"Plant to P3","account_group":"Plant - EQ","cost_center":"Truck-1 - EQ","effective_from":"2026-01-01",
  "targets":[{"project_id":"15190000-0000-0000-0000-0000000000c3","percent":100}]}');
select throws_like($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d2","basis":"actual_cost","driver":"units",
  "rate_unit":"days","account_group":"Plant - EQ","cost_center":"Truck-1 - EQ","effective_from":"2026-10-01"}') $$, '%Plant to P3%',
  'FR-EQU-034 an actual-cost match tying a cost attribution rule is refused, naming the rule');
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d2","basis":"actual_cost","driver":"units",
  "rate_unit":"days","account_group":"Plant - EQ","effective_from":"2026-10-01"}') $$,
  '23505', null, 'FR-EQU-034 a less specific match under a more specific rule is refused');
select lives_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d2","basis":"actual_cost","driver":"units",
  "rate_unit":"days","account":"Fuel - EQ","cost_center":"Truck-1 - EQ","effective_from":"2026-10-01"}') $$,
  'FR-EQU-034 a more specific actual-cost match than the rule is saved');
select throws_like($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d6","basis":"actual_cost","driver":"fuel",
  "account":"Fuel - EQ","cost_center":"Truck-1 - EQ","effective_from":"2026-10-01"}') $$, '%TRK-1%',
  'FR-EQU-034 an actual-cost match tying another asset''s setting is refused, naming that asset');

-- ── shape and reference validation ───────────────────────────────────────────────────────────────────
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d6","basis":"hire_rate","rate_unit":"hours","effective_from":"2026-01-01"}') $$,
  '22023', null, 'FR-EQU-031 a hire rate without a work rate is refused');
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d6","basis":"hire_rate","work_rate":-1,"rate_unit":"hours","effective_from":"2026-01-01"}') $$,
  '22023', null, 'FR-EQU-031 a negative rate is refused');
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d6","basis":"actual_cost","account":"Fuel - EQ","effective_from":"2026-01-01"}') $$,
  '22023', null, 'FR-EQU-032 an actual-cost setting without a driver is refused');
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d6","basis":"actual_cost","driver":"trips","account":"No Such - EQ","effective_from":"2026-01-01"}') $$,
  'P0002', null, 'FR-EQU-032 an unknown ledger account is refused');
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d6","basis":"hire_rate","work_rate":10,"rate_unit":"hours",
  "charge_category":"Labor","effective_from":"2026-01-01"}') $$, 'P0002', null, 'PQ-3 a hire-rate charge category with no mapped account is refused (PQ-3)');
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d9","basis":"none","effective_from":"2026-01-01"}') $$,
  'P0002', null, 'AC-EQU-012 a foreign asset is refused');

-- ── reads ────────────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ select * from list_equipment_allocations(null,'2026-10-01','2026-10-31') $$, '22023', null,
  'AC-EQU-002 a read names an asset or a project');
select throws_ok($$ select * from list_equipment_allocations('15190000-0000-0000-0000-0000000000d4','2024-01-01','2026-12-31') $$, '22023', null,
  'AC-EQU-002 a read spans at most two years');
select is((select sum(amount) from list_equipment_allocations(null,'2026-10-01','2026-10-31','15190000-0000-0000-0000-0000000000c1')), 630.00::numeric,
  'AC-EQU-003 the project view of the allocations lists the project''s charges');
select is((select row(work_units, standby_units, submitted_count)::text from list_equipment_usage_totals(
  '15190000-0000-0000-0000-0000000000c1','15190000-0000-0000-0000-0000000000d4','2026-10-01','2026-10-31')),
  '(10.00,4.00,1)', 'AC-EQU-002 usage totals count approved units and what is waiting');

-- ── a charge never counts an entry in another unit than the rate ─────────────────────────────────────
-- HIR-1: a day entry is rejected before an hours rate is saved; redrafting and submitting it must be refused (FR-EQU-032)
reset role;
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('15190000-0000-0000-0000-0000000000d7', '15190000-0000-0000-0000-00000000000a', 'HIR-1', 'Hired 1', 'hours');
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');   -- Eng1
insert into _s select 'day', save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d7","project_id":"15190000-0000-0000-0000-0000000000c1",
  "work_date":"2026-10-15","quantity":1,"unit":"days"}');
select transition_equipment_usage((select (v->>'id')::uuid from _s where k = 'day'), 'Submitted');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1 manages P1
select transition_equipment_usage((select (v->>'id')::uuid from _s where k = 'day'), 'Rejected');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');   -- Finance: a Rejected row does not block the unit
select lives_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d7","basis":"hire_rate",
  "work_rate":100,"rate_unit":"hours","effective_from":"2026-10-01"}') $$, 'AC-EQU-015 an hours rate is saved while the only day entry is Rejected');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');
select transition_equipment_usage((select (v->>'id')::uuid from _s where k = 'day'), 'Draft');
select throws_like($$ select transition_equipment_usage((select (v->>'id')::uuid from _s where k = 'day'), 'Submitted') $$,
  '%costed per hours%', 'AC-EQU-015 resubmitting a day entry under an hours rate is refused');
-- a Submitted day entry that slipped past the save-time check (a race) cannot be approved either
reset role;
select pg_temp.usage('15190000-0000-0000-0000-0000000000d7','15190000-0000-0000-0000-0000000000c1','2026-10-17',1,'days','work','Submitted');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d7','15190000-0000-0000-0000-0000000000c1','2026-10-16',1,'days');   -- Approved
select pg_temp.usage('15190000-0000-0000-0000-0000000000d7','15190000-0000-0000-0000-0000000000c1','2026-10-18',3,'hours');
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');
select throws_like($$ select transition_equipment_usage((select id from equipment_usage_entries
  where asset_id = '15190000-0000-0000-0000-0000000000d7' and work_date = '2026-10-17'), 'Approved') $$,
  '%costed per hours%', 'AC-EQU-015 approving a day entry under an hours rate is refused');
select is((select row(count(*), sum(work_units), sum(amount))::text from list_equipment_allocations(
  '15190000-0000-0000-0000-0000000000d7','2026-10-01','2026-10-31') where status = 'allocated'), '(1,3.00,300.00)',
  'AC-EQU-015 the hire charge counts only the hours entry (3 h × 100), never the approved day entry');
select is((select row(unit, work_units, amount)::text from list_equipment_allocations(
  '15190000-0000-0000-0000-0000000000d7','2026-10-01','2026-10-31') where status = 'usage_only'), '(days,1.00,)',
  'AC-EQU-015 an approved entry in another unit surfaces as usage, never priced');

-- ── list_equipment_costing tells a voided version from an open-ended one (FR-EQU-045) ─────────────────
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');
insert into _s select 'vd', save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d6","basis":"hire_rate",
  "work_rate":10,"rate_unit":"hours","effective_from":"2026-01-01"}');
select save_equipment_costing(jsonb_build_object('setting_key',(select v->>'setting_key' from _s where k='vd'),'expected_version',1,
  'asset_id','15190000-0000-0000-0000-0000000000d6','basis','hire_rate','work_rate',12,'rate_unit','hours','effective_from','2026-01-01'));
select is(array(select version::text || ':' || voided::text || ':' || coalesce(window_to::text, 'open')
                  from list_equipment_costing(true) where setting_key = (select (v->>'setting_key')::uuid from _s where k='vd') order by version),
  array['1:true:open','2:false:open'], 'AC-EQU-008 a version replaced on its own start day reads voided, the open-ended current one does not');

select * from finish();
rollback;
