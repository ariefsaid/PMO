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

select plan(32);  -- S1: the four `is` counts, the foreign-warehouse refusal, the unchanged-row proof (6); S2a: 12; S2b: 4; S3: 4; S4: 2; S5: 4
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');   -- U_XORG sees none of org A
select is((select count(*)::int from stock_units),      0, 'AC-STK-019 stock_units: org B reads none of org A');
select is((select count(*)::int from stock_items),      0, 'AC-STK-019 stock_items: org B reads none of org A');
select is((select count(*)::int from stock_warehouses), 1, 'AC-STK-019 stock_warehouses: org B reads only its own');
select is((select count(*)::int from stock_warehouse_keepers), 0, 'AC-STK-019 stock_warehouse_keepers: org B reads none of org A');
select throws_ok($$ select set_stock_warehouse_keeper('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000b1', true) $$,
  'P0001', null, 'AC-STK-019 set_stock_warehouse_keeper refuses a foreign warehouse id');
update stock_items set name = 'hijack' where id = '15120000-0000-0000-0000-000000001001';      -- RLS hides the row: a silent no-op
reset role;
select is((select name from stock_items where id = '15120000-0000-0000-0000-000000001001'), 'Cement 50kg',
  'AC-STK-019 org B cannot update org A''s item (the row is unchanged)');
-- S2a: documents, lines, ledger, balances and the posting RPCs (0413).
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');   -- org A Admin: one posted receipt, one draft
select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002001'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',5,'unit_cost',10)), true);
select set_config('stk.adraft', public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002001'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',1,'unit_cost',10)))::text, false);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from stock_documents), 0, 'AC-STK-019 stock_documents: org B reads none of org A');
select is((select count(*)::int from stock_document_lines), 0, 'AC-STK-019 stock_document_lines: org B reads none of org A');
select throws_ok($$ select * from stock_ledger $$, '42501', null, 'AC-STK-019 stock_ledger has no client read grant');
select throws_ok($$ select * from stock_balances $$, '42501', null, 'AC-STK-019 stock_balances has no client read grant');
select throws_like($$ select create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002001'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',1,'unit_cost',1)), true) $$,
  'STK_NOT_FOUND%', 'AC-STK-019 create_stock_document refuses org A''s warehouse');
select throws_like($$ select create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002009'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',1,'unit_cost',1)), true) $$,
  'STK_NOT_FOUND%', 'AC-STK-019 create_stock_document refuses org A''s item on org B''s own warehouse');
select throws_like($$ select post_stock_document(current_setting('stk.adraft')::uuid) $$, 'STK_NOT_FOUND%', 'AC-STK-019 post_stock_document refuses org A''s draft');
select throws_like($$ select save_stock_draft(current_setting('stk.adraft')::uuid, jsonb_build_object('warehouse_id','15120000-0000-0000-0000-000000002009'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',1,'unit_cost',1))) $$, 'STK_NOT_FOUND%', 'AC-STK-019 save_stock_draft refuses org A''s draft');
select throws_like($$ select cancel_stock_document(current_setting('stk.adraft')::uuid) $$, 'STK_NOT_FOUND%', 'AC-STK-019 cancel_stock_document refuses org A''s draft');
reset role;
select is((select status from stock_documents where id = current_setting('stk.adraft')::uuid), 'Draft', 'AC-STK-019 org A''s draft is untouched');
-- A transfer from org B's own warehouse into org A's warehouse id is refused (the destination org check), and writes nothing.
insert into stock_units (id, org_id, code, name, whole_only) values
  ('15120000-0000-0000-0000-0000000000d9', '15120000-0000-0000-0000-000000000002', 'bag', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('15120000-0000-0000-0000-000000001019', '15120000-0000-0000-0000-000000000002', 'XCEM', 'X Cement', '15120000-0000-0000-0000-0000000000d9');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');
select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002009'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001019','quantity',5,'unit_cost',10)), true);
select throws_like($$ select create_stock_document(jsonb_build_object('kind','transfer','warehouse_id','15120000-0000-0000-0000-000000002009','to_warehouse_id','15120000-0000-0000-0000-000000002001'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001019','quantity',1)), true) $$,
  'STK_NOT_FOUND%', 'AC-STK-019 a transfer into org A''s warehouse is refused');
reset role;
select is((select count(*)::int from stock_balances where warehouse_id = '15120000-0000-0000-0000-000000002001' and org_id = '15120000-0000-0000-0000-000000000002'), 0,
  'AC-STK-019 no org B balance was opened on org A''s warehouse');
-- S2b: the out-flow RPC paths (0414). Org B (its item from the S2a block above) gets a project and work item; org A posts one issue.
insert into companies (id, org_id, name, type) values ('15120000-0000-0000-0000-0000000000f9', '15120000-0000-0000-0000-000000000002', 'X Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('15120000-0000-0000-0000-0000000000c9', '15120000-0000-0000-0000-000000000002', 'X Ongoing', 'Ongoing Project', 1, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f9');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15120000-0000-0000-0000-0000000000e9', '15120000-0000-0000-0000-000000000002', '15120000-0000-0000-0000-0000000000c9', 'X-1', 'x', 'm3', 1, 1);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select set_config('stk.aissdoc', create_stock_document(
  jsonb_build_object('kind','issue','warehouse_id','15120000-0000-0000-0000-000000002001','project_id','15120000-0000-0000-0000-0000000000c1'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',2,'boq_item_id','15120000-0000-0000-0000-0000000000e1')), true)::text, false);
reset role;
select set_config('stk.aiss', (select id from stock_document_lines where document_id = current_setting('stk.aissdoc')::uuid)::text, false);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');
select throws_like($$ select create_stock_document(jsonb_build_object('kind','issue','warehouse_id','15120000-0000-0000-0000-000000002009','project_id','15120000-0000-0000-0000-0000000000c1'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001019','quantity',1,'boq_item_id','15120000-0000-0000-0000-0000000000e1')), true) $$,
  'STK_NOT_FOUND%', 'AC-STK-019 an issue to org A''s project is refused');
select throws_like($$ select create_stock_document(jsonb_build_object('kind','issue','warehouse_id','15120000-0000-0000-0000-000000002009','project_id','15120000-0000-0000-0000-0000000000c9'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001019','quantity',1,'boq_item_id','15120000-0000-0000-0000-0000000000e1')), true) $$,
  'STK_BOQ_MISMATCH%', 'AC-STK-019 an issue citing org A''s work item is refused');
select throws_like($$ select create_stock_document(jsonb_build_object('kind','return','warehouse_id','15120000-0000-0000-0000-000000002009'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001019','quantity',1,'source_line_id',current_setting('stk.aiss'))), true) $$,
  'STK_BOQ_MISMATCH%', 'AC-STK-019 a return citing org A''s issue line is refused');
reset role;
select is((select count(*)::int from stock_ledger where org_id = '15120000-0000-0000-0000-000000000002' and kind in ('issue','return')), 0, 'AC-STK-019 org B wrote no issue or return entry');
-- S3: the read RPCs (0415) return only the caller's org.
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');
select is(jsonb_array_length(public.get_stock_on_hand()), 1, 'AC-STK-019 org B''s on-hand holds only its own single item');
select is(jsonb_path_exists(public.get_stock_on_hand(), '$[*] ? (@.item_code != "XCEM")'), false, 'AC-STK-019 org B''s on-hand carries no org A item');
select is(jsonb_path_exists(public.get_stock_ledger() -> 'rows', '$[*] ? (@.item_code != "XCEM")'), false, 'AC-STK-019 org B''s trace carries no org A entry');
select is(jsonb_array_length(public.get_stock_ledger(p_document_id => current_setting('stk.aissdoc')::uuid) -> 'rows'), 0, 'AC-STK-019 org B cannot trace org A''s document');
reset role;
-- S4: org B cannot post org A's Draft count (0416).
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select set_config('stk.acnt', public.create_stock_document(jsonb_build_object('kind','count','warehouse_id','15120000-0000-0000-0000-000000002003'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','counted_quantity',4,'unit_cost',10)))::text, false);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');
select throws_like($$ select public.post_stock_document(current_setting('stk.acnt')::uuid) $$, 'STK_NOT_FOUND%', 'AC-STK-019 org B posting org A''s Draft count is refused');
reset role;
select is((select status || '/' || count(e.id)::text from public.stock_documents d left join public.stock_ledger e on e.document_id = d.id
            where d.id = current_setting('stk.acnt')::uuid group by d.status), 'Draft/0', 'AC-STK-019 org A''s count stays a Draft with no entry');
-- S5: org B cannot read org A's consumption report or allowances, nor change an allowance (0417).
insert into public.boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity) values
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000001002', 100);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');
select throws_like($$ select public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_date - 60, current_date) $$,
  'STK_NOT_FOUND%', 'AC-STK-019 org B reading org A''s consumption report is refused');
select is((select count(*)::int from public.boq_material_allowances), 0, 'AC-STK-019 org B reads no org A allowance');
update public.boq_material_allowances set planned_quantity = 1;
delete from public.boq_material_allowances;
reset role;
select is((select planned_quantity::text from public.boq_material_allowances where boq_item_id = '15120000-0000-0000-0000-0000000000e1'), '100.000',
  'AC-STK-019 org B''s update and delete left org A''s allowance untouched');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.get_project_consumption('15120000-0000-0000-0000-0000000000c1', current_date - 60, current_date) $$, 'AC-STK-019 org A reads its own report');
reset role;
select * from finish();
rollback;
