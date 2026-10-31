begin;
create extension if not exists pgtap;

insert into organizations (id, name, default_currency, default_timezone) values
  ('15120000-0000-0000-0000-000000000001', 'STK Org',       'IDR', 'Asia/Jakarta'),
  ('15120000-0000-0000-0000-000000000002', 'STK Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15120000-0000-0000-0000-0000000000a1', 'stk-admin@example.com'),
  ('15120000-0000-0000-0000-0000000000a2', 'stk-fin@example.com'),
  ('15120000-0000-0000-0000-0000000000a3', 'stk-pm@example.com'),
  ('15120000-0000-0000-0000-0000000000a4', 'stk-keep1@example.com'),   -- Engineer, keeps site A
  ('15120000-0000-0000-0000-0000000000a5', 'stk-keep2@example.com'),   -- Engineer, keeps site B
  ('15120000-0000-0000-0000-0000000000a6', 'stk-eng@example.com'),     -- Engineer, keeps nothing
  ('15120000-0000-0000-0000-0000000000b1', 'stk-xorg@example.com');    -- other-org Admin
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15120000-0000-0000-0000-0000000000a1', '15120000-0000-0000-0000-000000000001', 'STK Admin', 'stk-admin@example.com', 'Admin', 'active'),
  ('15120000-0000-0000-0000-0000000000a2', '15120000-0000-0000-0000-000000000001', 'STK Fin',   'stk-fin@example.com',   'Finance', 'active'),
  ('15120000-0000-0000-0000-0000000000a3', '15120000-0000-0000-0000-000000000001', 'STK PM',    'stk-pm@example.com',    'Project Manager', 'active'),
  ('15120000-0000-0000-0000-0000000000a4', '15120000-0000-0000-0000-000000000001', 'STK Keep1', 'stk-keep1@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a5', '15120000-0000-0000-0000-000000000001', 'STK Keep2', 'stk-keep2@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a6', '15120000-0000-0000-0000-000000000001', 'STK Eng',   'stk-eng@example.com',   'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000b1', '15120000-0000-0000-0000-000000000002', 'STK XOrg',  'stk-xorg@example.com',  'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-000000000001', 'STK Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000000001', 'STK Ongoing',  'Ongoing Project', 1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3'),
  ('15120000-0000-0000-0000-0000000000c2', '15120000-0000-0000-0000-000000000001', 'STK On Hold',  'On Hold',         1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c1', 'W-1', 'Slab pour',   'm3', 50, 1000),
  ('15120000-0000-0000-0000-0000000000e2', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c2', 'W-2', 'Other pour',  'm3', 50, 1000);

-- S1 adds below (master data, as superuser so the fixture does not depend on the RLS under test):
insert into stock_units (id, org_id, code, name, whole_only) values
  ('15120000-0000-0000-0000-0000000000d1', '15120000-0000-0000-0000-000000000001', 'bag', 'Bag',   true),
  ('15120000-0000-0000-0000-0000000000d2', '15120000-0000-0000-0000-000000000001', 'm',   'Metre', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('15120000-0000-0000-0000-000000001001', '15120000-0000-0000-0000-000000000001', 'CEM', 'Cement 50kg', '15120000-0000-0000-0000-0000000000d1'),
  ('15120000-0000-0000-0000-000000001002', '15120000-0000-0000-0000-000000000001', 'CAB', 'Cable 4mm',   '15120000-0000-0000-0000-0000000000d2');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000000001', 'CEN',    'Central',  'central'),
  ('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000000001', 'SITE-A', 'Site A',   'site'),
  ('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000000001', 'SITE-B', 'Site B',   'site'),
  ('15120000-0000-0000-0000-000000002009', '15120000-0000-0000-0000-000000000002', 'XCEN',   'X Central','central');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000a4'),
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-0000000000a5');

create function public.stk_t_as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- usage: select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4'); ... reset role;

select plan(43);
create function public.stk_t_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.stk_t_xfer(p_from uuid, p_to uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id',p_from,'to_warehouse_id',p_to),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty)), true) $$;

-- AC-STK-013 (stock_posting_guards): keeper A cannot post on warehouse B, on either path; an Admin can, audited.
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');                            -- U_K1 keeps SITE-A only
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001', 5, 10) $$,
  'STK_NOT_KEEPER%', 'AC-STK-013 create-and-post on a warehouse you do not keep is refused');
reset role;  select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');                -- Admin drafts a receipt at SITE-B
select set_config('stk.draft', public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002003'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',5,'unit_cost',10)))::text, false);
reset role;  select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$ select public.post_stock_document(current_setting('stk.draft')::uuid) $$, 'STK_NOT_KEEPER%',
  'AC-STK-013 posting a draft on a warehouse you do not keep is refused');
reset role;  select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a5');                -- U_K2 keeps SITE-B
select lives_ok($$ select public.post_stock_document(current_setting('stk.draft')::uuid) $$, 'AC-STK-013 the keeper of SITE-B posts it');
reset role;  select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 1, 10) $$, 'AC-STK-013 an Admin may post on any warehouse');
reset role;
select is((select count(*)::int from audit_events where action = 'stock.admin_post' and org_id = '15120000-0000-0000-0000-000000000001'), 1, 'AC-STK-013 the Admin override is audited');
select is((select count(*)::int from audit_events where action = 'stock.admin_author' and org_id = '15120000-0000-0000-0000-000000000001'), 1, 'PQ-1 an Admin drafting on a warehouse they do not keep is audited');

-- AC-STK-016: a whole-number item refuses a fraction; a metre item takes it
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 1.5, 10) $$, 'STK_FRACTION%', 'AC-STK-016 a fractional quantity of a whole-number item is refused');
select lives_ok($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 1.5, 10) $$, 'AC-STK-016 the same fraction of a metre item posts');
-- AC-STK-017: archive is refused while stock is on hand, allowed with none, and archived rows leave pickers but not history
select throws_like($$ update public.stock_items set archived_at = now() where id = '15120000-0000-0000-0000-000000001002' $$, 'STK_HAS_STOCK%', 'AC-STK-017 an item with stock on hand cannot be archived');
select throws_like($$ update public.stock_warehouses set archived_at = now() where id = '15120000-0000-0000-0000-000000002002' $$, 'STK_HAS_STOCK%', 'AC-STK-017 a warehouse holding stock cannot be archived');
insert into public.stock_items (id, code, name, unit_id) values ('15120000-0000-0000-0000-000000001009', 'TMP', 'Never used', '15120000-0000-0000-0000-0000000000d2');
insert into public.stock_warehouses (id, code, name, kind) values ('15120000-0000-0000-0000-000000002008', 'W-TMP', 'Temporary', 'site');
select public.stk_t_rcv('15120000-0000-0000-0000-000000002008', '15120000-0000-0000-0000-000000001002', 1, 10);
select public.stk_t_xfer('15120000-0000-0000-0000-000000002008', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 1);                       -- the warehouse is empty again
select lives_ok($$ update public.stock_items set archived_at = now() where id = '15120000-0000-0000-0000-000000001009' $$, 'AC-STK-017 an item with no stock archives');
select lives_ok($$ update public.stock_warehouses set archived_at = now() where id = '15120000-0000-0000-0000-000000002008' $$, 'AC-STK-017 an emptied warehouse archives');
select is((select count(*)::int from public.stock_items where archived_at is null and id = '15120000-0000-0000-0000-000000001009'), 0, 'AC-STK-017 the archived item is absent from the active picker query');
select ok((select count(*) from public.stock_documents where warehouse_id = '15120000-0000-0000-0000-000000002008') >= 2, 'AC-STK-017 its history (documents) is still there');
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002008', '15120000-0000-0000-0000-000000001002', 1, 10) $$, 'STK_ARCHIVED%', 'AC-STK-017 an archived warehouse takes no new line');
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001009', 1, 10) $$, 'STK_ARCHIVED%', 'AC-STK-017 an archived item takes no new line');
-- AC-STK-021 (ledger part): a stale or future date is refused for non-Admins; the Admin may go back but never forward; no earlier value changes
reset role;
select set_config('stk.agg', (select string_agg(value_after::text, ',' order by seq) from public.stock_ledger), false);
select set_config('stk.maxseq', (select max(seq)::text from public.stock_ledger), false);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','occurred_on',((now() at time zone 'Asia/Jakarta')::date - 40)::text),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'STK_BACKDATE%', 'AC-STK-021 a keeper cannot date a movement 40 days back');
select throws_like($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','occurred_on',((now() at time zone 'Asia/Jakarta')::date + 1)::text),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'STK_BACKDATE%', 'AC-STK-021 a keeper cannot date a movement in the future');
reset role; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','occurred_on',((now() at time zone 'Asia/Jakarta')::date - 40)::text),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'AC-STK-021 an Admin may date a movement 40 days back');
select throws_like($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','occurred_on',((now() at time zone 'Asia/Jakarta')::date + 1)::text),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'STK_BACKDATE%', 'AC-STK-021 but not into the future (PQ-2)');
reset role;
select is((select string_agg(value_after::text, ',' order by seq) from public.stock_ledger where seq <= current_setting('stk.maxseq')::bigint), current_setting('stk.agg'),
  'AC-STK-021 the backdated post changed no earlier ledger value');
-- AC-STK-029: a receipt may cite a procurement case of its org, and never changes it
insert into public.procurements (id, org_id, title, status, requested_by_id) values
  ('15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-000000000001', 'STK case', 'Draft', '15120000-0000-0000-0000-0000000000a3'),
  ('15120000-0000-0000-0000-0000000000f2', '15120000-0000-0000-0000-000000000002', 'STK other-org case', 'Draft', '15120000-0000-0000-0000-0000000000b1');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','procurement_id','15120000-0000-0000-0000-0000000000f1'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'AC-STK-029 a receipt citing a case of its own org posts');
select throws_like($$ select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002','procurement_id','15120000-0000-0000-0000-0000000000f2'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)), true) $$, 'STK_NOT_FOUND%', 'AC-STK-029 citing another org''s case is refused');
reset role;
select is((select status::text from public.procurements where id = '15120000-0000-0000-0000-0000000000f1'), 'Draft', 'AC-STK-029 the case''s status is unchanged');
select is((select count(*)::int from public.procurement_receipts where procurement_id = '15120000-0000-0000-0000-0000000000f1'), 0, 'AC-STK-029 and no procurement receipt record was created');
-- AC-STK-010 (Transfer): a client cost on a non-cost line is ignored; the ledger value is the server's
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 5, 10);                                   -- central holds cable at 10
select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id','15120000-0000-0000-0000-000000002001','to_warehouse_id','15120000-0000-0000-0000-000000002002'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',999)), true);
reset role;
select is((select count(*)::int from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id where d.kind = 'transfer' and l.unit_cost is not null), 0,
  'AC-STK-010 a client cost on a transfer line is not stored');
select is((select max(abs(value_delta))::text from public.stock_ledger l join public.stock_documents d on d.id = l.document_id
            where d.kind = 'transfer' and l.qty_delta = -1 and l.item_id = '15120000-0000-0000-0000-000000001002' and l.warehouse_id = '15120000-0000-0000-0000-000000002001'), '10.00', 'AC-STK-010 the ledger value is the moving average, not 999');
-- FR-STK-060 / 010 / 011 supporting assertions
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_ok($$ insert into public.stock_balances (org_id, item_id, warehouse_id, qty_on_hand) values ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000001002', '15120000-0000-0000-0000-000000002003', 5) $$, '42501', null, 'FR-STK-060 even an Admin cannot write balances directly');
select throws_ok($$ insert into public.stock_documents (org_id, number, kind, warehouse_id, occurred_on, created_by) values ('15120000-0000-0000-0000-000000000001', 'X', 'receive', '15120000-0000-0000-0000-000000002002', current_date, '15120000-0000-0000-0000-0000000000a1') $$, '42501', null, 'FR-STK-060 nor documents');
select matches((select number from public.stock_documents where kind = 'receive' order by created_at limit 1), '^RCV-[0-9]{10}$', 'FR-STK-010 a document number is minted with the kind prefix');
select set_config('stk.dr', public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002'), jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',2,'unit_cost',10)))::text, false);
select lives_ok($$ select public.save_stock_draft(current_setting('stk.dr')::uuid, jsonb_build_object('warehouse_id','15120000-0000-0000-0000-000000002002','note','edited'), jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',3,'unit_cost',10))) $$, 'FR-STK-011 the author edits a Draft');
reset role; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.save_stock_draft(current_setting('stk.dr')::uuid, jsonb_build_object('warehouse_id','15120000-0000-0000-0000-000000002002'), jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10))) $$, '42501', null, 'FR-STK-011 another user cannot edit it');
select throws_ok($$ select public.cancel_stock_document(current_setting('stk.dr')::uuid) $$, '42501', null, 'FR-STK-011 a non-author non-Admin cannot cancel it');
select set_config('stk.kdr', public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002002'), jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',10)))::text, false);
reset role; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.cancel_stock_document(current_setting('stk.dr')::uuid) $$, 'FR-STK-011 the author cancels the Draft');
select lives_ok($$ select public.cancel_stock_document(current_setting('stk.kdr')::uuid) $$, 'FR-STK-011 an Admin cancels another user''s Draft');
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 1, 10000000000) $$, 'STK_INVALID%', 'NFR-STK precision: a unit cost beyond the column is refused with a stock code');
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 100000000, 99999) $$, 'STK_INVALID%', 'NFR-STK precision: a line value beyond the column is refused with a stock code');
reset role;

-- S2b: AC-STK-010 Issue and Return variants (0414). Central cable is at average 10 here.
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select set_config('stk.ci', public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id','15120000-0000-0000-0000-000000002001','project_id','15120000-0000-0000-0000-0000000000c1'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',2,'unit_cost',999,'boq_item_id','15120000-0000-0000-0000-0000000000e1')), true)::text, false);
select set_config('stk.cr', public.create_stock_document(jsonb_build_object('kind','return','warehouse_id','15120000-0000-0000-0000-000000002001'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',999,
    'source_line_id',(select id from public.stock_document_lines where document_id = current_setting('stk.ci')::uuid))), true)::text, false);
reset role;
select is((select count(*)::int from public.stock_document_lines where document_id in (current_setting('stk.ci')::uuid, current_setting('stk.cr')::uuid) and unit_cost is not null), 0,
  'AC-STK-010 a client cost on an issue or return line is not stored');
select is((select value_delta::text from public.stock_ledger where document_id = current_setting('stk.ci')::uuid), '-20.00', 'AC-STK-010 the issue is valued at the moving average (2 x 10), not 999');
select is((select value_delta::text from public.stock_ledger where document_id = current_setting('stk.cr')::uuid), '10.00', 'AC-STK-010 the return re-enters at the issue''s cost (1 x 10), not 999');
-- AC-STK-018: an externally-owned inventory domain refuses every post and writes nothing; reads still work.
insert into external_domain_ownership (org_id, external_tier, domain) values ('15120000-0000-0000-0000-000000000001', 'odoo', 'inventory');
select set_config('stk.adocs', (select count(*) from stock_documents where org_id = '15120000-0000-0000-0000-000000000001')::text, false);
select set_config('stk.docs', (select count(*) from stock_documents)::text || '/' || (select count(*) from stock_ledger)::text, false);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_like($$ select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 10) $$,
  'STK_OWNED_BY_ERP%', 'AC-STK-018 posting while the domain is ERP-owned is refused');
reset role;
select is((select count(*) from stock_documents)::text || '/' || (select count(*) from stock_ledger)::text, current_setting('stk.docs'),
  'AC-STK-018 nothing was written (no document row, no ledger entry)');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select is((select count(*) from stock_documents)::text, current_setting('stk.adocs'), 'AC-STK-018 reads still return every document while ERP-owned');
reset role;
select * from finish();
rollback;
