-- 2100_stock_handover_scope.test.sql — 1124d decision 1 (spec docs/specs/stock-handover-scope.spec.md). Migration under test: 2100.
-- AC-HSC-001 default scope · 002 Admin-only setter · 003 issue blocked before posting · 004 may_follow posts and lists it · 005 attach clears it · 006 transfers-only unaffected · 007 other org sees none.
-- Mutation checks: mut:scope_issue (003/006) · mut:issue_timing (004) · mut:scope_admin (002).
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


-- ── AC-HSC-001 default: scope is transfers, an issue posts with no document, nothing listed ─────
select is((select stock_handover_scope from organizations where id = '26940000-0000-0000-0000-00000000000a'), 'transfers', 'AC-HSC-001 a new organisation is transfers-only');
select tst_as('26940000-0000-0000-0000-0000000000a1');
select lives_ok($$ select create_stock_document(jsonb_build_object('kind','issue','warehouse_id','26940000-0000-0000-0000-000000002001','project_id','26940000-0000-0000-0000-0000000000c1'),
  jsonb_build_array(jsonb_build_object('item_id','26940000-0000-0000-0000-000000001001','quantity',1)), true) $$, 'AC-HSC-001 under the default an issue posts with no document, as today');
select is((select count(*)::int from get_stock_movement_proof_status()), 0, 'AC-HSC-001 and nothing is listed as owed');
-- ── AC-HSC-002 only an Admin changes it ───────────────────────────────────────────────────────
reset role;
select tst_as('26940000-0000-0000-0000-0000000000a2');
select throws_ok($$ select set_stock_handover_scope('transfers_and_issues') $$, '42501', 'STK_FORBIDDEN: only an Admin changes the handover scope', 'AC-HSC-002 a keeper cannot change the scope');
reset role;
select tst_as('26940000-0000-0000-0000-0000000000a1');
select throws_ok($$ select set_stock_handover_scope('everything') $$, 'P0001', 'STK_INVALID: the handover scope is transfers or transfers_and_issues', 'AC-HSC-002 an unknown value is refused');
select is(set_stock_handover_scope('transfers_and_issues'), 'transfers_and_issues', 'AC-HSC-002 an Admin extends the scope to issues');
select is((select count(*)::int from audit_events where action = 'stock.handover_scope'), 1, 'AC-HSC-002 the change is audited');
-- ── AC-HSC-003 before posting: the issue is refused without its document ──────────────────────
select throws_ok($$ select create_stock_document(jsonb_build_object('kind','issue','warehouse_id','26940000-0000-0000-0000-000000002001','project_id','26940000-0000-0000-0000-0000000000c1'),
  jsonb_build_array(jsonb_build_object('item_id','26940000-0000-0000-0000-000000001001','quantity',1)), true) $$, 'P0001', 'STK_PAPER_REQUIRED: attach the signed handover document before posting this issue', 'AC-HSC-003 before posting an issue needs its signed document');
select set_config('tst.i0', create_stock_document(jsonb_build_object('kind','issue','warehouse_id','26940000-0000-0000-0000-000000002001','project_id','26940000-0000-0000-0000-0000000000c1'),
  jsonb_build_array(jsonb_build_object('item_id','26940000-0000-0000-0000-000000001001','quantity',1)), false)::text, false);
reset role;
insert into storage.objects (bucket_id, name) values ('stock-documents', '26940000-0000-0000-0000-00000000000a/' || current_setting('tst.i0') || '/26940000-0000-0000-0000-000000004101/signed.pdf');
select tst_as('26940000-0000-0000-0000-0000000000a1');
select lives_ok($$ insert into stock_document_files (id, document_id, file_path) values ('26940000-0000-0000-0000-000000004101', tst_tr('i0'), '26940000-0000-0000-0000-00000000000a/' || current_setting('tst.i0') || '/26940000-0000-0000-0000-000000004101/signed.pdf') $$, 'AC-HSC-003 the document is attached to the draft');
select lives_ok($$ select post_stock_document(tst_tr('i0')) $$, 'AC-HSC-003 with the document attached the issue posts');
-- ── AC-HSC-006 transfers without a tag rule are unaffected ────────────────────────────────────
select lives_ok($$ select tst_xfer('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-000000001001', 2) $$, 'AC-HSC-006 a transfer of an item with no proof rule still posts');
reset role;
-- ── AC-HSC-004 may follow: posts, is listed as owed ───────────────────────────────────────────
update organizations set stock_proof_timing = 'may_follow' where id = '26940000-0000-0000-0000-00000000000a';
select tst_as('26940000-0000-0000-0000-0000000000a1');
select set_config('tst.i1', create_stock_document(jsonb_build_object('kind','issue','warehouse_id','26940000-0000-0000-0000-000000002001','project_id','26940000-0000-0000-0000-0000000000c1'),
  jsonb_build_array(jsonb_build_object('item_id','26940000-0000-0000-0000-000000001001','quantity',1)), true)::text, false);
select is((select proof_status || '/' || missing || '/' || to_warehouse_name from get_stock_movement_proof_status() where movement_id = tst_tr('i1')), 'outstanding/paper/TST Job One', 'AC-HSC-004 under may_follow the issue posts and is listed as proof owed, naming its project');
select is((select count(*)::int from get_stock_movement_proof_status() where movement_id = tst_tr('i0')), 1, 'AC-HSC-005 the issue posted with its document is listed, complete');
select is((select proof_status from get_stock_movement_proof_status() where movement_id = tst_tr('i0')), 'complete', 'AC-HSC-005 the attached document reads complete');
reset role;
-- ── AC-HSC-005 attaching clears it ────────────────────────────────────────────────────────────
insert into storage.objects (bucket_id, name) values ('stock-documents', '26940000-0000-0000-0000-00000000000a/' || current_setting('tst.i1') || '/26940000-0000-0000-0000-000000004102/signed.pdf');
select tst_as('26940000-0000-0000-0000-0000000000a1');
select lives_ok($$ insert into stock_document_files (id, document_id, file_path) values ('26940000-0000-0000-0000-000000004102', tst_tr('i1'), '26940000-0000-0000-0000-00000000000a/' || current_setting('tst.i1') || '/26940000-0000-0000-0000-000000004102/signed.pdf') $$, 'AC-HSC-005 the document is attached later');
select is((select proof_status from get_stock_movement_proof_status() where movement_id = tst_tr('i1')), 'complete', 'AC-HSC-005 the issue leaves the owed list');
reset role;
-- ── AC-HSC-007 isolation, and scope back to transfers hides issues ────────────────────────────
select tst_as('26940000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from get_stock_movement_proof_status()), 0, 'AC-HSC-007 another organisation sees none of these');
reset role;
update organizations set stock_handover_scope = 'transfers' where id = '26940000-0000-0000-0000-00000000000a';
select tst_as('26940000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from get_stock_movement_proof_status() where movement_id in (tst_tr('i0'), tst_tr('i1'))), 0, 'AC-HSC-001 with the scope back at transfers issues are not listed');
reset role;
select * from finish();
rollback;
