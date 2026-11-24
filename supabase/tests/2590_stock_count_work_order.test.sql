-- 2590_stock_count_work_order.test.sql — stock count variance booked to a work order (docs/specs/stock-count-work-order.spec.md).
-- Migration under test: 2590_stock_count_work_order.sql.
-- AC-SCW-001 attribution + warehouse guards · AC-SCW-002 SoD + material completion · AC-SCW-003 stock-issue costing & conservation.
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values
  ('25900000-0000-0000-0000-00000000000a', 'SCW Org', 'IDR', 'UTC'),
  ('25900000-0000-0000-0000-00000000000b', 'SCW Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('25900000-0000-0000-0000-0000000000a1', 'scw-admin@example.com'),
  ('25900000-0000-0000-0000-0000000000a2', 'scw-keeper@example.com'),
  ('25900000-0000-0000-0000-0000000000a3', 'scw-mc@example.com'),
  ('25900000-0000-0000-0000-0000000000a4', 'scw-plain@example.com'),
  ('25900000-0000-0000-0000-0000000000b1', 'scw-other-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25900000-0000-0000-0000-0000000000a1', '25900000-0000-0000-0000-00000000000a', 'SCW Admin', 'scw-admin@example.com', 'Admin', 'active'),
  ('25900000-0000-0000-0000-0000000000a2', '25900000-0000-0000-0000-00000000000a', 'SCW Keeper', 'scw-keeper@example.com', 'Engineer', 'active'),
  ('25900000-0000-0000-0000-0000000000a3', '25900000-0000-0000-0000-00000000000a', 'SCW MatCoord', 'scw-mc@example.com', 'Engineer', 'active'),
  ('25900000-0000-0000-0000-0000000000a4', '25900000-0000-0000-0000-00000000000a', 'SCW Plain', 'scw-plain@example.com', 'Engineer', 'active'),
  ('25900000-0000-0000-0000-0000000000b1', '25900000-0000-0000-0000-00000000000b', 'SCW Other Admin', 'scw-other-admin@example.com', 'Admin', 'active');
update profiles set built_in_role_key = 'material_coordinator' where id = '25900000-0000-0000-0000-0000000000a3';

insert into companies (id, org_id, name, type) values
  ('25900000-0000-0000-0000-0000000000f1', '25900000-0000-0000-0000-00000000000a', 'SCW Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id, currency) values
  ('25900000-0000-0000-0000-0000000000c1', '25900000-0000-0000-0000-00000000000a', 'SCW Project One', 'Ongoing Project', 100000, 'exclusive', 0, '25900000-0000-0000-0000-0000000000f1', '25900000-0000-0000-0000-0000000000a1', 'IDR'),
  ('25900000-0000-0000-0000-0000000000c2', '25900000-0000-0000-0000-00000000000a', 'SCW Project Two', 'Ongoing Project', 100000, 'exclusive', 0, '25900000-0000-0000-0000-0000000000f1', '25900000-0000-0000-0000-0000000000a1', 'IDR'),
  ('25900000-0000-0000-0000-0000000000c9', '25900000-0000-0000-0000-00000000000b', 'SCW Other Project', 'Ongoing Project', 100000, 'exclusive', 0, null, '25900000-0000-0000-0000-0000000000b1', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('25900000-0000-0000-0000-000000000401', '25900000-0000-0000-0000-00000000000a', '25900000-0000-0000-0000-0000000000c1', 'WO-SCW-1', 'SCW WO One', 'Issued', 50000, 'exclusive', 0, 'IDR'),
  ('25900000-0000-0000-0000-000000000402', '25900000-0000-0000-0000-00000000000a', '25900000-0000-0000-0000-0000000000c1', 'WO-SCW-2', 'SCW WO Two', 'Issued', 50000, 'exclusive', 0, 'IDR'),
  ('25900000-0000-0000-0000-000000000403', '25900000-0000-0000-0000-00000000000a', '25900000-0000-0000-0000-0000000000c2', 'WO-SCW-3', 'SCW WO Other Proj', 'Issued', 50000, 'exclusive', 0, 'IDR'),
  ('25900000-0000-0000-0000-000000000409', '25900000-0000-0000-0000-00000000000b', '25900000-0000-0000-0000-0000000000c9', 'WO-SCW-X', 'SCW WO Other Org', 'Issued', 50000, 'exclusive', 0, 'IDR');
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, cancelled_at, currency) values
  ('25900000-0000-0000-0000-000000000404', '25900000-0000-0000-0000-00000000000a', '25900000-0000-0000-0000-0000000000c1', 'WO-SCW-C', 'SCW WO Cancelled', 'Cancelled', 0, 'exclusive', 0, now(), 'IDR');
set local session_replication_role = origin;

insert into stock_units (id, org_id, code, name, whole_only) values
  ('25900000-0000-0000-0000-0000000000d1', '25900000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('25900000-0000-0000-0000-000000001001', '25900000-0000-0000-0000-00000000000a', 'BOLT', 'Bolt', '25900000-0000-0000-0000-0000000000d1'),
  ('25900000-0000-0000-0000-000000001002', '25900000-0000-0000-0000-00000000000a', 'NUT',  'Nut',  '25900000-0000-0000-0000-0000000000d1');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('25900000-0000-0000-0000-000000002001', '25900000-0000-0000-0000-00000000000a', 'CEN',   'Central', 'central', null),
  ('25900000-0000-0000-0000-000000002002', '25900000-0000-0000-0000-00000000000a', 'SITE1', 'Site One', 'site', '25900000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('25900000-0000-0000-0000-00000000000a', '25900000-0000-0000-0000-000000002001', '25900000-0000-0000-0000-0000000000a2'),
  ('25900000-0000-0000-0000-00000000000a', '25900000-0000-0000-0000-000000002002', '25900000-0000-0000-0000-0000000000a2');

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Seed 10 BOLT at 100 each (value 1000) and 10 NUT at 50 each (value 500) into SITE1 on 2026-11-20.
select pg_temp.act_as('25900000-0000-0000-0000-0000000000a1');
select create_stock_document(
  jsonb_build_object('kind','receive','warehouse_id','25900000-0000-0000-0000-000000002002','occurred_on','2026-11-20'),
  jsonb_build_array(
    jsonb_build_object('item_id','25900000-0000-0000-0000-000000001001','quantity',10,'unit_cost',100),
    jsonb_build_object('item_id','25900000-0000-0000-0000-000000001002','quantity',10,'unit_cost',50)),
  true);
-- Seed 10 BOLT in CEN for central-warehouse refusal test.
select create_stock_document(
  jsonb_build_object('kind','receive','warehouse_id','25900000-0000-0000-0000-000000002001','occurred_on','2026-11-20'),
  jsonb_build_array(jsonb_build_object('item_id','25900000-0000-0000-0000-000000001001','quantity',10,'unit_cost',100)),
  true);

-- AC-SCW-001: Refusals for invalid work orders on a count.
select pg_temp.act_as('25900000-0000-0000-0000-0000000000a2');
select throws_ok($$
  select create_stock_document(
    jsonb_build_object('kind','count','warehouse_id','25900000-0000-0000-0000-000000002001','work_order_id','25900000-0000-0000-0000-000000000401','reason','central check'),
    jsonb_build_array(jsonb_build_object('item_id','25900000-0000-0000-0000-000000001001','counted_quantity',9)), false)
$$, '23514', 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order', 'AC-SCW-001 central warehouse count cannot name a work order');

select throws_ok($$
  select create_stock_document(
    jsonb_build_object('kind','count','warehouse_id','25900000-0000-0000-0000-000000002002','work_order_id','25900000-0000-0000-0000-000000000403','reason','wrong proj'),
    jsonb_build_array(jsonb_build_object('item_id','25900000-0000-0000-0000-000000001001','counted_quantity',9)), false)
$$, '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-SCW-001 count cannot name a work order of another project');

select throws_ok($$
  select create_stock_document(
    jsonb_build_object('kind','count','warehouse_id','25900000-0000-0000-0000-000000002002','work_order_id','25900000-0000-0000-0000-000000000409','reason','other org'),
    jsonb_build_array(jsonb_build_object('item_id','25900000-0000-0000-0000-000000001001','counted_quantity',9)), false)
$$, '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-SCW-001 count cannot name another organisation work order');

select throws_ok($$
  select create_stock_document(
    jsonb_build_object('kind','count','warehouse_id','25900000-0000-0000-0000-000000002002','work_order_id','25900000-0000-0000-0000-000000000404','reason','cancelled wo'),
    jsonb_build_array(jsonb_build_object('item_id','25900000-0000-0000-0000-000000001001','counted_quantity',9)), false)
$$, '23514', 'COST_WO_CANCELLED: the work order is cancelled', 'AC-SCW-001 count cannot name a cancelled work order');

-- AC-SCW-001: Keeper creates a draft count naming WO-1, then edits draft to WO-2, clears it, and sets back to WO-1.
select set_config('tst.cnt1', create_stock_document(
  jsonb_build_object('kind','count','warehouse_id','25900000-0000-0000-0000-000000002002','work_order_id','25900000-0000-0000-0000-000000000401','reason','Joint close-out count','occurred_on','2026-11-21'),
  jsonb_build_array(
    jsonb_build_object('item_id','25900000-0000-0000-0000-000000001001','counted_quantity',7),
    jsonb_build_object('item_id','25900000-0000-0000-0000-000000001002','counted_quantity',11)),
  false)::text, false);
select is((select work_order_id from stock_documents where id = current_setting('tst.cnt1')::uuid),
  '25900000-0000-0000-0000-000000000401'::uuid, 'AC-SCW-001 draft count stores work_order_id');

select save_stock_draft(current_setting('tst.cnt1')::uuid,
  jsonb_build_object('kind','count','warehouse_id','25900000-0000-0000-0000-000000002002','work_order_id',null,'reason','Cleared'),
  jsonb_build_array(
    jsonb_build_object('item_id','25900000-0000-0000-0000-000000001001','counted_quantity',7),
    jsonb_build_object('item_id','25900000-0000-0000-0000-000000001002','counted_quantity',11)));
select is((select work_order_id from stock_documents where id = current_setting('tst.cnt1')::uuid),
  null::uuid, 'AC-SCW-001 save_stock_draft can clear work_order_id');

select save_stock_draft(current_setting('tst.cnt1')::uuid,
  jsonb_build_object('kind','count','warehouse_id','25900000-0000-0000-0000-000000002002','work_order_id','25900000-0000-0000-0000-000000000401','reason','Joint close-out count'),
  jsonb_build_array(
    jsonb_build_object('item_id','25900000-0000-0000-0000-000000001001','counted_quantity',7),
    jsonb_build_object('item_id','25900000-0000-0000-0000-000000001002','counted_quantity',11)));
select is((select work_order_id from stock_documents where id = current_setting('tst.cnt1')::uuid),
  '25900000-0000-0000-0000-000000000401'::uuid, 'AC-SCW-001 save_stock_draft can set work_order_id');

-- AC-SCW-001: Moving warehouse away from project is refused while a count names a WO of that project.
reset role;
select throws_ok($$
  update stock_warehouses set project_id = '25900000-0000-0000-0000-0000000000c2'
   where id = '25900000-0000-0000-0000-000000002002'
$$, '23514', 'COST_WO_PROJECT_MOVE: transfers to this warehouse name a work order of its project', 'AC-SCW-001 warehouse with WO-attributed count cannot move to another project');

-- AC-SCW-002: SoD unchanged — keeper (author) cannot post count with variance; plain Engineer cannot post; Material Coordinator posts it.
select pg_temp.act_as('25900000-0000-0000-0000-0000000000a2');
select throws_ok($$
  select post_stock_document(current_setting('tst.cnt1')::uuid,
    (select revision from stock_documents where id = current_setting('tst.cnt1')::uuid))
$$, 'P0001', 'STK_SELF_APPROVE: a write-off must be posted by someone other than its author', 'AC-SCW-002 counter cannot post own count with variance');

select pg_temp.act_as('25900000-0000-0000-0000-0000000000a4');
select throws_ok($$
  select post_stock_document(current_setting('tst.cnt1')::uuid,
    (select revision from stock_documents where id = current_setting('tst.cnt1')::uuid))
$$, 'P0001', 'STK_RANK: only a Project Manager or above, or the Material Coordinator, posts a write-off', 'AC-SCW-002 plain Engineer cannot post count with variance');

select pg_temp.act_as('25900000-0000-0000-0000-0000000000a3');
select lives_ok($$
  select post_stock_document(current_setting('tst.cnt1')::uuid,
    (select revision from stock_documents where id = current_setting('tst.cnt1')::uuid))
$$, 'AC-SCW-002 Material Coordinator posts another person''s WO count');

-- AC-SCW-002: Material completion report shows BOLT counted_difference = -3, NUT counted_difference = 1, and nothing on WO-2.
select is(
  (select r->>'counted_difference' from jsonb_array_elements(get_work_order_material_completion('25900000-0000-0000-0000-000000000401')->'rows') r where r->>'item_code' = 'BOLT'),
  '-3', 'AC-SCW-002 material completion shows shortage counted_difference = -3');
select is(
  (select r->>'counted_difference' from jsonb_array_elements(get_work_order_material_completion('25900000-0000-0000-0000-000000000401')->'rows') r where r->>'item_code' = 'NUT'),
  '1', 'AC-SCW-002 material completion shows gain counted_difference = 1');
select is(
  jsonb_array_length(get_work_order_material_completion('25900000-0000-0000-0000-000000000402')->'rows'),
  0, 'AC-SCW-002 other work order shows no rows from WO-1 count');

-- Also post a count with NO work order at SITE1 (BOLT 7 -> 6, -1 loss = -100): must NOT affect WO-1 completion or WO-1 cost.
select pg_temp.act_as('25900000-0000-0000-0000-0000000000a2');
select set_config('tst.cnt_no_wo', create_stock_document(
  jsonb_build_object('kind','count','warehouse_id','25900000-0000-0000-0000-000000002002','reason','General yard check','occurred_on','2026-11-21'),
  jsonb_build_array(jsonb_build_object('item_id','25900000-0000-0000-0000-000000001001','counted_quantity',6)),
  false)::text, false);
select pg_temp.act_as('25900000-0000-0000-0000-0000000000a3');
select post_stock_document(current_setting('tst.cnt_no_wo')::uuid,
  (select revision from stock_documents where id = current_setting('tst.cnt_no_wo')::uuid));
select is(
  (select r->>'counted_difference' from jsonb_array_elements(get_work_order_material_completion('25900000-0000-0000-0000-000000000401')->'rows') r where r->>'item_code' = 'BOLT'),
  '-3', 'AC-SCW-002 count without work order does not change WO-1 material completion');

-- AC-SCW-003: Stock-issue costing OFF -> no count cost in work_order_cost_amounts or project_finance_actuals.
select pg_temp.act_as('25900000-0000-0000-0000-0000000000a1');
select is((select count(*) from stock_issue_cost_lines('25900000-0000-0000-0000-0000000000c1')), 0::bigint,
  'AC-SCW-003 with stock-issue costing off, count produces no cost line');
select is((get_project_finances('25900000-0000-0000-0000-0000000000c1')->'actuals'->>'total')::numeric, 0::numeric,
  'AC-SCW-003 with stock-issue costing off, project actuals are 0');

-- AC-SCW-003: Enable stock-issue costing on 2026-11-21 (same day as count).
-- BOLT shortage: -3 * 100 = -300 value_delta -> +300 cost.
-- NUT gain:      +1 * 50  = +50  value_delta -> -50 cost.
-- Net WO-1 count cost = +250. Unattributed count (-100) must NOT be included!
select is(set_stock_issue_cost_date('2026-11-21'), '2026-11-21'::date, 'AC-SCW-003 enable stock-issue costing');
select is((select sum(amount) from stock_issue_cost_lines('25900000-0000-0000-0000-0000000000c1')), 250::numeric,
  'AC-SCW-003 stock_issue_cost_lines includes WO count net variance (+300 - 50 = 250) and excludes unattributed count');
select is((select sum(amount::numeric) from work_order_cost_amounts('25900000-0000-0000-0000-0000000000c1')
           where source = 'stock_document' and work_order_id = '25900000-0000-0000-0000-000000000401' and reason = 'counted'),
  250::numeric, 'AC-SCW-003 work_order_cost_amounts shows +250 on WO-1');
select is((get_project_finances('25900000-0000-0000-0000-0000000000c1')->'actuals'->>'total')::numeric, 250::numeric,
  'AC-SCW-003 project_finance_actuals includes +250');
select is((select amount from project_pmo_spent_position('25900000-0000-0000-0000-0000000000c1')), 250::numeric,
  'AC-SCW-003 project_pmo_spent_position agrees (+250)');
select is((select spent from project_pmo_positions(array['25900000-0000-0000-0000-0000000000c1']::uuid[])), 250::numeric,
  'AC-SCW-003 project_pmo_positions agrees (+250)');

-- AC-SCW-003: Effective date gate — moving effective_on to 2026-11-22 excludes the 2026-11-21 count.
select is(set_stock_issue_cost_date('2026-11-22'), '2026-11-22'::date, 'AC-SCW-003 move effective_on after count date');
select is((select count(*) from stock_issue_cost_lines('25900000-0000-0000-0000-0000000000c1')), 0::bigint,
  'AC-SCW-003 count before effective_on is excluded');

-- AC-SCW-003: Cross-org isolation on stock_issue_cost_lines.
select pg_temp.act_as('25900000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from stock_issue_cost_lines('25900000-0000-0000-0000-0000000000c1')$$, 'P0002', 'project not found',
  'AC-SCW-003 another org cannot read stock_issue_cost_lines');

reset role;
select * from finish();
rollback;
