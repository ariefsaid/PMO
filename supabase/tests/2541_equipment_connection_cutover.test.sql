begin;
create extension if not exists pgtap;
select plan(18);
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

set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');
select lives_ok($$select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d5","basis":"hire_rate","work_rate":50,"rate_unit":"hours","effective_from":"2026-01-01"}')$$, 'AC-EQU-CUT-001 native crane rate saves without mapping');
reset role;
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c1','2026-10-14',2,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c1','2026-10-15',3,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c1','2026-10-16',4,'hours');
set local role authenticated;
-- Connection-period ownership intentionally replaces the former permanent suppression after the first date.
select is((select amount from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')),450::numeric,'AC-EQU-CUT-001 before connection all approved native days count');
reset role;
insert into budget_category_account_map(org_id,category,erp_account,is_push_target) values ('15190000-0000-0000-0000-00000000000a','Equipment','Depreciation - EQ',true);
insert into external_org_bindings(org_id,external_tier,site_url,secret_ref,status,connected_by,connected_at) values
('15190000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref','active','15190000-0000-0000-0000-0000000000a1','2026-10-15 12:00:00+00');
insert into erp_actuals_snapshot(org_id,project_id,account,fiscal_year,debit,credit,net,snapshot_id) values
('15190000-0000-0000-0000-00000000000a','15190000-0000-0000-0000-0000000000c1','Depreciation - EQ','2026',350,0,350,'15190000-0000-0000-0000-0000000000e1');
set local role authenticated;
select is((select amount from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')),100::numeric,'AC-EQU-CUT-001 only days strictly before connection retain native hire cost');
select is((get_project_finances('15190000-0000-0000-0000-0000000000c1')->'actuals'->>'total')::numeric,450::numeric,'AC-EQU-CUT-001 native 100 before boundary plus ledger 350 from boundary counts once');
reset role;
update external_org_bindings set status='disconnected',disconnected_at='2026-10-16 12:00:00+00' where org_id='15190000-0000-0000-0000-00000000000a';
set local role authenticated;
select is((get_project_finances('15190000-0000-0000-0000-0000000000c1')->'actuals'->>'total')::numeric,300::numeric,
 'AC-EQU-PERIOD-001 disconnect restores native cost on the disconnect day, while the earlier connected day stays excluded');
-- The allocation drilldown is monthly; preserve that rule and measure the newly native day's increment.
select is((select amount from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1'))-100,200::numeric,
 'AC-EQU-PERIOD-001 four crane hours on the first disconnected day cost 200');
reset role;
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c1','2026-10-17',5,'hours');
delete from budget_category_account_map where org_id='15190000-0000-0000-0000-00000000000a';
set local role authenticated;
select lives_ok($$select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d6","basis":"hire_rate","work_rate":60,"rate_unit":"hours","effective_from":"2026-01-01"}')$$,'AC-EQU-CUT-002 disconnected organization saves an unmapped rate');
reset role;
select throws_ok($$update external_org_bindings set status='active',connected_at='2026-11-15 12:00:00+00' where org_id='15190000-0000-0000-0000-00000000000a'$$,'P0002','map an account to the Equipment category first','AC-EQU-CUT-002 reconnect refuses saved unmapped hire rate with the same error');
insert into budget_category_account_map(org_id,category,erp_account,is_push_target) values ('15190000-0000-0000-0000-00000000000a','Equipment','Depreciation - EQ',true);
update external_org_bindings set status='active',connected_at='2026-11-15 12:00:00+00' where org_id='15190000-0000-0000-0000-00000000000a';
set local role authenticated;
select is((select amount from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')),550::numeric,'AC-EQU-CUT-003 reconnect preserves the first ledger interval and native cost in the disconnected gap');
reset role;
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c1','2026-11-14',1,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c1','2026-11-15',2,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c1','2026-11-16',3,'hours');
-- Ledger fixture carries only connected-day costs: October 15 (150), November 15 (100), November 16 (150).
update erp_actuals_snapshot set debit=400,net=400 where org_id='15190000-0000-0000-0000-00000000000a';
set local role authenticated;
select is((select amount from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')),600::numeric,
 'AC-EQU-PERIOD-002 native hire includes every disconnected day, excluding the reconnect day and later connected days');
select is((get_project_finances('15190000-0000-0000-0000-0000000000c1')->'actuals'->>'total')::numeric,1000::numeric,
 'AC-EQU-PERIOD-002 native 600 plus connected-day ledger 400 counts the crane cost once across both connection boundaries');
reset role;
update external_org_bindings set status='disconnected',disconnected_at='2026-11-16 12:00:00+00' where org_id='15190000-0000-0000-0000-00000000000a';
set local role authenticated;
select is((select amount from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')),750::numeric,
 'AC-EQU-PERIOD-003 a second disconnect restores its day without losing the first native gap');
reset role;
update external_org_bindings set status='active',connected_at='2026-11-17 12:00:00+00' where org_id='15190000-0000-0000-0000-00000000000a';
set local role authenticated;
select is((select amount from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')),750::numeric,
 'AC-EQU-PERIOD-003 a second reconnect retains both historical native gaps');
reset role;
-- Odoo retains its original ledger-basis switch marker when a connection is renewed.
update external_org_bindings set external_tier='odoo',activated_at='2026-11-17 12:00:00+00',config='{"ledger_basis_at":"2026-10-15 12:00:00+00"}' where org_id='15190000-0000-0000-0000-00000000000a';
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c1','2026-11-18',4,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c1','2026-11-19',5,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d5','15190000-0000-0000-0000-0000000000c1','2026-11-20',6,'hours');
update external_org_bindings set status='disconnected',activated_at=null,disconnected_at='2026-11-18 12:00:00+00' where org_id='15190000-0000-0000-0000-00000000000a';
set local role authenticated;
select is((select amount from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')),1500::numeric,
 'AC-EQU-PERIOD-004 Odoo disconnection restores native hire from its disconnection day');
reset role;
update external_org_bindings set status='active',connected_at='2026-11-20 12:00:00+00',activated_at='2026-11-20 12:00:00+00' where org_id='15190000-0000-0000-0000-00000000000a';
set local role authenticated;
select is((select amount from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')),1200::numeric,
 'AC-EQU-PERIOD-004 Odoo reconnect starts a new interval at activation, preserving its native gap despite an older ledger-basis marker');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000b1');
select is((select count(*) from equipment_charge_project_actuals('15190000-0000-0000-0000-0000000000c1')),0::bigint,'AC-EQU-CUT-004 another organization reads no native charges');
reset role;
insert into external_org_bindings(org_id,external_tier,site_url,secret_ref,status,activated_at,created_at) values
('15190000-0000-0000-0000-00000000000b','erpnext','https://erp.example.test','test-ref','active','2026-09-03 12:00:00+00','2026-09-01 12:00:00+00');
select is((select effective_on from equipment_accounting_cutover where org_id='15190000-0000-0000-0000-00000000000b'),'2026-09-03'::date,
 'AC-EQU-CUT-005 a legacy binding with no connected timestamp uses its activation day');
insert into organizations(id,name,default_currency,default_timezone) values ('15190000-0000-0000-0000-00000000000c','Legacy costing','IDR','UTC');
insert into external_org_bindings(org_id,external_tier,site_url,secret_ref,status,created_at) values
('15190000-0000-0000-0000-00000000000c','erpnext','https://erp.example.test','test-ref','active','2026-08-01 12:00:00+00');
select is((select effective_on from equipment_accounting_cutover where org_id='15190000-0000-0000-0000-00000000000c'),'2026-08-01'::date,
 'AC-EQU-CUT-005 a legacy binding without connection or activation timestamps uses its persisted creation day');
select * from finish();
rollback;
