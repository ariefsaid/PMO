-- 1309_stock_movement_proof_status.test.sql — #2690 (spec docs/specs/stock-two-step-transfer.spec.md). Migration under test: 1309 (with 1305, 1308).
-- AC-TST-020 get_stock_movement_proof_status · 030 one-step transfer under may_follow (paper may follow) · 021 reorder clause.
-- Mutation checks: mut:timing_block (030: a one-step post stays blocked under may_follow, so AC-TST-030 goes red) · mut:paper (existing 1030 case stays red-able).
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values
  ('26940000-0000-0000-0000-00000000000a', 'TST Org', 'IDR', 'UTC'),
  ('26940000-0000-0000-0000-00000000000b', 'TST Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26940000-0000-0000-0000-0000000000a1', 'tst-admin@example.com'),
  ('26940000-0000-0000-0000-0000000000a2', 'tst-src@example.com'),
  ('26940000-0000-0000-0000-0000000000a3', 'tst-dst@example.com'),
  ('26940000-0000-0000-0000-0000000000a4', 'tst-plain@example.com'),
  ('26940000-0000-0000-0000-0000000000b1', 'tst-other-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26940000-0000-0000-0000-0000000000a1', '26940000-0000-0000-0000-00000000000a', 'TST Admin', 'tst-admin@example.com', 'Admin', 'active'),
  ('26940000-0000-0000-0000-0000000000a2', '26940000-0000-0000-0000-00000000000a', 'TST Source Keeper', 'tst-src@example.com', 'Engineer', 'active'),
  ('26940000-0000-0000-0000-0000000000a3', '26940000-0000-0000-0000-00000000000a', 'TST Dest Keeper', 'tst-dst@example.com', 'Engineer', 'active'),
  ('26940000-0000-0000-0000-0000000000a4', '26940000-0000-0000-0000-00000000000a', 'TST Plain Member', 'tst-plain@example.com', 'Engineer', 'active'),
  ('26940000-0000-0000-0000-0000000000b1', '26940000-0000-0000-0000-00000000000b', 'TST Other Admin', 'tst-other-admin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('26940000-0000-0000-0000-0000000000f1', '26940000-0000-0000-0000-00000000000a', 'TST Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('26940000-0000-0000-0000-0000000000c1', '26940000-0000-0000-0000-00000000000a', 'TST Job One', 'Ongoing Project', 1000000, 'exclusive', 0, '26940000-0000-0000-0000-0000000000f1', '26940000-0000-0000-0000-0000000000a1'),
  ('26940000-0000-0000-0000-0000000000c2', '26940000-0000-0000-0000-00000000000a', 'TST Job Two', 'Ongoing Project', 1000000, 'exclusive', 0, '26940000-0000-0000-0000-0000000000f1', '26940000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26940000-0000-0000-0000-000000000401', '26940000-0000-0000-0000-00000000000a', '26940000-0000-0000-0000-0000000000c1', 'TST WO one', 'Issued', 10000, 'exclusive', 0),
  ('26940000-0000-0000-0000-000000000403', '26940000-0000-0000-0000-00000000000a', '26940000-0000-0000-0000-0000000000c2', 'TST WO other job', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26940000-0000-0000-0000-0000000000d1', '26940000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_tags (id, org_id, name, zero_cost, paper_required) values
  ('26940000-0000-0000-0000-000000003001', '26940000-0000-0000-0000-00000000000a', 'Client supplied', true, false),
  ('26940000-0000-0000-0000-000000003002', '26940000-0000-0000-0000-00000000000a', 'Plain tag', false, false);
insert into stock_items (id, org_id, code, name, unit_id, tag_id, needs_quality_check) values
  ('26940000-0000-0000-0000-000000001001', '26940000-0000-0000-0000-00000000000a', 'PIPE', 'Pipe', '26940000-0000-0000-0000-0000000000d1', null, false),
  ('26940000-0000-0000-0000-000000001002', '26940000-0000-0000-0000-00000000000a', 'FREE', 'Free issue valve', '26940000-0000-0000-0000-0000000000d1', '26940000-0000-0000-0000-000000003001', false),
  ('26940000-0000-0000-0000-000000001003', '26940000-0000-0000-0000-00000000000a', 'QC', 'Checked valve', '26940000-0000-0000-0000-0000000000d1', null, true),
  ('26940000-0000-0000-0000-000000001004', '26940000-0000-0000-0000-00000000000a', 'CONF', 'Confirmed item', '26940000-0000-0000-0000-0000000000d1', '26940000-0000-0000-0000-000000003002', false);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-00000000000a', 'CEN',   'Central', 'central', null),
  ('26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26940000-0000-0000-0000-0000000000c1'),
  ('26940000-0000-0000-0000-000000002003', '26940000-0000-0000-0000-00000000000a', 'YARD1', 'Yard one', 'yard', '26940000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('26940000-0000-0000-0000-00000000000a', '26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-0000000000a2'),
  ('26940000-0000-0000-0000-00000000000a', '26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-0000000000a3');

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

insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values ('26940000-0000-0000-0000-00000000000a', '26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-0000000000a2');
create function public.tst_tr(p_n text) returns uuid language sql as $$ select current_setting('tst.' || p_n)::uuid $$;
update stock_tags set proof_required = 'paper' where id = '26940000-0000-0000-0000-000000003001';
select tst_as('26940000-0000-0000-0000-0000000000a1');
select tst_rcv('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000001002', 40, 0);
select tst_rcv('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000001001', 40, 4);
select tst_rcv('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000001004', 40, 3);
reset role;

-- ── AC-TST-030 one-step: blocking before_posting (today), may follow under may_follow ───────────
select tst_as('26940000-0000-0000-0000-0000000000a1');
select throws_ok($$ select tst_xfer('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-000000001002', 5) $$, 'P0001', 'STK_PAPER_REQUIRED: attach the delivery paper before posting this client-supplied transfer', 'AC-TST-030 before_posting: the post is refused without its paper, exactly as today');
reset role;
update organizations set stock_proof_timing = 'may_follow' where id = '26940000-0000-0000-0000-00000000000a';
select tst_as('26940000-0000-0000-0000-0000000000a1');
select set_config('tst.d1', '00000000-0000-0000-0000-000000000000', false);      -- a failed post must fail AC-TST-030 by name, not abort the file
select lives_ok($$ select set_config('tst.d1', tst_xfer('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-000000001002', 5)::text, false) $$, 'AC-TST-030 may_follow: the one-step transfer of a paper-rule item posts without its paper');
select is(tst_bal('26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-000000001002'), '5.000/0.00', 'AC-TST-030 may_follow: the transfer posts without its paper');
select tst_xfer('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-000000001001', 5);
select is((select proof_status || '/' || missing || '/' || mode || '/' || required_proof from get_stock_movement_proof_status() where movement_id = tst_tr('d1')),
  'outstanding/paper/one_step/paper', 'AC-TST-020 it reads proof outstanding: paper missing');
select is((select count(*)::int from get_stock_movement_proof_status()), 1, 'AC-TST-020 a transfer whose items need no proof is not listed');
select is((select movement_date from get_stock_movement_proof_status() where movement_id = tst_tr('d1')), current_date, 'AC-TST-020 the movement date is returned');
select is((select from_warehouse_name || '>' || to_warehouse_name from get_stock_movement_proof_status() where movement_id = tst_tr('d1')), 'Central>Site one', 'AC-TST-020 the locations are returned by name');
reset role;
insert into storage.objects (bucket_id, name) values ('stock-documents', '26940000-0000-0000-0000-00000000000a/' || current_setting('tst.d1') || '/26940000-0000-0000-0000-000000004001/slip.pdf');
select tst_as('26940000-0000-0000-0000-0000000000a1');
select lives_ok($$ insert into stock_document_files (id, document_id, file_path) values ('26940000-0000-0000-0000-000000004001', tst_tr('d1'), '26940000-0000-0000-0000-00000000000a/' || current_setting('tst.d1') || '/26940000-0000-0000-0000-000000004001/slip.pdf') $$, 'AC-TST-030 the paper is attached after posting');
select is((select proof_status || '/' || has_paper::text || '/' || (proof_completed_at is not null)::text from get_stock_movement_proof_status() where movement_id = tst_tr('d1')), 'complete/true/true', 'AC-TST-030 it now reads proof complete, with the time it completed');
select lives_ok($$ select archive_stock_document_file('26940000-0000-0000-0000-000000004001', 'scanned the wrong page') $$, 'AC-TST-020 the paper is archived');
select is((select proof_status from get_stock_movement_proof_status() where movement_id = tst_tr('d1')), 'outstanding', 'AC-TST-020 an archived paper makes the movement outstanding again');
select is((select count(*)::int from get_stock_movement_proof_status('complete')), 0, 'AC-TST-020 the complete filter lists none');
select is((select count(*)::int from get_stock_movement_proof_status('outstanding')), 1, 'AC-TST-020 the outstanding filter lists it');
select is((select count(*)::int from get_stock_movement_proof_status(null, current_date + 1, null)), 0, 'AC-TST-020 the from-date filter applies');
select is((select count(*)::int from get_stock_movement_proof_status(null, null, current_date - 1)), 0, 'AC-TST-020 the to-date filter applies');
select throws_ok($$ select * from get_stock_movement_proof_status('maybe') $$, 'P0001', 'STK_INVALID: the proof status is outstanding or complete', 'AC-TST-020 an unknown status filter is refused');
reset role;

-- ── AC-TST-020 two-step rows, a rule changed after the fact, and isolation ─────────────────────
update organizations set stock_transfer_mode = 'two_step' where id = '26940000-0000-0000-0000-00000000000a';
update stock_tags set proof_required = 'confirmation' where id = '26940000-0000-0000-0000-000000003002';
select tst_as('26940000-0000-0000-0000-0000000000a2');
select set_config('tst.s1', tst_send('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-000000001004', 3)::text, false);
select set_config('tst.s2', public.send_stock_transfer(jsonb_build_object('warehouse_id', '26940000-0000-0000-0000-000000002001', 'to_warehouse_id', '26940000-0000-0000-0000-000000002002'),
  jsonb_build_array(jsonb_build_object('item_id', '26940000-0000-0000-0000-000000001002', 'quantity', 1), jsonb_build_object('item_id', '26940000-0000-0000-0000-000000001004', 'quantity', 1)))::text, false);
reset role;
select tst_as('26940000-0000-0000-0000-0000000000a1');
select is((select proof_status || '/' || mode || '/' || transfer_status || '/' || missing from get_stock_movement_proof_status() where movement_id = tst_tr('s1')),
  'outstanding/two_step/Sent/confirmation', 'AC-TST-020 a Sent two-step transfer with an unmet rule is outstanding');
select is((select required_proof || '/' || missing from get_stock_movement_proof_status() where movement_id = tst_tr('s2')), 'mixed/paper,confirmation', 'AC-TST-020 two tag rules read mixed, naming both missing proofs');
select is((select count(*)::int from get_stock_movement_proof_status() where mode = 'one_step'), 1, 'AC-TST-020 the earlier one-step movement is still listed');
reset role;
select tst_as('26940000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from get_stock_movement_proof_status()), 0, 'AC-TST-020 another organisation sees none of these movements');
reset role;

-- ── AC-TST-021 the reorder read answers with transit legs in the ledger ─────────────────────────
select tst_as('26940000-0000-0000-0000-0000000000a1');
select lives_ok($$ select get_reorder_suggestions('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000001002') $$, 'AC-TST-021 get_reorder_suggestions still reads with transit legs present');
reset role;
select * from finish();
rollback;
