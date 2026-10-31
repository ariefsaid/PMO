begin;
create extension if not exists pgtap;
-- #1512 S2b: the whole-sequence ledger-equals-balance invariant (AC-STK-004; S4 appends adjustment and count). Plan S2b.3.

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

select plan(6);
create function public.stk_t_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.stk_t_xfer(p_from uuid, p_to uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id',p_from,'to_warehouse_id',p_to),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty)), true) $$;
create function public.stk_t_issue(p_wh uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id',p_wh,'project_id','15120000-0000-0000-0000-0000000000c1'),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'boq_item_id','15120000-0000-0000-0000-0000000000e1')), true) $$;
create function public.stk_t_line(p_doc uuid) returns uuid language sql as $$
  select id from public.stock_document_lines where document_id = p_doc order by line_no limit 1 $$;
create function public.stk_t_return(p_wh uuid, p_src uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','return','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'source_line_id',p_src)), true) $$;

-- The mixed sequence (bags = whole units, cable = fractional).
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');                                   -- Admin
select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 100, 50);
select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 40, 55);
select public.stk_t_xfer('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 30);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');                                   -- U_K1 keeps SITE-A
select set_config('stk.iss', public.stk_t_line(public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 20))::text, false);
select throws_like($$ select public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 1000) $$,
  'STK_INSUFFICIENT%', 'AC-STK-004 setup: an over-draw in the middle of the sequence is refused');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a5');                                   -- U_K2 keeps SITE-B
select public.stk_t_return('15120000-0000-0000-0000-000000002003', current_setting('stk.iss')::uuid, '15120000-0000-0000-0000-000000001001', 5);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select public.stk_t_xfer('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001', 10);
select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 7.5, 12.3456);
select public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 7.5);
reset role;

select is((select count(*)::int from (
  select coalesce(s.item_id, b.item_id) i, coalesce(s.warehouse_id, b.warehouse_id) w
    from (select item_id, warehouse_id, sum(qty_delta) q, sum(value_delta) v from public.stock_ledger group by 1, 2) s
    full join public.stock_balances b on b.item_id = s.item_id and b.warehouse_id = s.warehouse_id
   where coalesce(s.q, 0) <> coalesce(b.qty_on_hand, 0) or coalesce(s.v, 0) <> coalesce(b.value_on_hand, 0)) bad), 0,
  'AC-STK-004 for every item and warehouse the ledger sums equal the balance row (quantity and value)');
select is((select count(*)::int from (
  select qty_after - sum(qty_delta) over (partition by item_id, warehouse_id order by seq) dq,
         value_after - sum(value_delta) over (partition by item_id, warehouse_id order by seq) dv from public.stock_ledger) x
  where dq <> 0 or dv <> 0), 0, 'AC-STK-004 every entry''s running balance equals the cumulative sum up to it');
select is((select count(*)::int from public.stock_balances where qty_on_hand < 0 or value_on_hand < 0), 0, 'AC-STK-004 no balance is negative');
select is((select count(*)::int from public.stock_ledger where qty_delta < 0 and value_delta > 0 or qty_delta > 0 and value_delta < 0), 0, 'AC-STK-004 quantity and value move the same way');
select is((select sum(value_delta)::text from public.stock_ledger where kind = 'transfer'), '0.00', 'FR-STK-032 transfers conserve value across the whole sequence');
select * from finish();
rollback;
