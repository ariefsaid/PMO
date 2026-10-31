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

select plan(17);
create function public.stk_t_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;

-- AC-STK-011: a Posted document, its lines and the ledger never change, for anyone.
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');                                     -- Admin posts a receive (doc D, line L)
select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 10, 5);
select throws_ok($$ update public.stock_document_lines set quantity = 1 $$, '42501', null, 'AC-STK-011 even an Admin has no grant to update a line');
reset role;
select throws_like($$ update public.stock_document_lines set quantity = 1 where document_id = (select id from stock_documents limit 1) $$,
  'STK_IMMUTABLE%', 'AC-STK-011 the trigger refuses a line update even with table-owner rights');
select throws_like($$ delete from public.stock_document_lines where document_id = (select id from stock_documents limit 1) $$, 'STK_IMMUTABLE%', 'AC-STK-011 a posted line cannot be deleted');
select throws_like($$ update public.stock_documents set note = 'x' where status = 'Posted' $$, 'STK_IMMUTABLE%', 'AC-STK-011 a posted header cannot be edited');
select throws_like($$ update public.stock_ledger set value_delta = 0 $$, 'STK_IMMUTABLE%', 'AC-STK-011 a ledger row cannot be updated');
select throws_like($$ delete from public.stock_ledger $$, 'STK_IMMUTABLE%', 'AC-STK-011 a ledger row cannot be deleted');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_like($$ select public.cancel_stock_document((select id from stock_documents where status = 'Posted' limit 1)) $$,
  'STK_IMMUTABLE%', 'AC-STK-011 a posted document cannot be cancelled, by an Admin either');
select set_config('stk.cx', public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002001'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',1,'unit_cost',5)))::text, false);
select public.cancel_stock_document(current_setting('stk.cx')::uuid);
select throws_like($$ select public.post_stock_document(current_setting('stk.cx')::uuid) $$, 'STK_IMMUTABLE%', 'AC-STK-011 a cancelled document cannot be posted');
-- AC-STK-012: same client_request_id twice -> one document, one set of ledger entries, the second call returns the first.
select is(public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002001'),
            jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',4,'unit_cost',7)), true, '15120000-0000-0000-0000-0000000f0001'),
          public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002001'),
            jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',4,'unit_cost',7)), true, '15120000-0000-0000-0000-0000000f0001'),
          'AC-STK-012 the replay returns the first document');
reset role;
select is((select count(*)::int from stock_documents where client_request_id = '15120000-0000-0000-0000-0000000f0001'), 1, 'AC-STK-012 one document exists');
select is((select count(*)::int from stock_ledger where document_id = (select id from stock_documents where client_request_id = '15120000-0000-0000-0000-0000000f0001')), 1,
  'AC-STK-012 one ledger entry exists');
-- ADR-0097 §1: append-only for every role, the service key included; only the posting RPCs write.
select throws_like($$ truncate public.stock_ledger cascade $$, 'STK_IMMUTABLE%', 'AC-STK-011 the ledger cannot be truncated even with table-owner rights');
set local role service_role;
select throws_ok($$ truncate public.stock_ledger cascade $$, '42501', null, 'AC-STK-011 the service role cannot truncate the ledger');
select throws_ok($$ update public.stock_balances set value_on_hand = value_on_hand + 1 $$, '42501', null, 'FR-STK-031 the service role cannot shift a balance directly');
select throws_ok($$ insert into public.stock_ledger (org_id) values ('15120000-0000-0000-0000-000000000001') $$, '42501', null, 'FR-STK-072 the service role cannot insert a ledger row directly');
select throws_ok($$ delete from public.stock_documents $$, '42501', null, 'FR-STK-060 the service role cannot delete documents directly');
select throws_ok($$ select public.stock_post_core('15120000-0000-0000-0000-000000000000') $$, '42501', null, 'FR-STK-072 the service role cannot call the posting internals');
reset role;
select * from finish();
rollback;
