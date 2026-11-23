-- 1307_stock_handover_confirmations.test.sql — #2690 (spec docs/specs/stock-two-step-transfer.spec.md). Migrations under test: 1307, 1308 (and 1305).
-- AC-TST-015 account-signed confirmation · 016 guest-signed · 018 proof rule matrix at receive · 022 isolation · 031 proof may follow (late confirmation).
-- Mutation checks: mut:confirm_immutable (015) · mut:guest_name (016) · mut:proof_check (018) · mut:late_actor (031) · mut:self_receive (016) · mut:guest_self_receive (016: the guest case on the sender's phone).
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values
  ('26930000-0000-0000-0000-00000000000a', 'TST Org', 'IDR', 'UTC'),
  ('26930000-0000-0000-0000-00000000000b', 'TST Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26930000-0000-0000-0000-0000000000a1', 'tst-admin@example.com'),
  ('26930000-0000-0000-0000-0000000000a2', 'tst-src@example.com'),
  ('26930000-0000-0000-0000-0000000000a3', 'tst-dst@example.com'),
  ('26930000-0000-0000-0000-0000000000a4', 'tst-plain@example.com'),
  ('26930000-0000-0000-0000-0000000000b1', 'tst-other-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26930000-0000-0000-0000-0000000000a1', '26930000-0000-0000-0000-00000000000a', 'TST Admin', 'tst-admin@example.com', 'Admin', 'active'),
  ('26930000-0000-0000-0000-0000000000a2', '26930000-0000-0000-0000-00000000000a', 'TST Source Keeper', 'tst-src@example.com', 'Engineer', 'active'),
  ('26930000-0000-0000-0000-0000000000a3', '26930000-0000-0000-0000-00000000000a', 'TST Dest Keeper', 'tst-dst@example.com', 'Engineer', 'active'),
  ('26930000-0000-0000-0000-0000000000a4', '26930000-0000-0000-0000-00000000000a', 'TST Plain Member', 'tst-plain@example.com', 'Engineer', 'active'),
  ('26930000-0000-0000-0000-0000000000b1', '26930000-0000-0000-0000-00000000000b', 'TST Other Admin', 'tst-other-admin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('26930000-0000-0000-0000-0000000000f1', '26930000-0000-0000-0000-00000000000a', 'TST Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('26930000-0000-0000-0000-0000000000c1', '26930000-0000-0000-0000-00000000000a', 'TST Job One', 'Ongoing Project', 1000000, 'exclusive', 0, '26930000-0000-0000-0000-0000000000f1', '26930000-0000-0000-0000-0000000000a1'),
  ('26930000-0000-0000-0000-0000000000c2', '26930000-0000-0000-0000-00000000000a', 'TST Job Two', 'Ongoing Project', 1000000, 'exclusive', 0, '26930000-0000-0000-0000-0000000000f1', '26930000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-00000000000a', '26930000-0000-0000-0000-0000000000c1', 'TST WO one', 'Issued', 10000, 'exclusive', 0),
  ('26930000-0000-0000-0000-000000000403', '26930000-0000-0000-0000-00000000000a', '26930000-0000-0000-0000-0000000000c2', 'TST WO other job', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26930000-0000-0000-0000-0000000000d1', '26930000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_tags (id, org_id, name, zero_cost, paper_required) values
  ('26930000-0000-0000-0000-000000003001', '26930000-0000-0000-0000-00000000000a', 'Client supplied', true, false),
  ('26930000-0000-0000-0000-000000003002', '26930000-0000-0000-0000-00000000000a', 'Plain tag', false, false);
insert into stock_items (id, org_id, code, name, unit_id, tag_id, needs_quality_check) values
  ('26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-00000000000a', 'PIPE', 'Pipe', '26930000-0000-0000-0000-0000000000d1', null, false),
  ('26930000-0000-0000-0000-000000001002', '26930000-0000-0000-0000-00000000000a', 'FREE', 'Free issue valve', '26930000-0000-0000-0000-0000000000d1', '26930000-0000-0000-0000-000000003001', false),
  ('26930000-0000-0000-0000-000000001003', '26930000-0000-0000-0000-00000000000a', 'QC', 'Checked valve', '26930000-0000-0000-0000-0000000000d1', null, true),
  ('26930000-0000-0000-0000-000000001004', '26930000-0000-0000-0000-00000000000a', 'CONF', 'Confirmed item', '26930000-0000-0000-0000-0000000000d1', '26930000-0000-0000-0000-000000003002', false);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-00000000000a', 'CEN',   'Central', 'central', null),
  ('26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26930000-0000-0000-0000-0000000000c1'),
  ('26930000-0000-0000-0000-000000002003', '26930000-0000-0000-0000-00000000000a', 'YARD1', 'Yard one', 'yard', '26930000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('26930000-0000-0000-0000-00000000000a', '26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-0000000000a2'),
  ('26930000-0000-0000-0000-00000000000a', '26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-0000000000a3');

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

update organizations set stock_transfer_mode = 'two_step' where id = '26930000-0000-0000-0000-00000000000a';
insert into stock_tags (id, org_id, name, zero_cost, paper_required, proof_required) values
  ('26930000-0000-0000-0000-000000003004', '26930000-0000-0000-0000-00000000000a', 'Either tag', false, false, 'either');
update stock_tags set proof_required = 'paper' where id = '26930000-0000-0000-0000-000000003001';
update stock_tags set proof_required = 'confirmation' where id = '26930000-0000-0000-0000-000000003002';
insert into stock_items (id, org_id, code, name, unit_id, tag_id) values
  ('26930000-0000-0000-0000-000000001005', '26930000-0000-0000-0000-00000000000a', 'EITH', 'Either item', '26930000-0000-0000-0000-0000000000d1', '26930000-0000-0000-0000-000000003004');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values ('26930000-0000-0000-0000-00000000000a', '26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-0000000000a2');
create function public.tst_tr(p_n text) returns uuid language sql as $$ select current_setting('tst.' || p_n)::uuid $$;
-- A confirmation payload whose photo objects are uploaded (security definer: the fixture plays the client's upload).
create function public.tst_conf(p_t uuid, p_type text, p_kind text, p_name text default null, p_stage text default 'receive') returns jsonb
  language plpgsql security definer set search_path = public, storage as $$
declare v_id uuid := gen_random_uuid(); v_base text := '26930000-0000-0000-0000-00000000000a/' || p_t || '/' || v_id || '/';
begin
  if p_type = 'in_app' then
    insert into storage.objects (bucket_id, name) values ('stock-handover', v_base || 'goods.jpg'), ('stock-handover', v_base || 'person.jpg');
  else
    insert into storage.objects (bucket_id, name) values ('stock-handover', v_base || 'paper.jpg');
  end if;
  return jsonb_build_object('id', v_id, 'stage', p_stage, 'proof_type', p_type, 'signer_kind', p_kind)
    || case when p_name is not null then jsonb_build_object('signer_name', p_name) else '{}'::jsonb end
    || case when p_type = 'in_app' then jsonb_build_object('goods_photo_path', v_base || 'goods.jpg', 'signer_photo_path', v_base || 'person.jpg')
            else jsonb_build_object('paper_photo_path', v_base || 'paper.jpg') end;
end $$;
select tst_as('26930000-0000-0000-0000-0000000000a1');
select tst_rcv('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000001004', 50, 3);
select tst_rcv('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000001002', 50, 0);
select tst_rcv('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000001005', 50, 2);
select tst_rcv('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000001001', 50, 4);
reset role;

-- ── AC-TST-018 proof rule 'confirmation' (before_posting) ───────────────────────────────────────
select tst_as('26930000-0000-0000-0000-0000000000a2');
select set_config('tst.c1', tst_send('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001004', 4)::text, false);
reset role;
select tst_as('26930000-0000-0000-0000-0000000000a3');
select throws_ok($$ select tst_recv(tst_tr('c1'), 4, 4) $$, 'P0001', 'STK_PROOF_REQUIRED: this transfer needs its proof (confirmation) before it can be received', 'AC-TST-018 no proof: refused');
select throws_ok($$ select tst_recv(tst_tr('c1'), 4, 4, '{}', tst_conf(tst_tr('c1'), 'paper', 'account')) $$, 'P0001', 'STK_PROOF_REQUIRED: this transfer needs its proof (confirmation) before it can be received', 'AC-TST-018 paper does not count for a confirmation rule');
select throws_ok($$ select tst_recv(tst_tr('c1'), 4, 4, '{}', tst_conf(tst_tr('c1'), 'in_app', 'account') || '{"goods_photo_path":"nope/x.jpg"}') $$, 'P0001', 'STK_FILE_MISSING: upload the photo before confirming the handover', 'AC-TST-015 a photo that was never uploaded is refused');
select is((select count(*)::int from stock_transfers where id = tst_tr('c1') and status = 'Sent'), 1, 'AC-TST-018 the refused receives left the transfer Sent');
select lives_ok($$ select tst_recv(tst_tr('c1'), 4, 4, '{}', tst_conf(tst_tr('c1'), 'in_app', 'account')) $$, 'AC-TST-018 an in-app confirmation meets a confirmation rule');
reset role;

-- ── AC-TST-015 what the confirmation records ────────────────────────────────────────────────────
select is((select signer_name from stock_handover_confirmations where transfer_id = tst_tr('c1')), 'TST Dest Keeper', 'AC-TST-015 the name is the logged-in person''s profile name');
select is((select signer_kind || '/' || (signer_user_id = '26930000-0000-0000-0000-0000000000a3')::text || '/' || (recorded_by = '26930000-0000-0000-0000-0000000000a3')::text from stock_handover_confirmations where transfer_id = tst_tr('c1')), 'account/true/true', 'AC-TST-015 an account signer is the logged-in person');
select is((select counts->0->>'quantity' from stock_handover_confirmations where transfer_id = tst_tr('c1')), '4.000', 'AC-TST-015 the counted quantity is copied from the transfer lines');
select isnt((select confirmed_at from stock_handover_confirmations where transfer_id = tst_tr('c1')), null, 'AC-TST-015 the time is recorded by the server');
select throws_ok($$ update stock_handover_confirmations set signer_name = 'Someone else' $$, 'P0001', 'STK_IMMUTABLE: a handover confirmation never changes', 'AC-TST-015 a confirmation cannot be changed');
select throws_ok($$ delete from stock_handover_confirmations $$, 'P0001', 'STK_IMMUTABLE: a handover confirmation never changes', 'AC-TST-015 a confirmation cannot be deleted');
select tst_as('26930000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into stock_handover_confirmations (org_id, transfer_id, stage, proof_type, signer_kind, signer_name, recorded_by, counts) values ('26930000-0000-0000-0000-00000000000a', tst_tr('c1'), 'receive', 'paper', 'guest', 'Forged', '26930000-0000-0000-0000-0000000000a3', '[]') $$, '42501', null, 'AC-TST-022 a client cannot write a confirmation directly');
select throws_ok($$ update stock_transfers set status = 'Closed' $$, '42501', null, 'AC-TST-022 a client cannot write a transfer directly');
reset role;

-- ── AC-TST-016 a person with no account signs on the host's phone ───────────────────────────────
select tst_as('26930000-0000-0000-0000-0000000000a2');
select set_config('tst.g1', tst_send('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001004', 3)::text, false);
select set_config('tst.g2', tst_send('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001004', 2)::text, false);
reset role;
select tst_as('26930000-0000-0000-0000-0000000000a3');
select throws_ok($$ select tst_recv(tst_tr('g1'), 3, 3, '{}', tst_conf(tst_tr('g1'), 'in_app', 'guest', 'X')) $$, '23514', null, 'AC-TST-016 a one-character typed name is refused');
select throws_ok($$ select tst_recv(tst_tr('g1'), 3, 3, '{}', tst_conf(tst_tr('g1'), 'in_app', 'guest')) $$, '23514', null, 'AC-TST-016 a guest with no name is refused');
select lives_ok($$ select tst_recv(tst_tr('g1'), 3, 3, '{}', tst_conf(tst_tr('g1'), 'in_app', 'guest', 'Gate Guard')) $$, 'AC-TST-016 a guest with a typed name confirms on the host''s phone');
reset role;
select is((select signer_kind || '/' || signer_name || '/' || coalesce(signer_user_id::text, 'none') || '/' || (recorded_by = '26930000-0000-0000-0000-0000000000a3')::text from stock_handover_confirmations where transfer_id = tst_tr('g1')), 'guest/Gate Guard/none/true', 'AC-TST-016 the guest is named, has no user, and the host is recorded');
select tst_as('26930000-0000-0000-0000-0000000000a2');
select throws_ok($$ select tst_recv(tst_tr('g2'), 2, 2, '{}', tst_conf(tst_tr('g2'), 'in_app', 'account')) $$, 'P0001', 'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it', 'AC-TST-016 the sender cannot confirm their own transfer as the receiver');
select throws_ok($$ select tst_recv(tst_tr('g2'), 2, 2, '{}', tst_conf(tst_tr('g2'), 'in_app', 'guest', 'Site Foreman')) $$, 'P0001', 'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it', 'AC-TST-016 a guest signing on the sender''s own phone does not let the sender record the count');
reset role;
select tst_as('26930000-0000-0000-0000-0000000000a3');
select lives_ok($$ select tst_recv(tst_tr('g2'), 2, 2, '{}', tst_conf(tst_tr('g2'), 'in_app', 'guest', 'Site Foreman')) $$, 'AC-TST-016 a different person records the count, with a guest signing on their phone');
reset role;

-- ── AC-TST-018 rule paper / either, and a mixed transfer ────────────────────────────────────────
select tst_as('26930000-0000-0000-0000-0000000000a2');
select set_config('tst.p1', tst_send('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001002', 5)::text, false);
select set_config('tst.e1', tst_send('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001005', 5)::text, false);
select set_config('tst.e2', tst_send('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001005', 5)::text, false);
select set_config('tst.m1', public.send_stock_transfer(jsonb_build_object('warehouse_id', '26930000-0000-0000-0000-000000002001', 'to_warehouse_id', '26930000-0000-0000-0000-000000002002'),
  jsonb_build_array(jsonb_build_object('item_id', '26930000-0000-0000-0000-000000001002', 'quantity', 1), jsonb_build_object('item_id', '26930000-0000-0000-0000-000000001004', 'quantity', 1)))::text, false);
reset role;
select tst_as('26930000-0000-0000-0000-0000000000a3');
select throws_ok($$ select tst_recv(tst_tr('p1'), 5, 5) $$, 'P0001', 'STK_PROOF_REQUIRED: this transfer needs its proof (paper) before it can be received', 'AC-TST-018 paper rule: no proof is refused');
select throws_ok($$ select tst_recv(tst_tr('p1'), 5, 5, '{}', tst_conf(tst_tr('p1'), 'in_app', 'account')) $$, 'P0001', 'STK_PROOF_REQUIRED: this transfer needs its proof (paper) before it can be received', 'AC-TST-018 an in-app confirmation does not meet a paper rule');
select lives_ok($$ select tst_recv(tst_tr('p1'), 5, 5, '{}', tst_conf(tst_tr('p1'), 'paper', 'account')) $$, 'AC-TST-018 a photographed signed paper meets a paper rule');
select throws_ok($$ select tst_recv(tst_tr('e1'), 5, 5) $$, 'P0001', 'STK_PROOF_REQUIRED: this transfer needs its proof (either) before it can be received', 'AC-TST-018 either rule: no proof is refused');
select lives_ok($$ select tst_recv(tst_tr('e1'), 5, 5, '{}', tst_conf(tst_tr('e1'), 'in_app', 'account')) $$, 'AC-TST-018 either rule: in-app counts');
select lives_ok($$ select tst_recv(tst_tr('e2'), 5, 5, '{}', tst_conf(tst_tr('e2'), 'paper', 'account')) $$, 'AC-TST-018 either rule: paper counts');
select throws_ok($$ select public.receive_stock_transfer(tst_tr('m1'), (select jsonb_agg(jsonb_build_object('line_id', l.id, 'counted', 1, 'accepted', 1)) from stock_transfer_lines l where l.transfer_id = tst_tr('m1')), tst_conf(tst_tr('m1'), 'in_app', 'account')) $$,
  'P0001', 'STK_PROOF_REQUIRED: this transfer needs its proof (paper) before it can be received', 'AC-TST-018 a mixed transfer needs each tag''s rule: the in-app confirmation does not cover the paper tag');
reset role;
select is((select count(*)::int from stock_transfers where id = tst_tr('m1') and status = 'Sent'), 1, 'AC-TST-018 the mixed transfer stays Sent');

-- ── AC-TST-031 proof may follow: receive first, prove later ─────────────────────────────────────
update organizations set stock_proof_timing = 'may_follow' where id = '26930000-0000-0000-0000-00000000000a';
select tst_as('26930000-0000-0000-0000-0000000000a2');
select set_config('tst.f1', tst_send('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001004', 2, '{}')::text, false);
reset role;
select tst_as('26930000-0000-0000-0000-0000000000a4');
select throws_ok($$ select record_stock_handover(tst_tr('f1'), tst_conf(tst_tr('f1'), 'in_app', 'account')) $$, 'P0001', 'STK_NOT_RECEIVER: you cannot confirm this handover', 'AC-TST-031 someone with no part cannot confirm');
reset role;
select tst_as('26930000-0000-0000-0000-0000000000a3');
select throws_ok($$ select record_stock_handover(tst_tr('f1'), tst_conf(tst_tr('f1'), 'in_app', 'account')) $$, 'P0001', 'STK_INVALID: a receive confirmation needs the count first', 'AC-TST-031 a receive confirmation needs the count first');
select lives_ok($$ select tst_recv(tst_tr('f1'), 2, 2) $$, 'AC-TST-031 under may_follow the transfer is received without its proof');
select is((select status from stock_transfers where id = tst_tr('f1')), 'Closed', 'AC-TST-031 the stock arrived');
select is((select proof_status || '/' || missing from get_stock_movement_proof_status() where movement_id = tst_tr('f1')), 'outstanding/confirmation', 'AC-TST-031 the movement reads proof outstanding, naming the missing proof');
reset role;
select tst_as('26930000-0000-0000-0000-0000000000a2');
select throws_ok($$ select record_stock_handover(tst_tr('f1'), tst_conf(tst_tr('f1'), 'in_app', 'account')) $$, 'P0001', 'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it', 'AC-TST-031 the sender cannot give the late receive confirmation as an account');
reset role;
select tst_as('26930000-0000-0000-0000-0000000000a3');
select lives_ok($$ select record_stock_handover(tst_tr('f1'), tst_conf(tst_tr('f1'), 'in_app', 'account')) $$, 'AC-TST-031 the receiver confirms afterwards');
select is((select proof_status from get_stock_movement_proof_status() where movement_id = tst_tr('f1')), 'complete', 'AC-TST-031 the movement now reads proof complete');
reset role;
-- a send-stage confirmation by a guest carrier on the sender's phone, recorded after the send (the transfer must exist for the photo path)
select tst_as('26930000-0000-0000-0000-0000000000a2');
select set_config('tst.f2', tst_send('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001001', 2)::text, false);
select lives_ok($$ select record_stock_handover(tst_tr('f2'), tst_conf(tst_tr('f2'), 'in_app', 'guest', 'Driver D', 'send')) $$, 'AC-TST-016 a guest carrier signs the send on the sender''s phone');
reset role;
select is((select stage || '/' || signer_kind || '/' || (counts->0->>'quantity') from stock_handover_confirmations where transfer_id = tst_tr('f2')), 'send/guest/2.000', 'AC-TST-016 the send-stage count is the sent quantity');

-- ── AC-TST-022 storage and isolation ─────────────────────────────────────────────────────────────
select tst_as('26930000-0000-0000-0000-0000000000a3');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('stock-handover', '26930000-0000-0000-0000-00000000000a/' || tst_tr('f2') || '/' || gen_random_uuid() || '/photo.jpg') $$, 'AC-TST-022 the destination keeper can upload a handover photo to the transfer');
reset role;
select tst_as('26930000-0000-0000-0000-0000000000a4');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('stock-handover', '26930000-0000-0000-0000-00000000000a/' || tst_tr('f2') || '/' || gen_random_uuid() || '/photo.jpg') $$, '42501', null, 'AC-TST-022 a member with no part in the transfer cannot');
reset role;
select tst_as('26930000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from stock_handover_confirmations), 0, 'AC-TST-022 another organisation reads no confirmation');
select is((select count(*)::int from stock_transfers), 0, 'AC-TST-022 another organisation reads no transfer');
select throws_ok($$ select record_stock_handover(tst_tr('f2'), tst_conf(tst_tr('f2'), 'paper', 'account')) $$, 'P0001', 'STK_NOT_FOUND: the transfer is not in your organisation', 'AC-TST-022 another organisation cannot confirm a handover');
select throws_ok($$ select receive_stock_transfer(tst_tr('f2'), '[]'::jsonb) $$, 'P0001', 'STK_NOT_FOUND: the transfer is not in your organisation', 'AC-TST-022 another organisation cannot receive');
reset role;
select * from finish();
rollback;
