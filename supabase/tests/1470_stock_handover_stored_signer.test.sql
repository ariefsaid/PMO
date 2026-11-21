-- 1470_stock_handover_stored_signer.test.sql — a receive-stage handover confirmation is checked on the values the row stores (FR-TST-044).
-- An empty signer kind or proof type means the stored account / in-app values, so the sender-is-not-the-receiver rule
-- refuses them exactly as the explicit values are refused. Migrations under test: 1470 (and 1305..1308). Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone) values
  ('47000000-0000-0000-0000-00000000000a', 'TST Org', 'IDR', 'UTC'),
  ('47000000-0000-0000-0000-00000000000b', 'TST Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('47000000-0000-0000-0000-0000000000a1', 'tst-admin@example.com'),
  ('47000000-0000-0000-0000-0000000000a2', 'tst-src@example.com'),
  ('47000000-0000-0000-0000-0000000000a3', 'tst-dst@example.com'),
  ('47000000-0000-0000-0000-0000000000b1', 'tst-other-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('47000000-0000-0000-0000-0000000000a1', '47000000-0000-0000-0000-00000000000a', 'TST Admin', 'tst-admin@example.com', 'Admin', 'active'),
  ('47000000-0000-0000-0000-0000000000a2', '47000000-0000-0000-0000-00000000000a', 'TST Source Keeper', 'tst-src@example.com', 'Engineer', 'active'),
  ('47000000-0000-0000-0000-0000000000a3', '47000000-0000-0000-0000-00000000000a', 'TST Dest Keeper', 'tst-dst@example.com', 'Engineer', 'active'),
  ('47000000-0000-0000-0000-0000000000b1', '47000000-0000-0000-0000-00000000000b', 'TST Other Admin', 'tst-other-admin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('47000000-0000-0000-0000-0000000000f1', '47000000-0000-0000-0000-00000000000a', 'TST Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('47000000-0000-0000-0000-0000000000c1', '47000000-0000-0000-0000-00000000000a', 'TST Job One', 'Ongoing Project', 1000000, 'exclusive', 0, '47000000-0000-0000-0000-0000000000f1', '47000000-0000-0000-0000-0000000000a1');
insert into stock_units (id, org_id, code, name, whole_only) values
  ('47000000-0000-0000-0000-0000000000d1', '47000000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_tags (id, org_id, name, zero_cost) values
  ('47000000-0000-0000-0000-000000003002', '47000000-0000-0000-0000-00000000000a', 'Plain tag', false);
insert into stock_items (id, org_id, code, name, unit_id, tag_id, needs_quality_check) values
  ('47000000-0000-0000-0000-000000001004', '47000000-0000-0000-0000-00000000000a', 'CONF', 'Confirmed item', '47000000-0000-0000-0000-0000000000d1', '47000000-0000-0000-0000-000000003002', false);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('47000000-0000-0000-0000-000000002001', '47000000-0000-0000-0000-00000000000a', 'CEN',   'Central', 'central', null),
  ('47000000-0000-0000-0000-000000002002', '47000000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '47000000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('47000000-0000-0000-0000-00000000000a', '47000000-0000-0000-0000-000000002001', '47000000-0000-0000-0000-0000000000a2'),
  ('47000000-0000-0000-0000-00000000000a', '47000000-0000-0000-0000-000000002002', '47000000-0000-0000-0000-0000000000a3'),
  ('47000000-0000-0000-0000-00000000000a', '47000000-0000-0000-0000-000000002002', '47000000-0000-0000-0000-0000000000a2');

create or replace function pg_temp._as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp._rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create or replace function pg_temp._send(p_from uuid, p_to uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.send_stock_transfer(jsonb_build_object('warehouse_id',p_from,'to_warehouse_id',p_to),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty))) $$;
create or replace function pg_temp._recv(p_transfer uuid, p_counted numeric, p_accepted numeric) returns void language sql as $$
  select public.receive_stock_transfer(p_transfer,
    (select jsonb_agg(jsonb_build_object('line_id', l.id, 'counted', p_counted, 'accepted', p_accepted)) from public.stock_transfer_lines l where l.transfer_id = p_transfer)) $$;
create or replace function pg_temp._tr(p_n text) returns uuid language sql as $$ select current_setting('tst.' || p_n)::uuid $$;
-- A confirmation payload whose photo objects are uploaded (security definer: the fixture plays the client's upload).
create or replace function pg_temp._conf(p_t uuid, p_type text, p_kind text) returns jsonb
  language plpgsql security definer set search_path = public, storage as $$
declare v_id uuid := gen_random_uuid(); v_base text := '47000000-0000-0000-0000-00000000000a/' || p_t || '/' || v_id || '/';
begin
  if p_type = 'in_app' then
    insert into storage.objects (bucket_id, name) values ('stock-handover', v_base || 'goods.jpg'), ('stock-handover', v_base || 'person.jpg');
  else
    insert into storage.objects (bucket_id, name) values ('stock-handover', v_base || 'paper.jpg');
  end if;
  return jsonb_build_object('id', v_id, 'stage', 'receive', 'proof_type', p_type, 'signer_kind', p_kind)
    || case when p_type = 'in_app' then jsonb_build_object('goods_photo_path', v_base || 'goods.jpg', 'signer_photo_path', v_base || 'person.jpg')
            else jsonb_build_object('paper_photo_path', v_base || 'paper.jpg') end;
end $$;

update organizations set stock_transfer_mode = 'two_step', stock_proof_timing = 'may_follow' where id = '47000000-0000-0000-0000-00000000000a';
update stock_tags set proof_required = 'confirmation' where id = '47000000-0000-0000-0000-000000003002';
select pg_temp._as('47000000-0000-0000-0000-0000000000a1');
select pg_temp._rcv('47000000-0000-0000-0000-000000002001', '47000000-0000-0000-0000-000000001004', 50, 3);
reset role;

-- proof may follow: the receiver counts and the transfer closes without its confirmation, as AC-TST-031 allows
select pg_temp._as('47000000-0000-0000-0000-0000000000a2');
select set_config('tst.h1', pg_temp._send('47000000-0000-0000-0000-000000002001', '47000000-0000-0000-0000-000000002002', '47000000-0000-0000-0000-000000001004', 2)::text, false);
reset role;
select pg_temp._as('47000000-0000-0000-0000-0000000000a3');
select lives_ok($$ select pg_temp._recv(pg_temp._tr('h1'), 2, 2) $$, 'the transfer is received without its proof under may_follow');
select is((select status from stock_transfers where id = pg_temp._tr('h1')), 'Closed', 'the stock arrived');

-- the sender of the transfer keeps the destination, so the receive stage admits them; what stops them
-- from confirming is the sender-is-not-the-receiver rule on the values the row would store
reset role;
select pg_temp._as('47000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.record_stock_handover(pg_temp._tr('h1'), pg_temp._conf(pg_temp._tr('h1'), 'in_app', 'account')) $$, 'P0001',
  'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it', 'the explicit account signer is refused');
select throws_ok($$ select public.record_stock_handover(pg_temp._tr('h1'), pg_temp._conf(pg_temp._tr('h1'), 'in_app', '')) $$, 'P0001',
  'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it', 'an empty signer kind stores as account, so it is refused like account');
select throws_ok($$ select public.record_stock_handover(pg_temp._tr('h1'), pg_temp._conf(pg_temp._tr('h1'), '', 'account')) $$, 'P0001',
  'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it', 'an empty proof type stores as in_app, so it is refused like in_app');
select throws_ok($$ select public.record_stock_handover(pg_temp._tr('h1'), pg_temp._conf(pg_temp._tr('h1'), '', '')) $$, 'P0001',
  'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it', 'both empty stores as account and in_app, so it is refused');
select is((select count(*)::int from stock_handover_confirmations where transfer_id = pg_temp._tr('h1')), 0,
  'none of the sender''s confirmations was stored');
reset role;

select pg_temp._as('47000000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.record_stock_handover(pg_temp._tr('h1'), pg_temp._conf(pg_temp._tr('h1'), 'in_app', 'account')) $$,
  'the destination keeper confirms afterwards: the rule stops only the sender');
select is((select proof_status from public.get_stock_movement_proof_status() where movement_id = pg_temp._tr('h1')), 'complete', 'the movement reads proof complete');
select is((select count(*)::int from stock_handover_confirmations where transfer_id = pg_temp._tr('h1') and recorded_by = '47000000-0000-0000-0000-0000000000a2'), 0,
  'and the stored confirmation is still not the sender''s');

select * from finish();
rollback;
