-- 1310_stock_wo_transfer.test.sql — #2691 (spec docs/specs/stock-work-order-transfer.spec.md). Migrations under test: 1310-1314.
-- AC-WOT-001 one move, two halves · 002/003 balances (also 1311_..) · 004 net cap · 005 allocation + engine cap · 007 refusals · 008 locations · 009 keeper/Admin ·
-- 010 two-step org · 011 atomic + replay · 013 pair check + client guards · 014 isolation · 015 zero cost · 019 setting off.
-- Mutation checks (break the marked line in the migration, expect the named AC red, restore): mut:wot_net_cap (004) · mut:wot_engine_cap (005: remove the cap
-- check in stock_apply_return, 0414 mut:cap_post) · mut:wot_same_project (007) · mut:wot_location_kind (008) · mut:wot_keeper (009) · mut:wot_atomic (011) ·
-- mut:wot_pair_check (013) · mut:wot_system_only (013).
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values ('26910000-0000-0000-0000-00000000000a', 'WOT Org', 'IDR', 'UTC'), ('26910000-0000-0000-0000-00000000000b', 'WOT Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values ('26910000-0000-0000-0000-0000000000a1', 'wot-admin@example.com'), ('26910000-0000-0000-0000-0000000000a2', 'wot-keeper@example.com'), ('26910000-0000-0000-0000-0000000000a3', 'wot-plain@example.com'), ('26910000-0000-0000-0000-0000000000b1', 'wot-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26910000-0000-0000-0000-0000000000a1', '26910000-0000-0000-0000-00000000000a', 'WOT Admin', 'wot-admin@example.com', 'Admin', 'active'),
  ('26910000-0000-0000-0000-0000000000a2', '26910000-0000-0000-0000-00000000000a', 'WOT Keeper', 'wot-keeper@example.com', 'Engineer', 'active'),
  ('26910000-0000-0000-0000-0000000000a3', '26910000-0000-0000-0000-00000000000a', 'WOT Plain', 'wot-plain@example.com', 'Engineer', 'active'),
  ('26910000-0000-0000-0000-0000000000b1', '26910000-0000-0000-0000-00000000000b', 'WOT Other Admin', 'wot-other@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values ('26910000-0000-0000-0000-0000000000f1', '26910000-0000-0000-0000-00000000000a', 'WOT Client', 'Client'), ('26910000-0000-0000-0000-0000000000f9', '26910000-0000-0000-0000-00000000000b', 'WOT Other Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('26910000-0000-0000-0000-0000000000c1', '26910000-0000-0000-0000-00000000000a', 'WOT Job One', 'Ongoing Project', 1000000, 'exclusive', 0, '26910000-0000-0000-0000-0000000000f1', '26910000-0000-0000-0000-0000000000a1'),
  ('26910000-0000-0000-0000-0000000000c2', '26910000-0000-0000-0000-00000000000a', 'WOT Job Two', 'Ongoing Project', 1000000, 'exclusive', 0, '26910000-0000-0000-0000-0000000000f1', '26910000-0000-0000-0000-0000000000a1'),
  ('26910000-0000-0000-0000-0000000000c9', '26910000-0000-0000-0000-00000000000b', 'WOT Other Job', 'Ongoing Project', 1000000, 'exclusive', 0, '26910000-0000-0000-0000-0000000000f9', '26910000-0000-0000-0000-0000000000b1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26910000-0000-0000-0000-0000000000e1', '26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-0000000000c1', 'W-1', 'Slab', 'm3', 50, 1000), ('26910000-0000-0000-0000-0000000000e3', '26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-0000000000c2', 'W-3', 'Wall', 'm3', 50, 1000);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-0000000000c1', 'WOT WO A', 'Issued', 10000, 'exclusive', 0), ('26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-0000000000c1', 'WOT WO B', 'Issued', 10000, 'exclusive', 0),
  ('26910000-0000-0000-0000-000000000403', '26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-0000000000c2', 'WOT WO other job', 'Issued', 10000, 'exclusive', 0), ('26910000-0000-0000-0000-000000000404', '26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-0000000000c1', 'WOT WO cancelled', 'Cancelled', 10000, 'exclusive', 0),
  ('26910000-0000-0000-0000-000000000405', '26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-0000000000c1', 'WOT WO C', 'Issued', 10000, 'exclusive', 0), ('26910000-0000-0000-0000-000000000409', '26910000-0000-0000-0000-00000000000b', '26910000-0000-0000-0000-0000000000c9', 'WOT other org WO', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values ('26910000-0000-0000-0000-0000000000d1', '26910000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_tags (id, org_id, name, zero_cost, paper_required) values ('26910000-0000-0000-0000-000000003001', '26910000-0000-0000-0000-00000000000a', 'Free issue', true, false);
insert into stock_items (id, org_id, code, name, unit_id, tag_id) values
  ('26910000-0000-0000-0000-000000001001', '26910000-0000-0000-0000-00000000000a', 'PIPE', 'Pipe', '26910000-0000-0000-0000-0000000000d1', null), ('26910000-0000-0000-0000-000000001002', '26910000-0000-0000-0000-00000000000a', 'FREE', 'Free valve', '26910000-0000-0000-0000-0000000000d1', '26910000-0000-0000-0000-000000003001');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-00000000000a', 'CEN', 'Central', 'central', null), ('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26910000-0000-0000-0000-0000000000c1'), ('26910000-0000-0000-0000-000000002003', '26910000-0000-0000-0000-00000000000a', 'YARD1', 'Yard one', 'yard', '26910000-0000-0000-0000-0000000000c1'),
  ('26910000-0000-0000-0000-000000002004', '26910000-0000-0000-0000-00000000000a', 'VEND', 'Vendor', 'vendor', null), ('26910000-0000-0000-0000-000000002005', '26910000-0000-0000-0000-00000000000a', 'SITE2', 'Site two', 'site', '26910000-0000-0000-0000-0000000000c2'), ('26910000-0000-0000-0000-000000002006', '26910000-0000-0000-0000-00000000000a', 'STG1', 'Staging one', 'staging', '26910000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values ('26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-0000000000a2'), ('26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-000000002003', '26910000-0000-0000-0000-0000000000a2'), ('26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-000000002006', '26910000-0000-0000-0000-0000000000a2'), ('26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-000000002005', '26910000-0000-0000-0000-0000000000a2');

create function public.wot_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.wot_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.wot_xfer(p_from uuid, p_to uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id',p_from,'to_warehouse_id',p_to),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty)), true) $$;
-- an issue to the project of work order p_wo, attributed to it
create function public.wot_issue(p_wh uuid, p_item uuid, p_qty numeric, p_wo uuid) returns uuid language plpgsql as $$
declare d uuid;
begin
  d := public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id',p_wh,'project_id','26910000-0000-0000-0000-0000000000c1'),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'boq_item_id','26910000-0000-0000-0000-0000000000e1')), true);
  perform public.set_cost_attribution('stock_document', array[d], p_wo, null);
  return d;
end $$;
create function public.wot_move(p_wh uuid, p_from uuid, p_to uuid, p_item uuid, p_qty numeric, p_extra jsonb default '{}', p_req uuid default null) returns uuid language sql as $$
  select public.post_stock_wo_transfer(jsonb_build_object('warehouse_id',p_wh,'from_work_order_id',p_from,'to_work_order_id',p_to),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty) || p_extra), p_req) $$;
create function public.wot_bal(p_wh uuid, p_item uuid) returns text language sql security definer as $$
  select coalesce((select qty_on_hand::text || '/' || value_on_hand::text from public.stock_balances where warehouse_id = p_wh and item_id = p_item), 'none') $$;
create function public.wot_mrq(p_wo uuid, p_item uuid) returns numeric language sql security definer as $$ select public.mrq_prior_quantity(p_wo, p_item, null) $$;
create function public.wot_count() returns int language sql security definer as $$ select count(*)::int from public.stock_wo_transfers $$;
create function public.wot_docs() returns int language sql security definer as $$ select count(*)::int from public.stock_documents where wo_transfer_id is not null $$;
create function public.wot_audit(p_action text) returns int language sql security definer as $$ select count(*)::int from public.audit_events where action = p_action $$;
create function public.wot_line_qtys(p_wot uuid, p_kind text) returns text language sql security definer as $$
  select string_agg(l.quantity::text, ',' order by l.line_no) from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id
   where d.wo_transfer_id = p_wot and d.kind = p_kind $$;
create function public.wot_first_issue_line(p_wo uuid) returns uuid language sql security definer as $$
  select l.id from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id
   where d.kind = 'issue' and d.work_order_id = p_wo and d.wo_transfer_id is null order by d.posted_at, l.line_no limit 1 $$;
-- sum of one numeric field of the work order's balance rows for an item (admin sees value)
create function public.wot_wb(p_wo uuid, p_item uuid, p_field text) returns numeric language sql as $$
  select coalesce(sum((r->>p_field)::numeric), 0) from jsonb_array_elements(public.get_work_order_stock_balance(p_wo, null)) r where (r->>'item_id')::uuid = p_item $$;
create function public.wot_ret(p_wo uuid, p_item uuid) returns numeric language sql as $$
  select coalesce(sum((r->>'quantity')::numeric), 0) from jsonb_array_elements(public.get_work_order_returnable(p_wo)) r where (r->>'item_id')::uuid = p_item $$;
create function public.wot_ledger_value(p_item uuid) returns numeric language sql security definer as $$
  select coalesce(sum(g.value_delta), 0) from public.stock_ledger g where g.item_id = p_item $$;
create function public.wot_free_value() returns numeric language sql security definer as $$
  select coalesce(sum(abs(g.value_delta)), 0) from public.stock_ledger g join public.stock_documents d on d.id = g.document_id where d.wo_transfer_id is not null and g.item_id = '26910000-0000-0000-0000-000000001002' $$;
create function public.wot_check_all() returns void language plpgsql as $$
declare w record;
begin for w in select id from public.stock_wo_transfers loop perform public.check_stock_wo_transfer_pair(w.id); end loop; end $$;
create function public.wot_bad_pair() returns void language plpgsql as $$
begin
  insert into public.stock_wo_transfers (org_id, number, project_id, warehouse_id, from_work_order_id, to_work_order_id, occurred_on, created_by)
  values ('26910000-0000-0000-0000-00000000000a', 'WOT-BAD', '26910000-0000-0000-0000-0000000000c1', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', current_date, '26910000-0000-0000-0000-0000000000a1');
  set constraints all immediate;
end $$;

-- ── setup (Admin), AC-WOT-019 the setting starts off ─────────────────────────────────────────────
select wot_as('26910000-0000-0000-0000-0000000000a1');
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_WOT_OFF: work-order transfers are not turned on for your organisation', 'AC-WOT-019 the move is refused while the setting is off');
select set_stock_wo_transfers(true);
select ok((select stock_wo_transfers_on('26910000-0000-0000-0000-00000000000a')), 'AC-WOT-019 an Admin turned it on');
select wot_rcv('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-000000001001', 100, 4);
select wot_xfer('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001', 40);
select wot_issue('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001', 10, '26910000-0000-0000-0000-000000000401');
select wot_issue('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001', 5, '26910000-0000-0000-0000-000000000401');
select wot_issue('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001', 20, '26910000-0000-0000-0000-000000000405');
select is(wot_bal('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001'), '5.000/20.00', 'setup: the site holds 5 after 35 issued');
select is(wot_ret('26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001'), 15::numeric, 'setup: work order A holds a net 15');
select is(wot_wb('26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001', 'on_site_qty'), -15::numeric, 'setup: A on-site before the move is -15 (issued, never received by transfer)');

-- ── AC-WOT-001/002/003/005 the move ──────────────────────────────────────────────────────────
select wot_as('26910000-0000-0000-0000-0000000000a2');
create temp table t_ids (k text primary key, v uuid);
insert into t_ids values ('m1', wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 12));
select wot_as('26910000-0000-0000-0000-0000000000a1');
select is(wot_count(), 1, 'AC-WOT-001 one work-order transfer exists');
select is(wot_docs(), 2, 'AC-WOT-001 it owns exactly two stock documents');
select is((select string_agg(d.kind || ':' || d.status, ',' order by d.kind) from stock_documents d where d.wo_transfer_id = (select v from t_ids where k='m1')), 'issue:Posted,return:Posted', 'AC-WOT-001 a posted issue and a posted return');
select is((select count(*)::int from stock_documents d where d.wo_transfer_id = (select v from t_ids where k='m1') and ((d.kind='return' and d.work_order_id = '26910000-0000-0000-0000-000000000401') or (d.kind='issue' and d.work_order_id = '26910000-0000-0000-0000-000000000402'))), 2, 'AC-WOT-001 the return names A and the issue names B');
select is(wot_bal('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001'), '5.000/20.00', 'AC-WOT-001 the location quantity and value are unchanged by the move');
select is(wot_line_qtys((select v from t_ids where k='m1'), 'return'), '10.000,2.000', 'AC-WOT-005 the return cites A''s issue lines oldest first (10 then 2)');
select is(wot_ret('26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001'), 3::numeric, 'AC-WOT-001 A now holds a net 3');
select is(wot_ret('26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001'), 12::numeric, 'AC-WOT-001 B now holds a net 12');
select is(wot_wb('26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001', 'issued_qty'), 3::numeric, 'AC-WOT-002 A issued quantity fell by 12');
select is(wot_wb('26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 'issued_qty'), 12::numeric, 'AC-WOT-002 B issued quantity rose by 12');
select is(wot_wb('26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001', 'issued_value'), 12::numeric, 'AC-WOT-002 A issued cost is 15 x 4 less 12 x 4');
select is(wot_wb('26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 'issued_value'), 48::numeric, 'AC-WOT-002 B issued cost is 12 x 4');
select is(wot_wb('26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001', 'on_site_qty'), -15::numeric, 'AC-WOT-002 A on-site quantity is unchanged by the move');
select is(wot_wb('26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 'on_site_qty'), 0::numeric, 'AC-WOT-002 B on-site quantity is unchanged by the move');
select is(wot_mrq('26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001'), 12::numeric, 'AC-WOT-003 B was moved 12 (what a new request must not ask again)');
select is(wot_mrq('26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001'), -12::numeric, 'AC-WOT-003 A was moved 12 off');

-- ── AC-WOT-004 the net cap ─────────────────────────────────────────────────────────────────────
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 4) $$, 'P0001', 'STK_WOT_EXCEEDS: the work order holds 3 of this item, requested 4', 'AC-WOT-004 4 above the net 3 is refused');
select is(wot_count(), 1, 'AC-WOT-004 a refused move writes nothing');
select ok(wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 3) is not null, 'AC-WOT-004 the remaining 3 moves');
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_WOT_EXCEEDS: the work order holds 0 of this item, requested 1', 'AC-WOT-004 nothing is left to move after it was all moved');
-- ── AC-WOT-005 the engine's own cap still binds the cited issue lines ───────────────────────────────
select throws_like($$ select create_stock_document(jsonb_build_object('kind','return','warehouse_id','26910000-0000-0000-0000-000000002002'),
  jsonb_build_array(jsonb_build_object('item_id','26910000-0000-0000-0000-000000001001','quantity',1,'source_line_id',wot_first_issue_line('26910000-0000-0000-0000-000000000401'))), true) $$, 'STK_RETURN_EXCEEDS%', 'AC-WOT-005 a plain return over a line the move emptied is refused by the engine');
-- the correction is a move the other way
select ok(wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001', 5) is not null, 'AC-WOT-001 the correction is a move back (B to A)');
select is(wot_ret('26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001'), 5::numeric, 'AC-WOT-001 A holds the 5 moved back');

-- ── AC-WOT-007 refusals ────────────────────────────────────────────────────────────────────────
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000403', '26910000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_WOT_PROJECT: both work orders must belong to the same project', 'AC-WOT-007 a work order of another project is refused');
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000404', '26910000-0000-0000-0000-000000001001', 1) $$, '23514', 'COST_WO_CANCELLED: the work order is cancelled', 'AC-WOT-007 a cancelled work order is refused (known limit)');
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000404', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001', 1) $$, '23514', 'COST_WO_CANCELLED: the work order is cancelled', 'AC-WOT-007 leftover on a cancelled work order cannot be moved off (known limit)');
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_INVALID: the two work orders must be different', 'AC-WOT-007 A and B must differ');
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000409', '26910000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_NOT_FOUND: a work order is not in your organisation', 'AC-WOT-007 another organisation''s work order is refused');
select throws_ok($$ select post_stock_wo_transfer(jsonb_build_object('warehouse_id','26910000-0000-0000-0000-000000002002','from_work_order_id','26910000-0000-0000-0000-000000000401','to_work_order_id','26910000-0000-0000-0000-000000000402'), jsonb_build_array(jsonb_build_object('item_id','26910000-0000-0000-0000-000000001001','quantity',1),jsonb_build_object('item_id','26910000-0000-0000-0000-000000001001','quantity',1))) $$, 'P0001', 'STK_INVALID: name each item once', 'AC-WOT-007 an item appears once');
-- ── AC-WOT-008 locations ──────────────────────────────────────────────────────────────────────
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_WOT_LOCATION: the stock must sit at a site, yard or staging location of the work orders'' project', 'AC-WOT-008 a central location is refused');
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002004', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_WOT_LOCATION: the stock must sit at a site, yard or staging location of the work orders'' project', 'AC-WOT-008 a vendor location is refused');
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002005', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_WOT_LOCATION: the stock must sit at a site, yard or staging location of the work orders'' project', 'AC-WOT-008 a location of another project is refused');
select ok(wot_move('26910000-0000-0000-0000-000000002003', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1) is not null, 'AC-WOT-008 a yard location of the project posts');
select ok(wot_move('26910000-0000-0000-0000-000000002006', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1) is not null, 'AC-WOT-008 a staging location of the project posts');
-- ── AC-WOT-009 who may ───────────────────────────────────────────────────────────────────────
select wot_as('26910000-0000-0000-0000-0000000000a3');
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_NOT_KEEPER: you do not keep this warehouse', 'AC-WOT-009 a member who is not the keeper is refused');
select wot_as('26910000-0000-0000-0000-0000000000a1');
select ok(wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1) is not null, 'AC-WOT-009 an Admin may move');
select ok(wot_audit('stock.admin_post') >= 2, 'AC-WOT-009 the Admin override is audited on both halves');
select ok(wot_audit('stock.wo_transfer') >= 1, 'AC-WOT-009 the move is audited');
select wot_as('26910000-0000-0000-0000-0000000000a2');
select throws_ok($$ select set_stock_wo_transfers(false) $$, '42501', 'STK_FORBIDDEN: only an Admin changes work-order transfers', 'AC-WOT-019 only an Admin changes the setting');
-- ── AC-WOT-011 atomic and idempotent ─────────────────────────────────────────────────────────────
select wot_as('26910000-0000-0000-0000-0000000000a2');
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1, jsonb_build_object('boq_item_id', '26910000-0000-0000-0000-0000000000e3')) $$, 'P0001', 'STK_BOQ_MISMATCH: every line needs a work item of this project', 'AC-WOT-011 a failure in the issue half refuses the move');
create temp table t_before as select wot_count() as n, wot_docs() as d;
select throws_ok($$ select wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1, jsonb_build_object('boq_item_id', '26910000-0000-0000-0000-0000000000e3')) $$, 'P0001', 'STK_BOQ_MISMATCH: every line needs a work item of this project', 'AC-WOT-011 refused again');
select is(wot_count(), (select n from t_before), 'AC-WOT-011 no move was left behind by the failed issue half');
select is(wot_docs(), (select d from t_before), 'AC-WOT-011 the return half was not left behind by the failed issue half');
insert into t_ids values ('r1', wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1, '{}', '26910000-0000-0000-0000-000000009001'));
select is(wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001001', 1, '{}', '26910000-0000-0000-0000-000000009001'), (select v from t_ids where k = 'r1'), 'AC-WOT-011 a replay with the same request id returns the first move');
select is(wot_count(), (select n + 1 from t_before), 'AC-WOT-011 the replay posted nothing more');
-- ── AC-WOT-010 two-step organisation ────────────────────────────────────────────────────────────
select wot_as('26910000-0000-0000-0000-0000000000a1');
select set_stock_transfer_mode('two_step');
select wot_as('26910000-0000-0000-0000-0000000000a2');
select ok(wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000001001', 1) is not null, 'AC-WOT-010 the move posts in a two-step organisation');
select is((select count(*)::int from stock_transfers), 0, 'AC-WOT-010 it created no transfer');
select is((select count(*)::int from stock_warehouses where kind = 'transit'), 0, 'AC-WOT-010 it created no transit location');
select throws_ok($$ select wot_xfer('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000002003', '26910000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_TWO_STEP: your organisation sends transfers in two steps: send, then receive', 'AC-WOT-010 a one-step transfer is still refused in a two-step organisation');
select wot_as('26910000-0000-0000-0000-0000000000a1');
select set_stock_transfer_mode('one_step');
-- ── AC-WOT-015 zero-cost items carry value 0 ─────────────────────────────────────────────────────
select wot_rcv('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-000000001002', 10, 0);
select wot_xfer('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001002', 10);
select wot_issue('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001002', 6, '26910000-0000-0000-0000-000000000401');
select ok(wot_move('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', '26910000-0000-0000-0000-000000001002', 4) is not null, 'AC-WOT-015 a client-supplied item moves');
select is(wot_free_value(), 0::numeric, 'AC-WOT-015 both halves carry value 0');
-- ── AC-WOT-013 pair check and client guards ────────────────────────────────────────────────────
reset role;
select lives_ok($$ select wot_check_all() $$, 'AC-WOT-013 every move the RPC posted passes the commit-time check');
select throws_ok($$ select wot_bad_pair() $$, 'P0001', 'STK_WOT_INCOMPLETE: a work-order transfer needs its posted return and its posted issue, equal and at one location', 'AC-WOT-013 a move without its two halves is refused at commit');
select throws_ok($$ update stock_wo_transfers set note = 'x' $$, 'P0001', 'STK_IMMUTABLE: a work-order transfer cannot be changed or deleted; move the stock back instead', 'AC-WOT-013 a move cannot be edited');
select throws_ok($$ delete from stock_wo_transfers $$, 'P0001', 'STK_IMMUTABLE: a work-order transfer cannot be changed or deleted; move the stock back instead', 'AC-WOT-013 a move cannot be deleted');
select throws_ok($$ insert into stock_documents (org_id, number, kind, warehouse_id, project_id, occurred_on, created_by, wo_transfer_id)
  values ('26910000-0000-0000-0000-00000000000a', 'ISS-FORGED', 'issue', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-0000000000c1', current_date, '26910000-0000-0000-0000-0000000000a1', (select id from stock_wo_transfers limit 1)) $$, 'P0001', 'STK_WOT_SYSTEM: only a work-order transfer writes its own return and issue', 'AC-WOT-013 the link is set only by the RPC');
select throws_ok($$ update stock_documents set wo_transfer_id = null where wo_transfer_id is not null $$, 'P0001', 'STK_IMMUTABLE: a posted or cancelled document cannot be changed', 'AC-WOT-013 the link of a posted half never changes');
select wot_as('26910000-0000-0000-0000-0000000000a2');
select throws_ok($$ insert into stock_wo_transfers (org_id, number, project_id, warehouse_id, from_work_order_id, to_work_order_id, occurred_on, created_by) values ('26910000-0000-0000-0000-00000000000a', 'WOT-X', '26910000-0000-0000-0000-0000000000c1', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-000000000402', current_date, '26910000-0000-0000-0000-0000000000a2') $$, '42501', null, 'AC-WOT-013 a client cannot write a move directly');
-- ── AC-WOT-014 isolation ──────────────────────────────────────────────────────────────────────
select wot_as('26910000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from stock_wo_transfers), 0, 'AC-WOT-014 another organisation sees none of the moves');
select throws_ok($$ select get_work_order_returnable('26910000-0000-0000-0000-000000000401') $$, 'P0001', 'STK_NOT_FOUND: the work order is not in your organisation', 'AC-WOT-014 another organisation cannot read what a work order holds');
select throws_ok($$ select post_stock_wo_transfer(jsonb_build_object('warehouse_id','26910000-0000-0000-0000-000000002002','from_work_order_id','26910000-0000-0000-0000-000000000401','to_work_order_id','26910000-0000-0000-0000-000000000402'), jsonb_build_array(jsonb_build_object('item_id','26910000-0000-0000-0000-000000001001','quantity',1))) $$, 'P0001', 'STK_WOT_OFF: work-order transfers are not turned on for your organisation', 'AC-WOT-014 the setting is per organisation');
select * from finish();
rollback;
