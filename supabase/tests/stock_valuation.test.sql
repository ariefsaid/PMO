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

select plan(18);
create function public.stk_t_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.stk_t_xfer(p_from uuid, p_to uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id',p_from,'to_warehouse_id',p_to),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty)), true) $$;
-- security definer: the ledger and balances have no client SELECT, and these helpers are called while the role is `authenticated`
create function public.stk_t_bal(p_wh uuid, p_item uuid) returns text language sql security definer as $$
  select qty_on_hand::text || '/' || value_on_hand::text from public.stock_balances where warehouse_id = p_wh and item_id = p_item $$;
create function public.stk_t_out(p_wh uuid, p_item uuid) returns text language sql security definer as $$
  select coalesce(sum(value_delta), 0)::text from public.stock_ledger where warehouse_id = p_wh and item_id = p_item and kind = 'transfer' and qty_delta < 0 $$;
create function public.stk_t_rows(p_where text) returns integer language plpgsql security definer as $$
declare n integer; begin execute 'select count(*) from public.stock_ledger where ' || p_where into n; return n; end $$;

select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');                                                                     -- Admin posts anywhere
-- AC-STK-002: 100 @ 50 then 100 @ 70 -> average 60; moving 50 out takes 3,000
select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 100, 50);
select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 100, 70);
select public.stk_t_xfer('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 50);
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002'), '150.000/9000.00', 'AC-STK-002 moving average: 50 out of 200 @ avg 60 leaves 150 worth 9,000');
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002'), '50.000/3000.00', 'AC-STK-002 the destination receives the same 3,000');
-- AC-STK-003: 3 bags worth 100.01 -> moving all 3 takes all 100.01, no residue
select public.stk_t_rcv('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 3, 33.3367);
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001'), '3.000/100.01', 'AC-STK-003 setup: 3 bags worth 100.01');
select public.stk_t_xfer('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 3);
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001'), '0.000/0.00', 'AC-STK-003 moving every bag leaves no value residue');
select is(public.stk_t_out('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001'), '-100.01', 'AC-STK-003 the out entry took the whole 100.01');
-- AC-STK-005: 5 on hand, 6 requested -> refused, nothing written
select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 2, 10);                                                          -- SITE-A now holds 5 bags (3 moved in + 2)
select throws_like($$ select public.stk_t_xfer('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001', 6) $$, 'STK_INSUFFICIENT: %available 5%requested 6%', 'AC-STK-005 an over-draw is refused with available 5 / requested 6');
select is(public.stk_t_rows('kind = ''transfer'' and qty_delta = -6'), 0, 'AC-STK-005 no ledger entry exists for the refused transfer');
-- AC-STK-006: 40 central -> site B is atomic; a forced failure on the second leg leaves neither leg
select public.stk_t_xfer('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 40);
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002') || ' ' || public.stk_t_bal('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002'), '110.000/6600.00 40.000/2400.00',
  'AC-STK-006 central fell by 40 and the site rose by 40 at equal value (60 each)');
-- AC-STK-003 (stepwise): three single-bag moves of 3 bags worth 100.01 leave no residue (33.34 + 33.34 + 33.33)
select public.stk_t_rcv('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001', 3, 33.3367);
select public.stk_t_xfer('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1); select public.stk_t_xfer('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1); select public.stk_t_xfer('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1);
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001'), '0.000/0.00', 'AC-STK-003 three single-bag moves leave the source at exactly zero value');
select is(public.stk_t_out('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001'), '-100.01', 'AC-STK-003 the three out entries add up to exactly the value received');
reset role;
create function public.stk_t_fail_second_leg() returns trigger language plpgsql as $$
begin if new.kind = 'transfer' and new.qty_delta > 0 then raise exception 'forced second-leg failure'; end if; return new; end $$;
create trigger stk_t_fail_second_leg before insert on public.stock_ledger for each row execute function public.stk_t_fail_second_leg();
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_like($$ select public.stk_t_xfer('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 10) $$, '%forced second-leg failure%', 'AC-STK-006 a failure on the second leg aborts the whole post');
reset role;
drop trigger stk_t_fail_second_leg on public.stock_ledger;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002') || ' ' || public.stk_t_bal('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002'), '110.000/6600.00 40.000/2400.00', 'AC-STK-006 neither leg was written (balances unchanged)');
reset role;
-- S2b: the Issue variants of AC-STK-002, 003 and 005 (0414).
create function public.stk_t_issue(p_wh uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id',p_wh,'project_id','15120000-0000-0000-0000-0000000000c1'),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'boq_item_id','15120000-0000-0000-0000-0000000000e1')), true) $$;
create function public.stk_t_iout(p_doc uuid) returns text language sql security definer as $$
  select sum(value_delta)::text from public.stock_ledger where document_id = p_doc $$;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select set_config('stk.i1', public.stk_t_issue('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 50)::text, false);
select is(public.stk_t_iout(current_setting('stk.i1')::uuid), '-3000.00', 'AC-STK-002 issuing 50 of 110 worth 6,600 (avg 60) takes 3,000');
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002'), '60.000/3600.00', 'AC-STK-002 the issue leaves 60 worth 3,600');
select set_config('stk.i2', public.stk_t_issue('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 3)::text, false);
select is(public.stk_t_iout(current_setting('stk.i2')::uuid), '-100.01', 'AC-STK-003 issuing every bag takes the whole 100.01');
select is(public.stk_t_bal('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001'), '0.000/0.00', 'AC-STK-003 the issue leaves no value residue');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');                                                                     -- U_K1 keeps SITE-A (5 bags)
select throws_like($$ select public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 6) $$, 'STK_INSUFFICIENT: %available 5%requested 6%', 'AC-STK-005 an over-drawing issue is refused with available 5 / requested 6');
select is(public.stk_t_rows('kind = ''issue'' and qty_delta = -6'), 0, 'AC-STK-005 no ledger entry exists for the refused issue');
reset role;
select * from finish();
rollback;
