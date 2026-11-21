-- 1305_stock_two_step_settings.test.sql — #2690 (spec docs/specs/stock-two-step-transfer.spec.md). Migration under test: 1305.
-- AC-TST-001 default org unchanged · 002 mode switch · 017 proof_required sync · 019 confirmation needs two-step · 029 proof timing.
-- Mutation checks (break, expect red, restore): mut:mode_admin (002) · mut:mode_off_guard (002) · mut:timing_admin (029) · mut:transit_system_only (see 1306).
-- Every denial asserts errcode AND message where the message is ours.
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values
  ('26910000-0000-0000-0000-00000000000a', 'TST Org', 'IDR', 'UTC'),
  ('26910000-0000-0000-0000-00000000000b', 'TST Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26910000-0000-0000-0000-0000000000a1', 'tst-admin@example.com'),
  ('26910000-0000-0000-0000-0000000000a2', 'tst-src@example.com'),
  ('26910000-0000-0000-0000-0000000000a3', 'tst-dst@example.com'),
  ('26910000-0000-0000-0000-0000000000a4', 'tst-plain@example.com'),
  ('26910000-0000-0000-0000-0000000000b1', 'tst-other-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26910000-0000-0000-0000-0000000000a1', '26910000-0000-0000-0000-00000000000a', 'TST Admin', 'tst-admin@example.com', 'Admin', 'active'),
  ('26910000-0000-0000-0000-0000000000a2', '26910000-0000-0000-0000-00000000000a', 'TST Source Keeper', 'tst-src@example.com', 'Engineer', 'active'),
  ('26910000-0000-0000-0000-0000000000a3', '26910000-0000-0000-0000-00000000000a', 'TST Dest Keeper', 'tst-dst@example.com', 'Engineer', 'active'),
  ('26910000-0000-0000-0000-0000000000a4', '26910000-0000-0000-0000-00000000000a', 'TST Plain Member', 'tst-plain@example.com', 'Engineer', 'active'),
  ('26910000-0000-0000-0000-0000000000b1', '26910000-0000-0000-0000-00000000000b', 'TST Other Admin', 'tst-other-admin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('26910000-0000-0000-0000-0000000000f1', '26910000-0000-0000-0000-00000000000a', 'TST Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('26910000-0000-0000-0000-0000000000c1', '26910000-0000-0000-0000-00000000000a', 'TST Job One', 'Ongoing Project', 1000000, 'exclusive', 0, '26910000-0000-0000-0000-0000000000f1', '26910000-0000-0000-0000-0000000000a1'),
  ('26910000-0000-0000-0000-0000000000c2', '26910000-0000-0000-0000-00000000000a', 'TST Job Two', 'Ongoing Project', 1000000, 'exclusive', 0, '26910000-0000-0000-0000-0000000000f1', '26910000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26910000-0000-0000-0000-000000000401', '26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-0000000000c1', 'TST WO one', 'Issued', 10000, 'exclusive', 0),
  ('26910000-0000-0000-0000-000000000403', '26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-0000000000c2', 'TST WO other job', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26910000-0000-0000-0000-0000000000d1', '26910000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_tags (id, org_id, name, zero_cost, paper_required) values
  ('26910000-0000-0000-0000-000000003001', '26910000-0000-0000-0000-00000000000a', 'Client supplied', true, false),
  ('26910000-0000-0000-0000-000000003002', '26910000-0000-0000-0000-00000000000a', 'Plain tag', false, false);
insert into stock_items (id, org_id, code, name, unit_id, tag_id, needs_quality_check) values
  ('26910000-0000-0000-0000-000000001001', '26910000-0000-0000-0000-00000000000a', 'PIPE', 'Pipe', '26910000-0000-0000-0000-0000000000d1', null, false),
  ('26910000-0000-0000-0000-000000001002', '26910000-0000-0000-0000-00000000000a', 'FREE', 'Free issue valve', '26910000-0000-0000-0000-0000000000d1', '26910000-0000-0000-0000-000000003001', false),
  ('26910000-0000-0000-0000-000000001003', '26910000-0000-0000-0000-00000000000a', 'QC', 'Checked valve', '26910000-0000-0000-0000-0000000000d1', null, true),
  ('26910000-0000-0000-0000-000000001004', '26910000-0000-0000-0000-00000000000a', 'CONF', 'Confirmed item', '26910000-0000-0000-0000-0000000000d1', '26910000-0000-0000-0000-000000003002', false);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-00000000000a', 'CEN',   'Central', 'central', null),
  ('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26910000-0000-0000-0000-0000000000c1'),
  ('26910000-0000-0000-0000-000000002003', '26910000-0000-0000-0000-00000000000a', 'YARD1', 'Yard one', 'yard', '26910000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-0000000000a2'),
  ('26910000-0000-0000-0000-00000000000a', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-0000000000a3');

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

-- ── AC-TST-001 default organisation: nothing changes ─────────────────────────────────────────────
select is((select stock_transfer_mode from organizations where id = '26910000-0000-0000-0000-00000000000a'), 'one_step', 'AC-TST-001 the default transfer mode is one_step');
select is((select stock_proof_timing from organizations where id = '26910000-0000-0000-0000-00000000000a'), 'before_posting', 'AC-TST-029 the default proof timing is before_posting');
select tst_as('26910000-0000-0000-0000-0000000000a1');
select tst_rcv('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-000000001001', 20, 4);
select lives_ok($$ select tst_xfer('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001', 5) $$, 'AC-TST-001 a one-step transfer still posts both legs at once');
select is(tst_bal('26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001'), '5.000/20.00', 'AC-TST-001 the destination holds the carried value');
select throws_ok($$ select tst_send('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001', 1) $$,
  'P0001', 'STK_TWO_STEP_OFF: two-step transfers are not turned on for your organisation', 'AC-TST-001 send is refused while the organisation is one_step');
select is((select count(*)::int from stock_transfers), 0, 'AC-TST-001 no two-step transfer exists');
reset role;

-- ── AC-TST-019 a confirmation rule needs two-step ──────────────────────────────────────────────
select throws_ok($$ update stock_tags set proof_required = 'confirmation' where id = '26910000-0000-0000-0000-000000003002' $$,
  'P0001', 'STK_PROOF_MODE: a handover confirmation can only be required when transfers are two-step', 'AC-TST-019 confirmation is refused in a one-step organisation');
select throws_ok($$ update stock_tags set proof_required = 'either' where id = '26910000-0000-0000-0000-000000003002' $$,
  'P0001', 'STK_PROOF_MODE: a handover confirmation can only be required when transfers are two-step', 'AC-TST-019 either is refused in a one-step organisation');

-- ── AC-TST-017 proof_required and the legacy paper_required stay in step ───────────────────────────
select lives_ok($$ insert into stock_tags (id, org_id, name, zero_cost, paper_required) values ('26910000-0000-0000-0000-000000003003', '26910000-0000-0000-0000-00000000000a', 'Legacy paper', true, true) $$, 'AC-TST-017 a legacy paper tag inserts');
select is((select proof_required from stock_tags where id = '26910000-0000-0000-0000-000000003003'), 'paper', 'AC-TST-017 a legacy paper_required tag reads as proof paper');
select lives_ok($$ update stock_tags set paper_required = false where id = '26910000-0000-0000-0000-000000003003' $$, 'AC-TST-017 clearing the legacy flag works');
select is((select proof_required from stock_tags where id = '26910000-0000-0000-0000-000000003003'), 'none', 'AC-TST-017 clearing paper_required clears the proof rule');
select lives_ok($$ update stock_tags set proof_required = 'paper' where id = '26910000-0000-0000-0000-000000003003' $$, 'AC-TST-017 setting proof paper works on a zero-cost tag');
select is((select paper_required from stock_tags where id = '26910000-0000-0000-0000-000000003003'), true, 'AC-TST-017 proof paper sets paper_required');
select throws_ok($$ update stock_tags set proof_required = 'paper' where id = '26910000-0000-0000-0000-000000003002' $$, '23514', null, 'AC-TST-017 paper on a tag that is not zero-cost is still refused');

-- ── AC-TST-002 the mode switch ────────────────────────────────────────────────────────────────
select tst_as('26910000-0000-0000-0000-0000000000a2');
select throws_ok($$ select set_stock_transfer_mode('two_step') $$, '42501', 'STK_FORBIDDEN: only an Admin changes the transfer mode', 'AC-TST-002 a non-Admin cannot change the mode');
reset role;
select tst_as('26910000-0000-0000-0000-0000000000a1');
select throws_ok($$ select set_stock_transfer_mode('sideways') $$, 'P0001', 'STK_INVALID: the transfer mode is one_step or two_step', 'AC-TST-002 an unknown mode is refused');
select set_config('tst.draft', tst_xfer('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001', 1, false)::text, false);
select throws_ok($$ select set_stock_transfer_mode('two_step') $$, 'P0001', 'STK_MODE_BLOCKED: post or delete the Draft transfers first', 'AC-TST-002 a loose Draft transfer blocks turning two-step on');
select lives_ok($$ select cancel_stock_document(current_setting('tst.draft')::uuid) $$, 'AC-TST-002 the Draft is cancelled');
select is(set_stock_transfer_mode('two_step'), 'two_step', 'AC-TST-002 an Admin turns two-step on');
select is((select count(*)::int from audit_events where action = 'stock.transfer_mode'), 1, 'AC-TST-002 the change is audited');
select lives_ok($$ update stock_tags set proof_required = 'confirmation' where id = '26910000-0000-0000-0000-000000003002' $$, 'AC-TST-019 confirmation is accepted once two-step is on');
select throws_ok($$ select set_stock_transfer_mode('one_step') $$, 'P0001', 'STK_MODE_BLOCKED: a tag still needs a handover confirmation', 'AC-TST-002 turning two-step off is blocked while a tag needs a confirmation');
select lives_ok($$ update stock_tags set proof_required = 'none' where id = '26910000-0000-0000-0000-000000003002' $$, 'AC-TST-002 the tag rule is cleared');
select throws_ok($$ select tst_xfer('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001', 1) $$, 'P0001', 'STK_TWO_STEP: your organisation sends transfers in two steps: send, then receive', 'AC-TST-003 a one-step post is refused while two-step is on');
select set_config('tst.t1', tst_send('26910000-0000-0000-0000-000000002001', '26910000-0000-0000-0000-000000002002', '26910000-0000-0000-0000-000000001001', 2)::text, false);
select throws_ok($$ select set_stock_transfer_mode('one_step') $$, 'P0001', 'STK_MODE_BLOCKED: transfers are still in transit or short', 'AC-TST-002 turning two-step off is blocked while a transfer is in transit');
reset role;

-- ── AC-TST-029 proof timing ───────────────────────────────────────────────────────────────────
select tst_as('26910000-0000-0000-0000-0000000000a2');
select throws_ok($$ select set_stock_proof_timing('may_follow') $$, '42501', 'STK_FORBIDDEN: only an Admin changes the proof timing', 'AC-TST-029 a non-Admin cannot change the proof timing');
reset role;
select tst_as('26910000-0000-0000-0000-0000000000a1');
select throws_ok($$ select set_stock_proof_timing('whenever') $$, 'P0001', 'STK_INVALID: the proof timing is before_posting or may_follow', 'AC-TST-029 an unknown timing is refused');
select is(set_stock_proof_timing('may_follow'), 'may_follow', 'AC-TST-029 an Admin sets may_follow');
select is((select stock_proof_timing from organizations where id = '26910000-0000-0000-0000-00000000000a'), 'may_follow', 'AC-TST-029 it is stored');
select is((select count(*)::int from audit_events where action = 'stock.proof_timing'), 1, 'AC-TST-029 the change is audited');
reset role;
select tst_as('26910000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from stock_transfers), 0, 'AC-TST-022 another organisation reads none of these transfers');
reset role;
select * from finish();
rollback;
