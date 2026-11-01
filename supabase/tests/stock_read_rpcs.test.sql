begin;
create extension if not exists pgtap;
-- #1512 S3: read RPCs (AC-STK-020, 028). Plan docs/plans/2026-10-31-inventory-project-consumption.md (S3.1).

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

create function public.stk_t_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;

select plan(13);

-- setup as Admin: receive 100 cable @ 50 at CEN, transfer 30 to SITE-A, receive 10 bags @ 20 at SITE-A
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 100, 50);
select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id','15120000-0000-0000-0000-000000002001','to_warehouse_id','15120000-0000-0000-0000-000000002002'),
  jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',30)), true);
select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 10, 20);
reset role;
select set_config('stk.rcvdoc', (select id::text from stock_documents where kind = 'receive' and org_id = '15120000-0000-0000-0000-000000000001' order by number limit 1), false);

-- AC-STK-020: below Project Manager, quantities only; PM and above also see cost
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');                                    -- U_ENG (rank 10)
select is((public.get_stock_on_hand() -> 0) ? 'qty_on_hand', true, 'AC-STK-020 an Engineer sees quantities on hand');
select is(jsonb_path_exists(public.get_stock_on_hand(), '$[*] ? (exists(@.value_on_hand) || exists(@.avg_cost))'), false,
  'AC-STK-020 an Engineer''s on-hand response carries no value or average-cost key');
select is(jsonb_path_exists(public.get_stock_ledger(p_limit => 50) -> 'rows', '$[*] ? (exists(@.value_delta) || exists(@.value_after))'), false,
  'AC-STK-020 an Engineer''s trace carries no value key');
select throws_ok($$ select * from public.stock_ledger $$, '42501', null, 'AC-STK-020 the ledger is not directly readable');
select throws_ok($$ select unit_cost from public.stock_document_lines $$, '42501', null, 'AC-STK-020 line unit cost is not directly readable');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');                                    -- U_PM (rank 20)
select is(jsonb_path_exists(public.get_stock_on_hand(), '$[*] ? (exists(@.value_on_hand) && exists(@.avg_cost))'), true, 'AC-STK-020 a Project Manager also sees value and average cost');
select is(jsonb_path_exists(public.get_stock_ledger(p_limit => 50) -> 'rows', '$[*] ? (exists(@.value_delta) && exists(@.value_after))'), true, 'AC-STK-020 a Project Manager''s trace carries value');
-- FR-STK-040 / 041 filters
select is(jsonb_array_length(public.get_stock_on_hand(p_warehouse_id => '15120000-0000-0000-0000-000000002002')), 2, 'FR-STK-040 on hand filters by warehouse (SITE-A holds cable and bags)');
select is(jsonb_array_length(public.get_stock_ledger(p_document_id => current_setting('stk.rcvdoc')::uuid) -> 'rows'), 1, 'FR-STK-041 the trace filters by document');
-- AC-STK-028: more than 1000 ledger rows for one project page out exactly once with a correct running balance
reset role;
insert into public.stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, boq_item_id, kind, qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by)
select e.org_id, e.document_id, e.line_id, e.item_id, e.warehouse_id, '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-0000000000e1', 'issue',
       -0.001, -0.00, 1000 - g * 0.001, 0, current_date, e.posted_by
  from (select * from public.stock_ledger where org_id = '15120000-0000-0000-0000-000000000001' order by seq limit 1) e, generate_series(1, 1200) g;     -- direct insert: a test fixture, not a writer under test
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
do $$
declare v_page jsonb; v_cursor bigint := null; v_all jsonb := '[]'::jsonb;
begin
  loop
    v_page := public.get_stock_ledger(p_project_id => '15120000-0000-0000-0000-0000000000c1', p_before_seq => v_cursor, p_limit => 200);
    v_all := v_all || (v_page->'rows');
    v_cursor := (v_page->>'next_before_seq')::bigint;
    exit when v_cursor is null;
  end loop;
  perform set_config('stk.all', v_all::text, false);           -- carried out of the role switch as a GUC; no temp table needed
end $$;
reset role;
select is((select jsonb_array_length(current_setting('stk.all')::jsonb)), 1200, 'AC-STK-028 all 1,200 rows came back');
select is((select count(distinct r->>'seq')::int from jsonb_array_elements(current_setting('stk.all')::jsonb) r), 1200,
  'AC-STK-028 every row appears exactly once (no gap, no repeat at a page boundary)');
select is((select count(*)::int from jsonb_array_elements(current_setting('stk.all')::jsonb) r
            join public.stock_ledger l on l.seq = (r->>'seq')::bigint
           where trim_scale(l.qty_after)::text <> r->>'qty_after'), 0,
  'AC-STK-028 each row''s running balance is the stored balance after it');
-- the report refuses (never truncates) past 5,000 rows
insert into public.stock_items (org_id, code, name, unit_id)
select '15120000-0000-0000-0000-000000000001', 'BULK' || g, 'Bulk ' || g, '15120000-0000-0000-0000-0000000000d1' from generate_series(1, 5001) g;
insert into public.stock_balances (org_id, item_id, warehouse_id, qty_on_hand, value_on_hand)
select '15120000-0000-0000-0000-000000000001', i.id, '15120000-0000-0000-0000-000000002001', 1, 1 from public.stock_items i where i.code like 'BULK%';
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select throws_like($$ select public.get_stock_on_hand() $$, 'STK_TOO_MANY%', 'AC-STK-020 on hand refuses past 5,000 rows instead of truncating');
reset role;
select * from finish();
rollback;
