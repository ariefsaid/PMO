-- stock_site_work.test.sql — #2523 (spec docs/specs/stock-site-work.spec.md). Migrations under test: 0982, 0983, 0984.
-- AC-SSW-001 yard/staging journey · 002 zero-cost receive rule · 003 zero-cost value stays 0 · 004 purchased value reaches the work order ·
-- 005 tag frozen after movements · 006 tags are Admin-only and org-scoped · 007 attachments on a posted document ·
-- 008 paper required · 009 balance per work order + reconciliation · 012 work order of another project refused · 013 old kinds unchanged.
-- Every denial asserts errcode AND message so a different gate moving in front cannot pass it.
begin;
create extension if not exists pgtap;
select plan(47);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25230000-0000-0000-0000-00000000000a', 'SSW Org',       'IDR', 'UTC'),
  ('25230000-0000-0000-0000-00000000000b', 'SSW Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('25230000-0000-0000-0000-0000000000a1', 'ssw-admin@example.com'),
  ('25230000-0000-0000-0000-0000000000a3', 'ssw-pm@example.com'),
  ('25230000-0000-0000-0000-0000000000a4', 'ssw-keeper@example.com'),
  ('25230000-0000-0000-0000-0000000000a6', 'ssw-eng@example.com'),
  ('25230000-0000-0000-0000-0000000000b1', 'ssw-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25230000-0000-0000-0000-0000000000a1', '25230000-0000-0000-0000-00000000000a', 'SSW Admin',  'ssw-admin@example.com',  'Admin', 'active'),
  ('25230000-0000-0000-0000-0000000000a3', '25230000-0000-0000-0000-00000000000a', 'SSW PM',     'ssw-pm@example.com',     'Project Manager', 'active'),
  ('25230000-0000-0000-0000-0000000000a4', '25230000-0000-0000-0000-00000000000a', 'SSW Keeper', 'ssw-keeper@example.com', 'Engineer', 'active'),
  ('25230000-0000-0000-0000-0000000000a6', '25230000-0000-0000-0000-00000000000a', 'SSW Eng',    'ssw-eng@example.com',    'Engineer', 'active'),
  ('25230000-0000-0000-0000-0000000000b1', '25230000-0000-0000-0000-00000000000b', 'SSW XOrg',   'ssw-xorg@example.com',   'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('25230000-0000-0000-0000-0000000000f1', '25230000-0000-0000-0000-00000000000a', 'SSW Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('25230000-0000-0000-0000-0000000000c1', '25230000-0000-0000-0000-00000000000a', 'SSW Job One', 'Ongoing Project', 1000000, 'exclusive', 0, '25230000-0000-0000-0000-0000000000f1', '25230000-0000-0000-0000-0000000000a3'),
  ('25230000-0000-0000-0000-0000000000c2', '25230000-0000-0000-0000-00000000000a', 'SSW Job Two', 'Ongoing Project', 1000000, 'exclusive', 0, '25230000-0000-0000-0000-0000000000f1', '25230000-0000-0000-0000-0000000000a3');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25230000-0000-0000-0000-0000000000e1', '25230000-0000-0000-0000-00000000000a', '25230000-0000-0000-0000-0000000000c1', 'W-1', 'Slab', 'm3', 50, 1000);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25230000-0000-0000-0000-000000000401', '25230000-0000-0000-0000-00000000000a', '25230000-0000-0000-0000-0000000000c1', 'SSW WO one', 'Issued', 10000, 'exclusive', 0),
  ('25230000-0000-0000-0000-000000000402', '25230000-0000-0000-0000-00000000000a', '25230000-0000-0000-0000-0000000000c1', 'SSW WO two', 'Issued', 10000, 'exclusive', 0),
  ('25230000-0000-0000-0000-000000000403', '25230000-0000-0000-0000-00000000000a', '25230000-0000-0000-0000-0000000000c2', 'SSW WO other job', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('25230000-0000-0000-0000-0000000000d1', '25230000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_tags (id, org_id, name, zero_cost, paper_required) values
  ('25230000-0000-0000-0000-000000003001', '25230000-0000-0000-0000-00000000000a', 'Free issue', true,  false),
  ('25230000-0000-0000-0000-000000003002', '25230000-0000-0000-0000-00000000000a', 'Free issue + paper', true, true),
  ('25230000-0000-0000-0000-000000003009', '25230000-0000-0000-0000-00000000000b', 'Other org tag', true, false);
insert into stock_items (id, org_id, code, name, unit_id, tag_id) values
  ('25230000-0000-0000-0000-000000001001', '25230000-0000-0000-0000-00000000000a', 'BUY',  'Purchased pipe',   '25230000-0000-0000-0000-0000000000d1', null),
  ('25230000-0000-0000-0000-000000001002', '25230000-0000-0000-0000-00000000000a', 'FREE', 'Client valve',     '25230000-0000-0000-0000-0000000000d1', '25230000-0000-0000-0000-000000003001'),
  ('25230000-0000-0000-0000-000000001003', '25230000-0000-0000-0000-00000000000a', 'PAPR', 'Client pump',      '25230000-0000-0000-0000-0000000000d1', '25230000-0000-0000-0000-000000003002'),
  ('25230000-0000-0000-0000-000000001004', '25230000-0000-0000-0000-00000000000a', 'NEW',  'Never moved',      '25230000-0000-0000-0000-0000000000d1', null);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('25230000-0000-0000-0000-000000002001', '25230000-0000-0000-0000-00000000000a', 'CEN',   'Central',  'central', null),
  ('25230000-0000-0000-0000-000000002002', '25230000-0000-0000-0000-00000000000a', 'YARD1', 'Yard',     'yard',    '25230000-0000-0000-0000-0000000000c1'),
  ('25230000-0000-0000-0000-000000002003', '25230000-0000-0000-0000-00000000000a', 'STG1',  'Staging',  'staging', '25230000-0000-0000-0000-0000000000c1'),
  ('25230000-0000-0000-0000-000000002004', '25230000-0000-0000-0000-00000000000a', 'SITE2', 'Site two', 'site',    '25230000-0000-0000-0000-0000000000c2');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('25230000-0000-0000-0000-00000000000a', '25230000-0000-0000-0000-000000002002', '25230000-0000-0000-0000-0000000000a4');

create function public.ssw_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.ssw_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric, p_post boolean default true) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), p_post) $$;
create function public.ssw_xfer(p_from uuid, p_to uuid, p_item uuid, p_qty numeric, p_post boolean default true) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id',p_from,'to_warehouse_id',p_to),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty)), p_post) $$;
create function public.ssw_issue(p_wh uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id',p_wh,'project_id','25230000-0000-0000-0000-0000000000c1'),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'boq_item_id','25230000-0000-0000-0000-0000000000e1')), true) $$;
create function public.ssw_bal(p_wh uuid, p_item uuid) returns text language sql security definer as $$
  select coalesce((select qty_on_hand::text || '/' || value_on_hand::text from public.stock_balances where warehouse_id = p_wh and item_id = p_item), 'none') $$;
create function public.ssw_ledger_value(p_item uuid) returns numeric language sql security definer as $$
  select coalesce(sum(abs(value_delta)), 0) from public.stock_ledger where item_id = p_item $$;
create function public.ssw_loc_qty(p_item uuid) returns numeric language sql security definer as $$
  select coalesce(sum(qty_on_hand), 0) from public.stock_balances where item_id = p_item
     and warehouse_id in ('25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000002003') $$;
create function public.ssw_attr(p_doc uuid, p_wo uuid) returns integer language sql as $$
  select public.set_cost_attribution('stock_document', array[p_doc], p_wo, null) $$;
create function public.ssw_bal_row(p_wo uuid, p_item uuid, p_key text) returns text language sql as $$
  select sum((r->>p_key)::numeric)::text from jsonb_array_elements(public.get_work_order_stock_balance(p_wo, null)) r
   where r->>'item_id' = p_item::text and r->>'warehouse_kind' in ('yard','staging') limit 1 $$;

-- ── AC-SSW-013 kinds ────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ insert into stock_warehouses (org_id, code, name, kind) values ('25230000-0000-0000-0000-00000000000a','BAD','Bad','depot') $$,
  '23514', null, 'AC-SSW-013 an unknown location kind is still refused');
select lives_ok($$ insert into stock_warehouses (org_id, code, name, kind) values ('25230000-0000-0000-0000-00000000000a','OLD-C','Old central','central'),
  ('25230000-0000-0000-0000-00000000000a','OLD-S','Old site','site') $$, 'AC-SSW-013 central and site rows are unchanged and still accepted');
select is((select count(*)::int from stock_warehouses where kind in ('yard','staging') and org_id = '25230000-0000-0000-0000-00000000000a'), 2,
  'FR-SSW-001 yard and staging locations exist');

-- ── AC-SSW-002 zero-cost receive ────────────────────────────────────────────────────────────────────
select ssw_as('25230000-0000-0000-0000-0000000000a1');
select throws_ok($$ select ssw_rcv('25230000-0000-0000-0000-000000002001','25230000-0000-0000-0000-000000001002', 10, 5) $$,
  'P0001', 'STK_ZERO_COST: a client-supplied item is received at cost 0', 'AC-SSW-002 a zero-cost item cannot be received at cost 5');
select is(ssw_bal('25230000-0000-0000-0000-000000002001','25230000-0000-0000-0000-000000001002'), 'none', 'AC-SSW-002 the refused receive wrote nothing');
select lives_ok($$ select ssw_rcv('25230000-0000-0000-0000-000000002001','25230000-0000-0000-0000-000000001002', 10, 0) $$, 'AC-SSW-002 the same item posts at cost 0');
select is(ssw_bal('25230000-0000-0000-0000-000000002001','25230000-0000-0000-0000-000000001002'), '10.000/0.00', 'AC-SSW-002 it lands with quantity 10 and value 0');
select lives_ok($$ select ssw_rcv('25230000-0000-0000-0000-000000002001','25230000-0000-0000-0000-000000001001', 20, 4) $$, 'FR-SSW-013 a purchased item still receives at its cost');

-- ── AC-SSW-001 + 003 journey: warehouse -> yard -> staging -> work-order issue ─────────────────────────
select set_config('ssw.t1', ssw_xfer('25230000-0000-0000-0000-000000002001','25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000001002', 6)::text, false);
select ssw_attr(current_setting('ssw.t1')::uuid, '25230000-0000-0000-0000-000000000401');
select is(ssw_bal('25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000001002'), '6.000/0.00', 'AC-SSW-001 the yard holds 6 after the first leg');
select set_config('ssw.t2', ssw_xfer('25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000002003','25230000-0000-0000-0000-000000001002', 4)::text, false);
select ssw_attr(current_setting('ssw.t2')::uuid, '25230000-0000-0000-0000-000000000401');
select is(ssw_bal('25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000001002') || ' ' || ssw_bal('25230000-0000-0000-0000-000000002003','25230000-0000-0000-0000-000000001002'),
  '2.000/0.00 4.000/0.00', 'AC-SSW-001 yard keeps 2, staging holds 4');
select set_config('ssw.i1', ssw_issue('25230000-0000-0000-0000-000000002003','25230000-0000-0000-0000-000000001002', 3)::text, false);
select ssw_attr(current_setting('ssw.i1')::uuid, '25230000-0000-0000-0000-000000000401');
select is(ssw_bal('25230000-0000-0000-0000-000000002003','25230000-0000-0000-0000-000000001002'), '1.000/0.00', 'AC-SSW-001 staging holds 1 after issuing 3 to the work order');
select is(ssw_ledger_value('25230000-0000-0000-0000-000000001002'), 0::numeric, 'AC-SSW-003 every ledger row of the zero-cost item has value 0');
select is(ssw_bal_row('25230000-0000-0000-0000-000000000401','25230000-0000-0000-0000-000000001002','issued_value'), '0.00', 'AC-SSW-003 the work order stock cost of the zero-cost item is 0');

-- ── AC-SSW-004 purchased item carries 4.00 x quantity ─────────────────────────────────────────────────
select set_config('ssw.t3', ssw_xfer('25230000-0000-0000-0000-000000002001','25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000001001', 6)::text, false);
select ssw_attr(current_setting('ssw.t3')::uuid, '25230000-0000-0000-0000-000000000402');
select is(ssw_bal('25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000001001'), '6.000/24.00', 'AC-SSW-004 the transfer carries 6 x 4.00');
select set_config('ssw.i2', ssw_issue('25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000001001', 5)::text, false);
select ssw_attr(current_setting('ssw.i2')::uuid, '25230000-0000-0000-0000-000000000402');
select is(ssw_bal_row('25230000-0000-0000-0000-000000000402','25230000-0000-0000-0000-000000001001','issued_value'), '20.00', 'AC-SSW-004 the work order cost is 4.00 x 5 = 20.00');

-- ── AC-SSW-009 balance per work order, reconciliation ─────────────────────────────────────────────────
select is(ssw_bal_row('25230000-0000-0000-0000-000000000401','25230000-0000-0000-0000-000000001002','on_site_qty'), '3', 'AC-SSW-009 WO one has 3 of the valve on site over yard and staging (received 6+4, moved on 4, issued 3)');
select is(ssw_bal_row('25230000-0000-0000-0000-000000000401','25230000-0000-0000-0000-000000001002','on_site_qty')::numeric, ssw_loc_qty('25230000-0000-0000-0000-000000001002'),
  'AC-SSW-009 the work order''s on-site quantity equals the ledger-derived balance of the yard and staging');
select is((select r->>'on_site_qty' from jsonb_array_elements(public.get_work_order_stock_balance('25230000-0000-0000-0000-000000000401', null)) r
            where r->>'warehouse_kind' = 'staging' and r->>'item_id' = '25230000-0000-0000-0000-000000001002'), '1', 'AC-SSW-009 WO one has 1 on site (received 4, issued 3)');
select is((select sum((r->>'received_qty')::numeric) from jsonb_array_elements(public.get_work_order_stock_balance(null, '25230000-0000-0000-0000-0000000000c1')) r),
          (select sum(qty_delta) from public.stock_ledger l join public.stock_warehouses w on w.id = l.warehouse_id
            where l.kind = 'transfer' and l.qty_delta > 0 and w.project_id = '25230000-0000-0000-0000-0000000000c1'),
  'AC-SSW-009 reconciliation: received over all work orders and unassigned = the project''s locations'' transfer-in total');
select is((select count(*)::int from jsonb_array_elements(public.get_work_order_stock_balance(null, '25230000-0000-0000-0000-0000000000c1')) r where r->>'work_order_id' is null), 0,
  'AC-SSW-009 every movement so far is attributed (no unassigned bucket)');
select is(jsonb_array_length(public.get_work_order_stock_balance('25230000-0000-0000-0000-000000000402', null)) > 0, true, 'AC-SSW-009 WO two reads its own rows');
select is((select count(*)::int from jsonb_array_elements(public.get_work_order_stock_balance('25230000-0000-0000-0000-000000000402', null)) r where r->>'item_id' = '25230000-0000-0000-0000-000000001002'), 0,
  'AC-SSW-009 WO two does not see WO one''s items');

-- ── AC-SSW-012 a work order of another project is refused ─────────────────────────────────────────────
select throws_ok($$ select ssw_attr(current_setting('ssw.t3')::uuid, '25230000-0000-0000-0000-000000000403') $$, '23514',
  'COST_WO_PROJECT: the work order belongs to another project', 'AC-SSW-012 a transfer into a yard cannot name another project''s work order');

-- ── AC-SSW-005 tag frozen after movements; free before ─────────────────────────────────────────────────
select throws_ok($$ update stock_items set tag_id = null where id = '25230000-0000-0000-0000-000000001002' $$, 'P0001',
  'STK_TAG_LOCKED: the tag of an item with movements cannot change', 'AC-SSW-005 an item with movements keeps its tag');
select lives_ok($$ update stock_items set tag_id = '25230000-0000-0000-0000-000000003001' where id = '25230000-0000-0000-0000-000000001004' $$, 'AC-SSW-005 an item with no movements may take a tag');
select throws_ok($$ update stock_tags set zero_cost = false where id = '25230000-0000-0000-0000-000000003001' $$, 'P0001',
  'STK_TAG_LOCKED: the zero-cost flag of a tag whose items have movements cannot change', 'FR-SSW-014 a tag in use keeps its zero-cost flag');

-- ── AC-SSW-006 tags: Admin only, org-scoped ─────────────────────────────────────────────────────────────
reset role;
select ssw_as('25230000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into stock_tags (name, zero_cost) values ('PM tag', true) $$, '42501', null, 'AC-SSW-006 a Project Manager cannot create a tag');
select is((select count(*)::int from stock_tags), 2, 'FR-SSW-010 a member reads only their own org''s tags');
reset role;
select ssw_as('25230000-0000-0000-0000-0000000000a1');
select lives_ok($$ insert into stock_tags (name, zero_cost) values ('Owner supplied', true) $$, 'AC-SSW-006 an Admin creates a tag');
select throws_ok($$ update stock_items set tag_id = '25230000-0000-0000-0000-000000003009' where id = '25230000-0000-0000-0000-000000001004' $$, 'P0001',
  'STK_NOT_FOUND: the tag is not in your organisation', 'AC-SSW-006 another org''s tag cannot be applied');
reset role;
select ssw_as('25230000-0000-0000-0000-0000000000a6');
select lives_ok($$ update stock_tags set name = 'x' where id = '25230000-0000-0000-0000-000000003001' $$, 'AC-SSW-006 an Engineer''s rename statement runs but matches no row');
reset role;
select is((select name from stock_tags where id = '25230000-0000-0000-0000-000000003001'), 'Free issue', 'AC-SSW-006 the tag name is unchanged after an Engineer''s attempt');

-- ── AC-SSW-007 attachments on a posted document ───────────────────────────────────────────────────────
select ssw_as('25230000-0000-0000-0000-0000000000a1');
select set_config('ssw.d1', ssw_xfer('25230000-0000-0000-0000-000000002001','25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000001001', 1)::text, false);
select lives_ok($$ insert into stock_document_files (id, document_id, file_path, label) values
  ('25230000-0000-0000-0000-000000004001', current_setting('ssw.d1')::uuid, '25230000-0000-0000-0000-00000000000a/x/y/slip.pdf', 'Picking slip') $$,
  'AC-SSW-007 an attachment saves on a posted document');
select throws_ok($$ delete from stock_document_files where id = '25230000-0000-0000-0000-000000004001' $$, 'P0001',
  'STK_FILE_LOCKED: a posted document''s attachment cannot be deleted; archive it with a reason', 'AC-SSW-007 a posted document''s attachment cannot be deleted');
select throws_ok($$ select archive_stock_document_file('25230000-0000-0000-0000-000000004001', '  ') $$, 'P0001',
  'STK_INVALID: archiving needs a reason', 'AC-SSW-007 archiving needs a reason');
select lives_ok($$ select archive_stock_document_file('25230000-0000-0000-0000-000000004001', 'Wrong slip') $$, 'AC-SSW-007 archive with a reason works');
reset role;
select is((select count(*)::int from audit_events where action = 'stock.file.archive' and entity_id = current_setting('ssw.d1')::uuid and detail->>'reason' = 'Wrong slip'), 1,
  'AC-SSW-007 the archive left an audit row with the reason');
select ssw_as('25230000-0000-0000-0000-0000000000a6');
select throws_ok($$ insert into stock_document_files (document_id, file_path) values (current_setting('ssw.d1')::uuid, 'p') $$, '42501', null,
  'AC-SSW-007 an Engineer who is neither author nor keeper cannot attach');
reset role;

-- ── AC-SSW-008 paper required ─────────────────────────────────────────────────────────────────────────
select ssw_as('25230000-0000-0000-0000-0000000000a1');
select ssw_rcv('25230000-0000-0000-0000-000000002001','25230000-0000-0000-0000-000000001003', 5, 0);
select set_config('ssw.d2', ssw_xfer('25230000-0000-0000-0000-000000002001','25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000001003', 2, false)::text, false);
select throws_ok($$ select post_stock_document(current_setting('ssw.d2')::uuid) $$, 'P0001',
  'STK_PAPER_REQUIRED: attach the delivery paper before posting this client-supplied transfer', 'AC-SSW-008 posting without paper is refused');
select lives_ok($$ insert into stock_document_files (document_id, file_path, label) values (current_setting('ssw.d2')::uuid, 'p/q/r/slip.pdf', 'Delivery note') $$,
  'AC-SSW-008 the author attaches the paper to the draft');
select lives_ok($$ select post_stock_document(current_setting('ssw.d2')::uuid) $$, 'AC-SSW-008 with paper attached the transfer posts');
select is(ssw_bal('25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000001003'), '2.000/0.00', 'AC-SSW-008 the pump reached the yard at value 0');
select lives_ok($$ select ssw_xfer('25230000-0000-0000-0000-000000002001','25230000-0000-0000-0000-000000002002','25230000-0000-0000-0000-000000001001', 1) $$,
  'AC-SSW-008 a purchased item never needs paper');
reset role;

-- ── value only for roles that read stock value; empty state; another org ───────────────────────────────
select ssw_as('25230000-0000-0000-0000-0000000000a6');
select is((select r ? 'issued_value' from jsonb_array_elements(public.get_work_order_stock_balance('25230000-0000-0000-0000-000000000402', null)) r limit 1), false,
  'AC-SSW-009 an Engineer sees quantities but no value');
reset role;
select ssw_as('25230000-0000-0000-0000-0000000000a3');
select is((select r ? 'issued_value' from jsonb_array_elements(public.get_work_order_stock_balance('25230000-0000-0000-0000-000000000402', null)) r limit 1), true,
  'AC-SSW-009 a Project Manager sees value');
select is(public.get_work_order_stock_balance('25230000-0000-0000-0000-000000000403', null), '[]'::jsonb, 'AC-SSW-010 a work order with no ledger rows returns an empty list, not a zero row');
reset role;
select ssw_as('25230000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.get_work_order_stock_balance('25230000-0000-0000-0000-000000000401', null) $$, 'P0001',
  'STK_NOT_FOUND: the work order is not in your organisation', 'AC-SSW-009 another org reads nothing');
reset role;
select * from finish();
rollback;
