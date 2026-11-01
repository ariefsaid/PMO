begin;
create extension if not exists pgtap;
-- #1512 S6: reorder levels, suggestion and worklist (AC-STK-025, 026, 027, FR-STK-054). Plan S6.1; dates are relative to the org today.
select plan(25);

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

create function public.stk_t_today() returns date language sql as $$ select (now() at time zone 'Asia/Jakarta')::date $$;
create function public.stk_t_rcv_on(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric, p_ago int) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh,'occurred_on',(public.stk_t_today() - p_ago)::text),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.stk_t_issue_on(p_wh uuid, p_item uuid, p_qty numeric, p_ago int) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id',p_wh,'project_id','15120000-0000-0000-0000-0000000000c1','occurred_on',(public.stk_t_today() - p_ago)::text),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'boq_item_id','15120000-0000-0000-0000-0000000000e1')), true) $$;
create function public.stk_t_xfer_on(p_from uuid, p_to uuid, p_item uuid, p_qty numeric, p_ago int) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id',p_from,'to_warehouse_id',p_to,'occurred_on',(public.stk_t_today() - p_ago)::text),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty)), true) $$;
update public.stock_items set lead_time_days = 14 where id = '15120000-0000-0000-0000-000000001002';
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
-- (A) cable at CENTRAL: 6 issues of 30 over the last 90 days -> 2/day, lead 14, safety 7, cycle 30
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 400, 10, 91);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 85); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 70); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 55);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 40); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 25); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 30, 10);
-- (B) bags at CENTRAL: 78 over 60 days = 1.3/day, whole-number unit
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 100, 20, 60);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 26, 50); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 26, 30); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 26, 10);
-- (C) cable at SITE-B: 27 days of history, 3 issues -> too short
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 100, 10, 27);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 5, 20); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 5, 15); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 5, 5);
-- (D) cable at SITE-A: exactly 28 days of history and exactly 3 movements -> a figure
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 100, 10, 28);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 7, 20); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 7, 14); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 7, 7);
-- (E) bags at SITE-A: long history, only 2 movements
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 50, 20, 60);
select public.stk_t_issue_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 4, 30); select public.stk_t_issue_on('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 4, 10);
-- (F) bags at SITE-B: 5 transfers INTO the central warehouse are not usage
select public.stk_t_rcv_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001', 40, 20, 60);
select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 40); select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 30); select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 20);
select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 10); select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1, 5);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');                                                              -- U_PM
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002') #>> '{suggestion,reorder_level}', '42',  'AC-STK-025 level = ceil(2 x (14 + 7)) = 42');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002') #>> '{suggestion,reorder_quantity}', '60', 'AC-STK-025 quantity = ceil(2 x 30) = 60');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002') #>> '{inputs,usage}', '180', 'AC-STK-025 the inputs (usage 180 over the window) are returned beside the figures');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001') #>> '{suggestion,reorder_level}', '28', 'AC-STK-025 a whole-number unit rounds up: ceil(1.3 x 21 = 27.3) = 28');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001') #>> '{suggestion,reorder_quantity}', '39', 'AC-STK-025 and the quantity ceil(1.3 x 30) = 39');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002') ->> 'status', 'insufficient_history', 'AC-STK-026 27 days of history is not enough');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002') -> 'suggestion', 'null'::jsonb, 'AC-STK-026 and no figure is returned');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002') #>> '{suggestion,reorder_level}', '15.75', 'AC-STK-026 exactly 28 days and exactly 3 movements DO give a figure (0.75/day x 21)');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001') ->> 'status', 'insufficient_history', 'AC-STK-026 two usage movements are not enough');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001') ->> 'status', 'insufficient_history', 'AC-STK-026 transfers into a central warehouse are not usage');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 1, 8); select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 1, 4); select public.stk_t_xfer_on('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 1, 2);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select is(public.get_reorder_suggestions('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001001') ->> 'status', 'ok', 'AC-STK-026 three transfers to a SITE do count');
-- AC-STK-027: a suggestion changes nothing; accepting sets the level; one audit row records before / after
select is((select count(*)::int from public.stock_reorder_levels), 0, 'AC-STK-027 nobody accepted, so no level exists');
select lives_ok($$ select public.set_stock_reorder_level('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 42, 60) $$, 'AC-STK-027 an authorised user accepts');
select is((select reorder_level::text from public.stock_reorder_levels), '42.000', 'AC-STK-027 the level is set');
reset role;                                                                                         -- audit_events is not readable by a PM
select is((select count(*)::int from public.audit_events where action = 'stock.reorder_level.set'), 1, 'AC-STK-027 one audit row');
select is((select detail #>> '{after,reorder_level}' from public.audit_events where action = 'stock.reorder_level.set'), '42', 'AC-STK-027 the audit row carries the after value');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');                                                              -- U_ENG
select throws_ok($$ select public.set_stock_reorder_level('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 10, null) $$, '42501', null, 'PQ-6 an Engineer cannot set a reorder level');
reset role;
-- the "before" half: edit the level to 50
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select public.set_stock_reorder_level('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 50, 60);
reset role;
select is((select detail #>> '{before,reorder_level}' from public.audit_events where action = 'stock.reorder_level.set' and detail #>> '{after,reorder_level}' = '50'), '42', 'AC-STK-027 the audit row of an edit carries the before value');
-- FR-STK-054: the worklist (cable at CEN holds 220 on hand, level 50: not listed)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select public.set_stock_reorder_level('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001001', 1000, 40);
select ok(public.get_stock_below_reorder() @> '[{"item_code":"CEM","warehouse_code":"CEN","qty_on_hand":"27","reorder_level":"1000"}]'::jsonb, 'FR-STK-054 bags at CEN (27 on hand, level 1000) are on the worklist');
select ok(not (public.get_stock_below_reorder() @> '[{"item_code":"CAB","warehouse_code":"CEN"}]'::jsonb), 'FR-STK-054 cable at CEN (220 on hand, level 50) is not');
select public.set_stock_reorder_level('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 220, null);
select ok(public.get_stock_below_reorder() @> '[{"item_code":"CAB","warehouse_code":"CEN"}]'::jsonb, 'FR-STK-054 on hand equal to the level counts as at or below');
select throws_like($$ select public.set_stock_reorder_level('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', 1.2345, null) $$, 'STK_INVALID%', 'FR-STK-053 a level has 3 decimals at most');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');
select lives_ok($$ select public.get_stock_below_reorder() $$, 'FR-STK-054 any active member reads the worklist');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select public.set_stock_reorder_level('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000001002', null, null);
select is((select count(*)::int from public.stock_reorder_levels where item_id = '15120000-0000-0000-0000-000000001002'), 0, 'FR-STK-053 clearing removes the level');
reset role;
select is((select (detail -> 'after')::text from public.audit_events where action = 'stock.reorder_level.set' and detail #>> '{before,reorder_level}' = '220'), 'null', 'FR-STK-053 and the audit row records the clear');
select * from finish();
rollback;
