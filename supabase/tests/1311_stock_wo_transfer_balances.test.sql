-- 1311_stock_wo_transfer_balances.test.sql — #2691. Migration under test: 1313 (balances) with 1310-1312.
-- AC-WOT-002 reconciliation holds with a move · 003 mrq_prior_quantity · 006 cost follows the engine (moving average) and ledger value is conserved ·
-- 012 an organisation with no move reads as before.
-- Mutation checks: mut:wot_balance_in / mut:wot_balance_moved (drop the received or moved-out term in 1313: the reconciliation and on-site assertions go red) · mut:wot_mrq (drop the 1313 mrq term).
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values ('26911000-0000-0000-0000-00000000000a', 'WOB Org', 'IDR', 'UTC'), ('26911000-0000-0000-0000-00000000000b', 'WOB Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values ('26911000-0000-0000-0000-0000000000a1', 'wob-admin@example.com'), ('26911000-0000-0000-0000-0000000000a2', 'wob-keeper@example.com'), ('26911000-0000-0000-0000-0000000000b1', 'wob-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26911000-0000-0000-0000-0000000000a1', '26911000-0000-0000-0000-00000000000a', 'WOB Admin', 'wob-admin@example.com', 'Admin', 'active'),
  ('26911000-0000-0000-0000-0000000000a2', '26911000-0000-0000-0000-00000000000a', 'WOB Keeper', 'wob-keeper@example.com', 'Engineer', 'active'),
  ('26911000-0000-0000-0000-0000000000b1', '26911000-0000-0000-0000-00000000000b', 'WOB Other Admin', 'wob-other@example.com', 'Admin', 'active');
create function public.wob_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into companies (id, org_id, name, type) values ('26911000-0000-0000-0000-0000000000f1', '26911000-0000-0000-0000-00000000000a', 'WOB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('26911000-0000-0000-0000-0000000000c1', '26911000-0000-0000-0000-00000000000a', 'WOB Job', 'Ongoing Project', 1000000, 'exclusive', 0, '26911000-0000-0000-0000-0000000000f1', '26911000-0000-0000-0000-0000000000a1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values ('26911000-0000-0000-0000-0000000000e1', '26911000-0000-0000-0000-00000000000a', '26911000-0000-0000-0000-0000000000c1', 'W-1', 'Slab', 'm3', 50, 1000);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26911000-0000-0000-0000-000000000401', '26911000-0000-0000-0000-00000000000a', '26911000-0000-0000-0000-0000000000c1', 'WOB A', 'Issued', 10000, 'exclusive', 0), ('26911000-0000-0000-0000-000000000402', '26911000-0000-0000-0000-00000000000a', '26911000-0000-0000-0000-0000000000c1', 'WOB B', 'Issued', 10000, 'exclusive', 0), ('26911000-0000-0000-0000-000000000403', '26911000-0000-0000-0000-00000000000a', '26911000-0000-0000-0000-0000000000c1', 'WOB untouched', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values ('26911000-0000-0000-0000-0000000000d1', '26911000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_items (id, org_id, code, name, unit_id) values ('26911000-0000-0000-0000-000000001001', '26911000-0000-0000-0000-00000000000a', 'PIPE', 'Pipe', '26911000-0000-0000-0000-0000000000d1');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values ('26911000-0000-0000-0000-000000002002', '26911000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26911000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values ('26911000-0000-0000-0000-00000000000a', '26911000-0000-0000-0000-000000002002', '26911000-0000-0000-0000-0000000000a2');
create function public.wob_rcv(p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','26911000-0000-0000-0000-000000002002'),
    jsonb_build_array(jsonb_build_object('item_id','26911000-0000-0000-0000-000000001001','quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.wob_issue(p_qty numeric, p_wo uuid) returns void language plpgsql as $$
declare d uuid;
begin
  d := public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id','26911000-0000-0000-0000-000000002002','project_id','26911000-0000-0000-0000-0000000000c1'),
    jsonb_build_array(jsonb_build_object('item_id','26911000-0000-0000-0000-000000001001','quantity',p_qty,'boq_item_id','26911000-0000-0000-0000-0000000000e1')), true);
  perform public.set_cost_attribution('stock_document', array[d], p_wo, null);
end $$;
create function public.wot_mrq(p_wo uuid, p_item uuid) returns numeric language sql security definer as $$ select public.mrq_prior_quantity(p_wo, p_item, null) $$;
create function public.wob_bal() returns text language sql security definer as $$
  select coalesce((select qty_on_hand::text || '/' || value_on_hand::text from public.stock_balances where warehouse_id = '26911000-0000-0000-0000-000000002002' and item_id = '26911000-0000-0000-0000-000000001001'), 'none') $$;
create function public.wob_total_value() returns numeric language sql security definer as $$
  select coalesce(sum(value_delta), 0) from public.stock_ledger where item_id = '26911000-0000-0000-0000-000000001001' $$;
create function public.wob_wb(p_wo uuid, p_field text) returns numeric language sql as $$
  select coalesce(sum((r->>p_field)::numeric), 0) from jsonb_array_elements(public.get_work_order_stock_balance(p_wo, null)) r $$;
create function public.wob_project_on_site(p_field text) returns numeric language sql as $$
  select coalesce(sum((r->>p_field)::numeric), 0) from jsonb_array_elements(public.get_work_order_stock_balance(null, '26911000-0000-0000-0000-0000000000c1')) r $$;

select wob_as('26911000-0000-0000-0000-0000000000a1');
select set_stock_wo_transfers(true);
select wob_rcv(20, 4);
select wob_issue(10, '26911000-0000-0000-0000-000000000401');
select wob_rcv(10, 10);
select is(wob_bal(), '20.000/140.00', 'setup: 20 on site at an average of 7 after a dearer receipt');
select is(wob_project_on_site('on_site_qty'), 20::numeric, 'AC-WOT-002 before the move the work orders plus unassigned equal the location');
select is(wot_mrq('26911000-0000-0000-0000-000000000403', '26911000-0000-0000-0000-000000001001'), 0::numeric, 'AC-WOT-012 a work order with no move reads 0 as before');
select post_stock_wo_transfer(jsonb_build_object('warehouse_id','26911000-0000-0000-0000-000000002002','from_work_order_id','26911000-0000-0000-0000-000000000401','to_work_order_id','26911000-0000-0000-0000-000000000402'),
  jsonb_build_array(jsonb_build_object('item_id','26911000-0000-0000-0000-000000001001','quantity',10)));
select is(wob_project_on_site('on_site_qty'), 20::numeric, 'AC-WOT-002 after the move the work orders plus unassigned still equal the location quantity');
select is(wob_project_on_site('on_site_value'), 120::numeric, 'AC-WOT-002 and the location value');
select is(wob_wb('26911000-0000-0000-0000-000000000401', 'issued_value'), 0::numeric, 'AC-WOT-006 A is relieved of exactly what its issue cost (10 x 4)');
select is(wob_wb('26911000-0000-0000-0000-000000000402', 'issued_value'), 60::numeric, 'AC-WOT-006 B is charged the location average at that moment (10 x 6)');
select is(wob_bal(), '20.000/120.00', 'AC-WOT-006 the difference stays in the location value (140 + 40 - 60)');
select is(wob_total_value(), 120::numeric, 'AC-WOT-006 ledger value is conserved: the sum of every movement equals the stock held');
select is(wob_wb('26911000-0000-0000-0000-000000000401', 'on_site_qty') + wob_wb('26911000-0000-0000-0000-000000000402', 'on_site_qty'), -10::numeric, 'AC-WOT-002 on-site quantity per work order is unchanged by the move (A -10, B 0)');
select is(wob_wb('26911000-0000-0000-0000-000000000402', 'on_site_value'), -20::numeric, 'AC-WOT-006 B received the value A gave up (40) and consumed 60 at the average: the drift reads -20 on B');
select is(wob_wb('26911000-0000-0000-0000-000000000401', 'on_site_value'), -40::numeric, 'AC-WOT-006 A on-site value is unchanged by the move');
select is(wot_mrq('26911000-0000-0000-0000-000000000402', '26911000-0000-0000-0000-000000001001'), 10::numeric, 'AC-WOT-003 B was moved 10');
select is(wot_mrq('26911000-0000-0000-0000-000000000401', '26911000-0000-0000-0000-000000001001'), -10::numeric, 'AC-WOT-003 A was moved 10 off');
select * from finish();
rollback;
