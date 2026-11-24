-- 2101_work_order_material_completion.test.sql — 1124d decision 2 (spec docs/specs/work-order-material-completion.spec.md). Migration under test: 2101.
-- AC-WMC-001 per-material figures · 002 totals per unit · 003 cost hidden without cost access · 004 another org refused · 005 read-only.
-- Mutation checks: mut:org (004).
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values
  ('26950000-0000-0000-0000-00000000000a', 'TST Org', 'IDR', 'UTC'),
  ('26950000-0000-0000-0000-00000000000b', 'TST Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26950000-0000-0000-0000-0000000000a1', 'tst-admin@example.com'),
  ('26950000-0000-0000-0000-0000000000a2', 'tst-src@example.com'),
  ('26950000-0000-0000-0000-0000000000a3', 'tst-dst@example.com'),
  ('26950000-0000-0000-0000-0000000000a4', 'tst-plain@example.com'),
  ('26950000-0000-0000-0000-0000000000b1', 'tst-other-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26950000-0000-0000-0000-0000000000a1', '26950000-0000-0000-0000-00000000000a', 'TST Admin', 'tst-admin@example.com', 'Admin', 'active'),
  ('26950000-0000-0000-0000-0000000000a2', '26950000-0000-0000-0000-00000000000a', 'TST Source Keeper', 'tst-src@example.com', 'Engineer', 'active'),
  ('26950000-0000-0000-0000-0000000000a3', '26950000-0000-0000-0000-00000000000a', 'TST Dest Keeper', 'tst-dst@example.com', 'Engineer', 'active'),
  ('26950000-0000-0000-0000-0000000000a4', '26950000-0000-0000-0000-00000000000a', 'TST Plain Member', 'tst-plain@example.com', 'Engineer', 'active'),
  ('26950000-0000-0000-0000-0000000000b1', '26950000-0000-0000-0000-00000000000b', 'TST Other Admin', 'tst-other-admin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('26950000-0000-0000-0000-0000000000f1', '26950000-0000-0000-0000-00000000000a', 'TST Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('26950000-0000-0000-0000-0000000000c1', '26950000-0000-0000-0000-00000000000a', 'TST Job One', 'Ongoing Project', 1000000, 'exclusive', 0, '26950000-0000-0000-0000-0000000000f1', '26950000-0000-0000-0000-0000000000a1'),
  ('26950000-0000-0000-0000-0000000000c2', '26950000-0000-0000-0000-00000000000a', 'TST Job Two', 'Ongoing Project', 1000000, 'exclusive', 0, '26950000-0000-0000-0000-0000000000f1', '26950000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26950000-0000-0000-0000-000000000401', '26950000-0000-0000-0000-00000000000a', '26950000-0000-0000-0000-0000000000c1', 'TST WO one', 'Issued', 10000, 'exclusive', 0),
  ('26950000-0000-0000-0000-000000000403', '26950000-0000-0000-0000-00000000000a', '26950000-0000-0000-0000-0000000000c2', 'TST WO other job', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26950000-0000-0000-0000-0000000000d1', '26950000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_tags (id, org_id, name, zero_cost, paper_required) values
  ('26950000-0000-0000-0000-000000003001', '26950000-0000-0000-0000-00000000000a', 'Client supplied', true, false),
  ('26950000-0000-0000-0000-000000003002', '26950000-0000-0000-0000-00000000000a', 'Plain tag', false, false);
insert into stock_items (id, org_id, code, name, unit_id, tag_id, needs_quality_check) values
  ('26950000-0000-0000-0000-000000001001', '26950000-0000-0000-0000-00000000000a', 'PIPE', 'Pipe', '26950000-0000-0000-0000-0000000000d1', null, false),
  ('26950000-0000-0000-0000-000000001002', '26950000-0000-0000-0000-00000000000a', 'FREE', 'Free issue valve', '26950000-0000-0000-0000-0000000000d1', '26950000-0000-0000-0000-000000003001', false),
  ('26950000-0000-0000-0000-000000001003', '26950000-0000-0000-0000-00000000000a', 'QC', 'Checked valve', '26950000-0000-0000-0000-0000000000d1', null, true),
  ('26950000-0000-0000-0000-000000001004', '26950000-0000-0000-0000-00000000000a', 'CONF', 'Confirmed item', '26950000-0000-0000-0000-0000000000d1', '26950000-0000-0000-0000-000000003002', false);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26950000-0000-0000-0000-000000002001', '26950000-0000-0000-0000-00000000000a', 'CEN',   'Central', 'central', null),
  ('26950000-0000-0000-0000-000000002002', '26950000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26950000-0000-0000-0000-0000000000c1'),
  ('26950000-0000-0000-0000-000000002003', '26950000-0000-0000-0000-00000000000a', 'YARD1', 'Yard one', 'yard', '26950000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('26950000-0000-0000-0000-00000000000a', '26950000-0000-0000-0000-000000002001', '26950000-0000-0000-0000-0000000000a2'),
  ('26950000-0000-0000-0000-00000000000a', '26950000-0000-0000-0000-000000002002', '26950000-0000-0000-0000-0000000000a3');

create function public.tst_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- one-step receive / transfer through the shipped RPC
create function public.tst_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.tst_xfer(p_from uuid, p_to uuid, p_item uuid, p_qty numeric, p_post boolean default true) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id',p_from,'to_warehouse_id',p_to),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty)), p_post) $$;
-- two-step send of one item
create function public.tst_send(p_from uuid, p_to uuid, p_item uuid, p_qty numeric, p_extra jsonb default '{}') returns uuid language sql as $$
  select public.send_stock_transfer(jsonb_build_object('warehouse_id',p_from,'to_warehouse_id',p_to) || p_extra,
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty))) $$;
-- receive one-line transfer: counted / accepted (rejected derived) / optional reason, quality, confirmation
create function public.tst_recv(p_transfer uuid, p_counted numeric, p_accepted numeric, p_extra jsonb default '{}', p_conf jsonb default null) returns void language sql as $$
  select public.receive_stock_transfer(p_transfer,
    (select jsonb_agg(jsonb_build_object('line_id', l.id, 'counted', p_counted, 'accepted', p_accepted) || p_extra) from public.stock_transfer_lines l where l.transfer_id = p_transfer), p_conf) $$;
create function public.tst_bal(p_wh uuid, p_item uuid) returns text language sql security definer as $$
  select coalesce((select qty_on_hand::text || '/' || value_on_hand::text from public.stock_balances where warehouse_id = p_wh and item_id = p_item), 'none') $$;
create function public.tst_transit(p_transfer uuid, p_item uuid) returns text language sql security definer as $$
  select public.tst_bal(t.transit_warehouse_id, p_item) from public.stock_transfers t where t.id = p_transfer $$;
create function public.tst_line(p_transfer uuid) returns uuid language sql security definer as $$
  select l.id from public.stock_transfer_lines l where l.transfer_id = p_transfer order by l.line_no limit 1 $$;
-- total quantity and value of an item over EVERY location (conservation)
create function public.tst_total(p_item uuid) returns text language sql security definer as $$
  select coalesce(sum(qty_on_hand), 0)::text || '/' || coalesce(sum(value_on_hand), 0)::text from public.stock_balances where item_id = p_item $$;

insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values ('26950000-0000-0000-0000-00000000000a', '26950000-0000-0000-0000-000000002002', '26950000-0000-0000-0000-0000000000a2');
create function public.tst_tr(p_n text) returns uuid language sql as $$ select current_setting('tst.' || p_n)::uuid $$;
update stock_tags set proof_required = 'paper' where id = '26950000-0000-0000-0000-000000003001';
select tst_as('26950000-0000-0000-0000-0000000000a1');
select tst_rcv('26950000-0000-0000-0000-000000002001', '26950000-0000-0000-0000-000000001002', 40, 0);
select tst_rcv('26950000-0000-0000-0000-000000002001', '26950000-0000-0000-0000-000000001001', 40, 4);
select tst_rcv('26950000-0000-0000-0000-000000002001', '26950000-0000-0000-0000-000000001004', 40, 3);
reset role;


-- an issue to the project for the work order, and a return of part of it
select tst_as('26950000-0000-0000-0000-0000000000a1');
select set_config('tst.i1', create_stock_document(jsonb_build_object('kind','issue','warehouse_id','26950000-0000-0000-0000-000000002001','project_id','26950000-0000-0000-0000-0000000000c1'),
  jsonb_build_array(jsonb_build_object('item_id','26950000-0000-0000-0000-000000001001','quantity',10)), true)::text, false);
reset role;
update stock_documents set work_order_id = '26950000-0000-0000-0000-000000000401' where id = current_setting('tst.i1')::uuid;
select tst_as('26950000-0000-0000-0000-0000000000a1');
select is((get_work_order_material_completion('26950000-0000-0000-0000-000000000401')->'rows'->0->>'item_code'), 'PIPE', 'AC-WMC-001 the issued material is listed');
select is((get_work_order_material_completion('26950000-0000-0000-0000-000000000401')->'rows'->0->>'issued'), '10', 'AC-WMC-001 the quantity issued to the work order');
select is((get_work_order_material_completion('26950000-0000-0000-0000-000000000401')->'rows'->0->>'returned'), '0', 'AC-WMC-001 nothing returned yet');
select is((get_work_order_material_completion('26950000-0000-0000-0000-000000000401')->'totals'->0->>'issued'), '10', 'AC-WMC-002 the total per unit adds the rows');
select is((get_work_order_material_completion('26950000-0000-0000-0000-000000000401')->'value_totals'->>'issued'), '40.0000', 'AC-WMC-003 a role with cost access sees the issued value');
select is(jsonb_array_length(get_work_order_material_completion('26950000-0000-0000-0000-000000000403')->'rows'), 0, 'AC-WMC-001 another work order shows none of these figures');
reset role;
select tst_as('26950000-0000-0000-0000-0000000000a4');
select ok(not (get_work_order_material_completion('26950000-0000-0000-0000-000000000401')->'rows'->0 ? 'issued_value') and get_work_order_material_completion('26950000-0000-0000-0000-000000000401')->'value_totals' = 'null'::jsonb, 'AC-WMC-003 a role without cost access gets no cost figures');
reset role;
select tst_as('26950000-0000-0000-0000-0000000000b1');
select throws_ok($$ select get_work_order_material_completion('26950000-0000-0000-0000-000000000401') $$, 'P0001', 'STK_NOT_FOUND: the work order is not in your organisation', 'AC-WMC-004 another organisation cannot read it');
reset role;
select * from finish();
rollback;
