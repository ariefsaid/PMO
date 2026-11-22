-- 1306_stock_two_step_transfer.test.sql — #2690 (spec docs/specs/stock-two-step-transfer.spec.md). Migrations under test: 1305-1309.
-- AC-TST-003 one-step blocked / draft in place · 004 send · 005 transit location · 006 full receive · 007 short · 008 reject · 009 over-count ·
-- 010 quality · 011 shortfall resolution · 012 recall · 013 self-receive · 014 conservation + reconciliation · 018 proof at receive · 021 reorder · 030 one-step may_follow ·
-- 031 two-step may_follow · 032 mrq_prior_quantity.
-- Mutation checks (break the marked line in the migration, expect red, restore): mut:transit_carry (004, 014) · mut:one_step_block (003) · mut:count_cap (009) ·
-- mut:accept_sum (008) · mut:quality_fail (010) · mut:self_receive (013) · mut:proof_check (018) · mut:writeoff_admin (011) · mut:transit_system_only (005) ·
-- mut:timing_block (030) · mut:late_actor (031) · mut:guest_self_receive (013: the guest-signer case) · mut:sender_not_receiver (013) · mut:receiver_actor (013: remove the receiver check and the 'no part in the transfer' case goes red).
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values
  ('26920000-0000-0000-0000-00000000000a', 'TST Org', 'IDR', 'UTC'),
  ('26920000-0000-0000-0000-00000000000b', 'TST Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26920000-0000-0000-0000-0000000000a1', 'tst-admin@example.com'),
  ('26920000-0000-0000-0000-0000000000a2', 'tst-src@example.com'),
  ('26920000-0000-0000-0000-0000000000a3', 'tst-dst@example.com'),
  ('26920000-0000-0000-0000-0000000000a4', 'tst-plain@example.com'),
  ('26920000-0000-0000-0000-0000000000b1', 'tst-other-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26920000-0000-0000-0000-0000000000a1', '26920000-0000-0000-0000-00000000000a', 'TST Admin', 'tst-admin@example.com', 'Admin', 'active'),
  ('26920000-0000-0000-0000-0000000000a2', '26920000-0000-0000-0000-00000000000a', 'TST Source Keeper', 'tst-src@example.com', 'Engineer', 'active'),
  ('26920000-0000-0000-0000-0000000000a3', '26920000-0000-0000-0000-00000000000a', 'TST Dest Keeper', 'tst-dst@example.com', 'Engineer', 'active'),
  ('26920000-0000-0000-0000-0000000000a4', '26920000-0000-0000-0000-00000000000a', 'TST Plain Member', 'tst-plain@example.com', 'Engineer', 'active'),
  ('26920000-0000-0000-0000-0000000000b1', '26920000-0000-0000-0000-00000000000b', 'TST Other Admin', 'tst-other-admin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('26920000-0000-0000-0000-0000000000f1', '26920000-0000-0000-0000-00000000000a', 'TST Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('26920000-0000-0000-0000-0000000000c1', '26920000-0000-0000-0000-00000000000a', 'TST Job One', 'Ongoing Project', 1000000, 'exclusive', 0, '26920000-0000-0000-0000-0000000000f1', '26920000-0000-0000-0000-0000000000a1'),
  ('26920000-0000-0000-0000-0000000000c2', '26920000-0000-0000-0000-00000000000a', 'TST Job Two', 'Ongoing Project', 1000000, 'exclusive', 0, '26920000-0000-0000-0000-0000000000f1', '26920000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26920000-0000-0000-0000-000000000401', '26920000-0000-0000-0000-00000000000a', '26920000-0000-0000-0000-0000000000c1', 'TST WO one', 'Issued', 10000, 'exclusive', 0),
  ('26920000-0000-0000-0000-000000000403', '26920000-0000-0000-0000-00000000000a', '26920000-0000-0000-0000-0000000000c2', 'TST WO other job', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26920000-0000-0000-0000-0000000000d1', '26920000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_tags (id, org_id, name, zero_cost, paper_required) values
  ('26920000-0000-0000-0000-000000003001', '26920000-0000-0000-0000-00000000000a', 'Client supplied', true, false),
  ('26920000-0000-0000-0000-000000003002', '26920000-0000-0000-0000-00000000000a', 'Plain tag', false, false);
insert into stock_items (id, org_id, code, name, unit_id, tag_id, needs_quality_check) values
  ('26920000-0000-0000-0000-000000001001', '26920000-0000-0000-0000-00000000000a', 'PIPE', 'Pipe', '26920000-0000-0000-0000-0000000000d1', null, false),
  ('26920000-0000-0000-0000-000000001002', '26920000-0000-0000-0000-00000000000a', 'FREE', 'Free issue valve', '26920000-0000-0000-0000-0000000000d1', '26920000-0000-0000-0000-000000003001', false),
  ('26920000-0000-0000-0000-000000001003', '26920000-0000-0000-0000-00000000000a', 'QC', 'Checked valve', '26920000-0000-0000-0000-0000000000d1', null, true),
  ('26920000-0000-0000-0000-000000001004', '26920000-0000-0000-0000-00000000000a', 'CONF', 'Confirmed item', '26920000-0000-0000-0000-0000000000d1', '26920000-0000-0000-0000-000000003002', false);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-00000000000a', 'CEN',   'Central', 'central', null),
  ('26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26920000-0000-0000-0000-0000000000c1'),
  ('26920000-0000-0000-0000-000000002003', '26920000-0000-0000-0000-00000000000a', 'YARD1', 'Yard one', 'yard', '26920000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('26920000-0000-0000-0000-00000000000a', '26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-0000000000a2'),
  ('26920000-0000-0000-0000-00000000000a', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-0000000000a3');

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

update organizations set stock_transfer_mode = 'two_step' where id = '26920000-0000-0000-0000-00000000000a';
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values ('26920000-0000-0000-0000-00000000000a', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-0000000000a2');          -- the source keeper also keeps SITE1 (self-receive case)
create function public.tst_tr(p_n text) returns uuid language sql as $$ select current_setting('tst.' || p_n)::uuid $$;
select tst_as('26920000-0000-0000-0000-0000000000a1');
select tst_rcv('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000001001', 100, 4);
select tst_rcv('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000001002', 50, 0);
select tst_rcv('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000001003', 100, 5);
reset role;

-- ── AC-TST-004 send: stock moves to a per-transfer transit location, value carried ─────────────────
select tst_as('26920000-0000-0000-0000-0000000000a2');
select set_config('tst.t1', tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 10)::text, false);
select is(tst_bal('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000001001'), '90.000/360.00', 'AC-TST-004 the source gives up 10 at 4.00');
select is(tst_transit(tst_tr('t1'), '26920000-0000-0000-0000-000000001001'), '10.000/40.00', 'AC-TST-004 the transit location holds 10 at the carried value 40.00');
select is(tst_total('26920000-0000-0000-0000-000000001001'), '100.000/400.00', 'AC-TST-014 total quantity and value over every location are unchanged by the send');
select is((select status from stock_transfers where id = tst_tr('t1')), 'Sent', 'AC-TST-004 the transfer reads Sent');
select throws_ok($$ select tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 500) $$, 'P0001', 'STK_INSUFFICIENT: item PIPE at CEN: available 90, requested 500', 'AC-TST-004 sending more than the source holds is refused');
reset role;
select tst_as('26920000-0000-0000-0000-0000000000a4');
select throws_ok($$ select tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_NOT_KEEPER: you do not keep this warehouse', 'AC-TST-004 a non-keeper cannot send');
reset role;

-- ── AC-TST-005 the transit location is the system's ─────────────────────────────────────────────
select tst_as('26920000-0000-0000-0000-0000000000a1');
select throws_ok($$ insert into stock_warehouses (code, name, kind) values ('FAKE', 'Fake transit', 'transit') $$,
  'P0001', 'STK_TRANSIT_LOCATION: a transit location is managed by the transfer, not by hand', 'AC-TST-005 a client cannot create a transit location');
select throws_ok($$ update stock_warehouses set kind = 'transit' where id = '26920000-0000-0000-0000-000000002003' $$,
  'P0001', 'STK_TRANSIT_LOCATION: a transit location is managed by the transfer, not by hand', 'AC-TST-005 a client cannot turn a location into transit');
select throws_ok($$ update stock_warehouses set name = 'Renamed' where id = (select transit_warehouse_id from stock_transfers where id = tst_tr('t1')) $$,
  'P0001', 'STK_TRANSIT_LOCATION: a transit location is managed by the transfer, not by hand', 'AC-TST-005 a client cannot change a transit location');
select throws_ok($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',(select transit_warehouse_id from stock_transfers where id = tst_tr('t1'))),
    jsonb_build_array(jsonb_build_object('item_id','26920000-0000-0000-0000-000000001001','quantity',1,'unit_cost',4)), true) $$,
  'P0001', 'STK_TRANSIT_LOCATION: a transit location takes only the legs of its own transfer', 'AC-TST-005 a receive naming a transit location is refused');
reset role;

-- ── AC-TST-013 the sender may not receive; the destination keeper may ──────────────────────────────
select tst_as('26920000-0000-0000-0000-0000000000a4');
select throws_ok($$ select tst_recv(tst_tr('t1'), 10, 10) $$, 'P0001', 'STK_NOT_RECEIVER: you do not keep the destination and the transfer is not addressed to you', 'AC-TST-013 someone with no part in the transfer cannot receive it');
reset role;
select tst_as('26920000-0000-0000-0000-0000000000a2');
select throws_ok($$ select tst_recv(tst_tr('t1'), 10, 10) $$, 'P0001', 'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it', 'AC-TST-013 the sender cannot receive (they also keep the destination here)');
reset role;

-- a guest signer does not change who is counting: the logged-in sender is refused whoever co-signs (mut:guest_self_receive)
select tst_as('26920000-0000-0000-0000-0000000000a2');
select throws_ok($$ select tst_recv(tst_tr('t1'), 10, 10, '{}', '{"signer_kind":"guest","signer_name":"Gate Guard","proof_type":"in_app"}'::jsonb) $$, 'P0001', 'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it', 'AC-TST-013 the sender cannot record the count with a guest signer either');
-- a transfer cannot name its own sender as the receiver (mut:sender_not_receiver)
select throws_ok($$ select tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 1, jsonb_build_object('to_user_id', '26920000-0000-0000-0000-0000000000a2')) $$, 'P0001', 'STK_SELF_RECEIVE: the person who sends a transfer cannot be named as its receiver', 'AC-TST-013 the sender cannot be named as the receiver');
reset role;

-- ── AC-TST-006 full receive closes the transfer ─────────────────────────────────────────────────
select tst_as('26920000-0000-0000-0000-0000000000a3');
select lives_ok($$ select tst_recv(tst_tr('t1'), 10, 10) $$, 'AC-TST-006 the destination keeper receives the full count');
select is(tst_bal('26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001'), '10.000/40.00', 'AC-TST-006 the destination holds 10 at the carried value');
select is(tst_transit(tst_tr('t1'), '26920000-0000-0000-0000-000000001001'), '0.000/0.00', 'AC-TST-006 nothing is left in transit');
select is((select status from stock_transfers where id = tst_tr('t1')), 'Closed', 'AC-TST-006 the transfer is Closed');
select isnt((select archived_at from stock_warehouses where id = (select transit_warehouse_id from stock_transfers where id = tst_tr('t1'))), null, 'AC-TST-006 the transit location is archived by the system');
select throws_ok($$ select tst_recv(tst_tr('t1'), 10, 10) $$, 'P0001', 'STK_INVALID: this transfer was already received or cancelled', 'AC-TST-006 a transfer is received once');
reset role;

-- ── AC-TST-007 short: the shortfall stays in transit, open ──────────────────────────────────────
select tst_as('26920000-0000-0000-0000-0000000000a2');
select set_config('tst.t2', tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 10)::text, false);
reset role;
select tst_as('26920000-0000-0000-0000-0000000000a3');
select lives_ok($$ select tst_recv(tst_tr('t2'), 7, 7) $$, 'AC-TST-007 receiving 7 of 10 is accepted');
select is(tst_bal('26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001'), '17.000/68.00', 'AC-TST-007 the destination gained 7');
select is(tst_transit(tst_tr('t2'), '26920000-0000-0000-0000-000000001001'), '3.000/12.00', 'AC-TST-007 the 3 short stay in transit at their value');
select is((select status from stock_transfers where id = tst_tr('t2')), 'Received', 'AC-TST-007 the transfer is Received, not Closed');
select is((select qty_sent - qty_counted from stock_transfer_lines where id = tst_line(tst_tr('t2'))), 3::numeric, 'AC-TST-007 the open shortfall is 3');
select is(tst_total('26920000-0000-0000-0000-000000001001'), '100.000/400.00', 'AC-TST-014 nothing was lost: total quantity and value are unchanged');
reset role;

-- ── AC-TST-008 / 009 reject, and the count rules ────────────────────────────────────────────────
select tst_as('26920000-0000-0000-0000-0000000000a2');
select set_config('tst.t3', tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 10)::text, false);
select set_config('tst.t4', tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 4)::text, false);
reset role;
select tst_as('26920000-0000-0000-0000-0000000000a3');
select throws_ok($$ select tst_recv(tst_tr('t3'), 10, 6) $$, '23514', null, 'AC-TST-008 a rejection without a reason is refused');
select lives_ok($$ select tst_recv(tst_tr('t3'), 10, 6, '{"reject_reason":"dented"}') $$, 'AC-TST-008 counted 10, accepted 6, rejected 4 with a reason');
select is(tst_bal('26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001'), '23.000/92.00', 'AC-TST-008 the destination gained only the accepted 6');
select is(tst_bal('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000001001'), '70.000/280.00', 'AC-TST-008 the rejected 4 went back to the source');
select is(tst_transit(tst_tr('t3'), '26920000-0000-0000-0000-000000001001'), '0.000/0.00', 'AC-TST-008 nothing left in transit');
select throws_ok($$ select tst_recv(tst_tr('t4'), 4, 4, '{"rejected":1}') $$, '23514', null, 'AC-TST-008 accepted + rejected must equal counted');
select throws_ok($$ select tst_recv(tst_tr('t4'), 11, 4) $$, '23514', null, 'AC-TST-009 counted above sent is refused');
select throws_ok($$ select tst_recv(tst_tr('t4'), -1, 0) $$, '23514', null, 'AC-TST-009 a negative count is refused');
select throws_ok($$ select tst_recv(tst_tr('t4'), 1.0005, 1) $$, 'P0001', 'STK_INVALID: a count needs counted and accepted quantities (3 decimals at most)', 'AC-TST-009 a count with more than 3 decimals is refused');
select throws_ok($$ select public.receive_stock_transfer(tst_tr('t4'), '[]'::jsonb) $$, 'P0001', 'STK_INVALID: give a count for every line of the transfer', 'AC-TST-009 every line needs a count');
reset role;
-- The table checks are the authority for these rules (the RPC adds friendlier messages, not the rule): bind each to its own constraint by writing as the table owner.
select throws_ok($$ update stock_transfer_lines set qty_counted = 11, qty_accepted = 11, qty_rejected = 0 where id = tst_line(tst_tr('t4')) $$, '23514', null, 'AC-TST-009 the table itself refuses a count above the sent quantity (stock_transfer_lines_count_cap)');
select throws_ok($$ update stock_transfer_lines set qty_counted = 4, qty_accepted = 4, qty_rejected = 1, reject_reason = 'x' where id = tst_line(tst_tr('t4')) $$, '23514', null, 'AC-TST-008 the table itself refuses accepted + rejected different from counted (stock_transfer_lines_accept_sum)');
select throws_ok($$ update stock_transfer_lines set qty_counted = 4, qty_accepted = 4, qty_rejected = 0, quality_result = 'fail' where id = tst_line(tst_tr('t4')) $$, '23514', null, 'AC-TST-010 the table itself refuses accepting stock that failed its quality check (stock_transfer_lines_quality_fail)');
select tst_as('26920000-0000-0000-0000-0000000000a3');
select lives_ok($$ select tst_recv(tst_tr('t4'), 4, 4, '{"quality_result":"fail"}') $$, 'AC-TST-010 a quality result on an unflagged item is ignored');
select is((select quality_result from stock_transfer_lines where id = tst_line(tst_tr('t4'))), null, 'AC-TST-010 and not stored');
reset role;

-- ── AC-TST-010 quality check on a flagged item ──────────────────────────────────────────────────
select tst_as('26920000-0000-0000-0000-0000000000a2');
select set_config('tst.q1', tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001003', 5)::text, false);
select set_config('tst.q2', tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001003', 5)::text, false);
reset role;
select tst_as('26920000-0000-0000-0000-0000000000a3');
select throws_ok($$ select tst_recv(tst_tr('q1'), 5, 5) $$, 'P0001', 'STK_QUALITY: this item needs a quality check: record pass or fail', 'AC-TST-010 a flagged item needs a result');
select throws_ok($$ select tst_recv(tst_tr('q1'), 5, 5, '{"quality_result":"fail"}') $$, '23514', null, 'AC-TST-010 a failed check cannot be accepted');
select lives_ok($$ select tst_recv(tst_tr('q1'), 5, 0, '{"quality_result":"fail","reject_reason":"failed pressure test"}') $$, 'AC-TST-010 a failed check is rejected in full');
select is(tst_bal('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000001003'), '95.000/475.00', 'AC-TST-010 the failed item went back to the source');
select lives_ok($$ select tst_recv(tst_tr('q2'), 5, 5, '{"quality_result":"pass"}') $$, 'AC-TST-010 a passed check is accepted');
select is(tst_bal('26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001003'), '5.000/25.00', 'AC-TST-010 the passed item arrived');
reset role;

-- ── AC-TST-011 shortfall resolution ─────────────────────────────────────────────────────────────
select tst_as('26920000-0000-0000-0000-0000000000a2');
select set_config('tst.s1', tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 6)::text, false);
select set_config('tst.s2', tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 6)::text, false);
reset role;
select tst_as('26920000-0000-0000-0000-0000000000a3');
select tst_recv(tst_tr('s1'), 4, 4);
select tst_recv(tst_tr('s2'), 4, 4);
select lives_ok($$ select resolve_stock_transfer_shortfall(tst_line(tst_tr('t2')), 'delivered') $$, 'AC-TST-011 the late 3 are delivered');
select is(tst_transit(tst_tr('t2'), '26920000-0000-0000-0000-000000001001'), '0.000/0.00', 'AC-TST-011 transit is empty after delivery');
select is((select status from stock_transfers where id = tst_tr('t2')), 'Closed', 'AC-TST-011 the transfer closes with its last shortfall');
select throws_ok($$ select resolve_stock_transfer_shortfall(tst_line(tst_tr('t2')), 'delivered') $$, 'P0001', 'STK_INVALID: there is no open shortfall on this line', 'AC-TST-011 a resolved shortfall cannot be resolved again');
select lives_ok($$ select resolve_stock_transfer_shortfall(tst_line(tst_tr('s1')), 'returned') $$, 'AC-TST-011 the missing 2 are returned to the source');
select throws_ok($$ select resolve_stock_transfer_shortfall(tst_line(tst_tr('s2')), 'written_off', 'lost on the road') $$, '42501', 'STK_FORBIDDEN: only an Admin writes a shortfall off', 'AC-TST-011 a keeper cannot write a shortfall off');
reset role;
select tst_as('26920000-0000-0000-0000-0000000000a1');
select throws_ok($$ select resolve_stock_transfer_shortfall(tst_line(tst_tr('s2')), 'written_off') $$, 'P0001', 'STK_INVALID: a write-off needs a reason', 'AC-TST-011 a write-off needs a reason');
select lives_ok($$ select resolve_stock_transfer_shortfall(tst_line(tst_tr('s2')), 'written_off', 'lost on the road') $$, 'AC-TST-011 an Admin writes the shortfall off with a reason');
select is(tst_transit(tst_tr('s2'), '26920000-0000-0000-0000-000000001001'), '0.000/0.00', 'AC-TST-011 transit is empty after the write-off');
select is((select count(*)::int from audit_events where action = 'stock.transfer.write_off'), 1, 'AC-TST-011 the write-off is audited');
reset role;
select is((select count(*)::int from stock_ledger l join stock_documents d on d.id = l.document_id where d.kind = 'adjustment' and d.two_step_id = tst_tr('s2') and l.qty_delta = -2), 1, 'AC-TST-011 one adjustment ledger row of -2 records the loss');

-- ── AC-TST-012 recall ──────────────────────────────────────────────────────────────────────────
select tst_as('26920000-0000-0000-0000-0000000000a2');
select set_config('tst.r1', tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 3)::text, false);
reset role;
select tst_as('26920000-0000-0000-0000-0000000000a4');
select throws_ok($$ select recall_stock_transfer(tst_tr('r1'), 'changed my mind') $$, 'P0001', 'STK_NOT_KEEPER: only the sender, a keeper of the source or an Admin can recall this transfer', 'AC-TST-012 someone else cannot recall');
reset role;
select tst_as('26920000-0000-0000-0000-0000000000a2');
select throws_ok($$ select recall_stock_transfer(tst_tr('r1'), '') $$, 'P0001', 'STK_INVALID: a recall needs a reason', 'AC-TST-012 a recall needs a reason');
select lives_ok($$ select recall_stock_transfer(tst_tr('r1'), 'wrong site') $$, 'AC-TST-012 the sender recalls a transfer in transit');
select is((select status from stock_transfers where id = tst_tr('r1')), 'Cancelled', 'AC-TST-012 it reads Cancelled');
select is(tst_transit(tst_tr('r1'), '26920000-0000-0000-0000-000000001001'), '0.000/0.00', 'AC-TST-012 transit is empty again');
select throws_ok($$ select recall_stock_transfer(tst_tr('t3'), 'late') $$, 'P0001', 'STK_INVALID: only a transfer still in transit can be recalled', 'AC-TST-012 a received transfer cannot be recalled');
reset role;

-- ── AC-TST-013 an Admin may receive their own transfer, audited ─────────────────────────────────
select tst_as('26920000-0000-0000-0000-0000000000a1');
select set_config('tst.a1', tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 1)::text, false);
select lives_ok($$ select tst_recv(tst_tr('a1'), 1, 1) $$, 'AC-TST-013 an Admin can receive their own transfer');
select is((select count(*)::int from audit_events where action = 'stock.self_receive'), 1, 'AC-TST-013 the override is audited');
reset role;

-- ── AC-TST-014 conservation and reconciliation after all of the above (write-offs aside) ─────────
select is((select count(*)::int from stock_transit_reconciliation where ledger_qty <> outstanding_qty), 0, 'AC-TST-014 the transit ledger equals the outstanding quantity of every transfer');
select is(tst_total('26920000-0000-0000-0000-000000001001'), '98.000/392.00', 'AC-TST-014 only the written-off 2 (at 4.00) left the books');
select is(tst_total('26920000-0000-0000-0000-000000001003'), '100.000/500.00', 'AC-TST-014 the quality-checked item is conserved');
select is((select count(*)::int from stock_ledger l join stock_documents d on d.id = l.document_id
            where d.two_step_id is not null and l.item_id = '26920000-0000-0000-0000-000000001002'), 0, 'AC-TST-014 (zero-cost item untouched so far)');
select tst_as('26920000-0000-0000-0000-0000000000a2');
select set_config('tst.z1', tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001002', 8)::text, false);
reset role;
select tst_as('26920000-0000-0000-0000-0000000000a3');
select tst_recv(tst_tr('z1'), 6, 5, '{"reject_reason":"cracked"}');
reset role;
select is(tst_total('26920000-0000-0000-0000-000000001002'), '50.000/0.00', 'AC-TST-014 a zero-cost item keeps value 0 through every leg');
select is((select count(*)::int from stock_transit_reconciliation where ledger_qty <> outstanding_qty), 0, 'AC-TST-014 reconciliation still holds with an open shortfall');

-- ── AC-TST-003 a draft transfer is sent in place ────────────────────────────────────────────────
select tst_as('26920000-0000-0000-0000-0000000000a1');
select set_config('tst.dr', tst_xfer('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 7, false)::text, false);
reset role;
update stock_documents set work_order_id = '26920000-0000-0000-0000-000000000401' where id = tst_tr('dr');
insert into material_requests (org_id, number, work_order_id, project_id, needed_by, status, created_by, transfer_document_id)
  values ('26920000-0000-0000-0000-00000000000a', 'MRQ-TST-1', '26920000-0000-0000-0000-000000000401', '26920000-0000-0000-0000-0000000000c1', current_date, 'approved', '26920000-0000-0000-0000-0000000000a1', tst_tr('dr'));
select tst_as('26920000-0000-0000-0000-0000000000a1');
select set_config('tst.d1', send_stock_transfer('{}'::jsonb, '[]'::jsonb, tst_tr('dr'))::text, false);
reset role;
select is((select send_document_id from stock_transfers where id = tst_tr('d1')), tst_tr('dr'), 'AC-TST-003 the Draft is the send leg: same document id');
select is((select count(*)::int from stock_document_lines where document_id = tst_tr('dr')), 1, 'AC-TST-003 its line is kept');
select is((select status from stock_documents where id = tst_tr('dr')), 'Posted', 'AC-TST-003 and it is posted');
select is((select work_order_id from stock_transfers where id = tst_tr('d1')), '26920000-0000-0000-0000-000000000401'::uuid, 'AC-TST-003 the work order moved to the transfer');
select is(mrq_prior_quantity('26920000-0000-0000-0000-000000000401', '26920000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000000'), 0::numeric, 'AC-TST-032 while in transit nothing has landed at site for the work order');
select tst_as('26920000-0000-0000-0000-0000000000a3');
select tst_recv(tst_tr('d1'), 7, 7);
reset role;
select is(mrq_prior_quantity('26920000-0000-0000-0000-000000000401', '26920000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000000'), 7::numeric, 'AC-TST-032 after the receive the 1100 read equals the accepted quantity, not counted twice');
select is((select status from material_requests where number = 'MRQ-TST-1'), 'fulfilled', 'AC-TST-032 the request reads fulfilled');

-- ── AC-TST-003 work order is checked at send, so a receive cannot fail on it late ───────────────
select tst_as('26920000-0000-0000-0000-0000000000a2');
select throws_ok($$ select tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-000000001001', 1, '{"work_order_id":"26920000-0000-0000-0000-000000000403"}') $$, '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-TST-003 a work order of another project is refused at send');
select throws_ok($$ select tst_send('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_INVALID: a transfer needs a different destination warehouse', 'AC-TST-003 source and destination must differ');
reset role;

-- ── AC-TST-021 reorder: a send is usage by the final destination's kind ─────────────────────────
select tst_as('26920000-0000-0000-0000-0000000000a1');
select is((get_reorder_suggestions('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-000000001001'))->>'status', 'insufficient_history', 'AC-TST-021 the reorder read still answers with transit legs in the ledger (history rules unchanged)');
reset role;

-- ── AC-TST-018 / 030 / 031 proof timing on one tag (see also 1307 for confirmations) ───────────
select * from finish();
rollback;
