-- 1315_stock_reservations.test.sql — #2693 (spec docs/specs/stock-reservations.spec.md). Migrations under test: 1315, 1316, 1317.
-- AC-RSV-001 reserve, free and reserved, ledger untouched · 002 not beyond free, top-up · 003 on hand below reserved · 004 refused locations, work orders, items, quantities ·
-- 005 who may reserve · 006 expiry, close, partial release · 007 off by default, Admin-only audited setting · 015 tenancy and no client writes.
-- Mutation checks (break the marked line, the named cases must go red, restore): mut:rsv_exceeds_free (1316: the 7-of-6 and top-up refusals) ·
-- mut:rsv_perm (1316: the outsider case) · mut:rsv_off (1316: the RSV_OFF case) · mut:rsv_org (1317: remove ALL org filters of the read, the res, pairs, fig and final-join ones; the two-organisation cases go red. Each layer alone is redundant by design) · mut:rsv_overdraw (1315: the table check, see 1318 test).
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values ('26930000-0000-0000-0000-00000000000a', 'RSV Org', 'IDR', 'UTC'), ('26930000-0000-0000-0000-00000000000b', 'RSV Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values ('26930000-0000-0000-0000-0000000000a1', 'rsv-admin@example.com'), ('26930000-0000-0000-0000-0000000000a2', 'rsv-keeper@example.com'), ('26930000-0000-0000-0000-0000000000a3', 'rsv-pm@example.com'),
  ('26930000-0000-0000-0000-0000000000a4', 'rsv-out@example.com'), ('26930000-0000-0000-0000-0000000000b1', 'rsv-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26930000-0000-0000-0000-0000000000a1', '26930000-0000-0000-0000-00000000000a', 'RSV Admin', 'rsv-admin@example.com', 'Admin', 'active'),
  ('26930000-0000-0000-0000-0000000000a2', '26930000-0000-0000-0000-00000000000a', 'RSV Keeper', 'rsv-keeper@example.com', 'Engineer', 'active'),
  ('26930000-0000-0000-0000-0000000000a3', '26930000-0000-0000-0000-00000000000a', 'RSV Planner', 'rsv-pm@example.com', 'Project Manager', 'active'),
  ('26930000-0000-0000-0000-0000000000a4', '26930000-0000-0000-0000-00000000000a', 'RSV Outsider', 'rsv-out@example.com', 'Engineer', 'active'),
  ('26930000-0000-0000-0000-0000000000b1', '26930000-0000-0000-0000-00000000000b', 'RSV Other Admin', 'rsv-xadmin@example.com', 'Admin', 'active');
create function public.rsv_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26930000-0000-0000-0000-0000000000c1', '26930000-0000-0000-0000-00000000000a', 'RSV Job', 'Ongoing Project', '26930000-0000-0000-0000-0000000000a3'), ('26930000-0000-0000-0000-0000000000c2', '26930000-0000-0000-0000-00000000000b', 'RSV Other Job', 'Ongoing Project', '26930000-0000-0000-0000-0000000000b1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-00000000000a', '26930000-0000-0000-0000-0000000000c1', 'RSV WO A', 'Issued', 10000, 'exclusive', 0),
  ('26930000-0000-0000-0000-000000000402', '26930000-0000-0000-0000-00000000000a', '26930000-0000-0000-0000-0000000000c1', 'RSV WO B', 'Issued', 10000, 'exclusive', 0),
  ('26930000-0000-0000-0000-000000000403', '26930000-0000-0000-0000-00000000000a', '26930000-0000-0000-0000-0000000000c1', 'RSV WO cancelled', 'Cancelled', 10000, 'exclusive', 0),
  ('26930000-0000-0000-0000-000000000404', '26930000-0000-0000-0000-00000000000a', '26930000-0000-0000-0000-0000000000c1', 'RSV WO D', 'Issued', 10000, 'exclusive', 0),
  ('26930000-0000-0000-0000-000000000411', '26930000-0000-0000-0000-00000000000b', '26930000-0000-0000-0000-0000000000c2', 'RSV WO other org', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26930000-0000-0000-0000-0000000000d1', '26930000-0000-0000-0000-00000000000a', 'pc', 'Piece', false), ('26930000-0000-0000-0000-0000000000d2', '26930000-0000-0000-0000-00000000000a', 'bag', 'Bag', true), ('26930000-0000-0000-0000-0000000000d3', '26930000-0000-0000-0000-00000000000b', 'pc', 'Piece', false);
insert into stock_items (id, org_id, code, name, unit_id, archived_at) values
  ('26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-00000000000a', 'PIPE', 'Pipe', '26930000-0000-0000-0000-0000000000d1', null), ('26930000-0000-0000-0000-000000001002', '26930000-0000-0000-0000-00000000000a', 'BAG', 'Bag', '26930000-0000-0000-0000-0000000000d2', null),
  ('26930000-0000-0000-0000-000000001003', '26930000-0000-0000-0000-00000000000a', 'OLD', 'Old', '26930000-0000-0000-0000-0000000000d1', now()), ('26930000-0000-0000-0000-000000001011', '26930000-0000-0000-0000-00000000000b', 'XPIPE', 'Other pipe', '26930000-0000-0000-0000-0000000000d3', null);
insert into stock_warehouses (id, org_id, code, name, kind, project_id, archived_at) values
  ('26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-00000000000a', 'CEN', 'Central', 'central', null, null), ('26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26930000-0000-0000-0000-0000000000c1', null),
  ('26930000-0000-0000-0000-000000002003', '26930000-0000-0000-0000-00000000000a', 'VEND', 'Vendor', 'vendor', null, null), ('26930000-0000-0000-0000-000000002004', '26930000-0000-0000-0000-00000000000a', 'OLDSITE', 'Old site', 'site', '26930000-0000-0000-0000-0000000000c1', now());
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values ('26930000-0000-0000-0000-000000002011', '26930000-0000-0000-0000-00000000000b', 'XCEN', 'Other central', 'central', null);
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values ('26930000-0000-0000-0000-00000000000a', '26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-0000000000a2'), ('26930000-0000-0000-0000-00000000000a', '26930000-0000-0000-0000-000000002001', '26930000-0000-0000-0000-0000000000a2');
create function public.rsv_t_free(p_field text) returns text language sql as $$
  select r->>p_field from jsonb_array_elements(public.get_stock_free_reserved('26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001001')) r limit 1 $$;
create function public.rsv_t_n(p_sql text) returns bigint language plpgsql security definer as $$ declare n bigint; begin execute p_sql into n; return n; end $$;
create function public.rsv_t_ids() returns setof uuid language sql security definer as $$ select id from public.stock_reservations where org_id = '26930000-0000-0000-0000-00000000000a' $$;
create function public.rsv_t_res(p_wo uuid, p_q numeric default null) returns text language sql security definer as $$
  select quantity::text || '/' || consumed_qty::text || '/' || released_qty::text || '/' || status from public.stock_reservations where work_order_id = p_wo and item_id = '26930000-0000-0000-0000-000000001001' and (p_q is null or quantity = p_q) limit 1 $$;


-- off by default
select rsv_as('26930000-0000-0000-0000-0000000000a2');
select is((select stock_reservations from organizations where id = '26930000-0000-0000-0000-00000000000a'), false, 'AC-RSV-007 an existing organisation starts with reservations off');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 4) $$, 'P0001', 'RSV_OFF: reservations are not turned on for your organisation', 'AC-RSV-007 reserve refuses while off');
select is(public.get_stock_free_reserved(null, null), '[]'::jsonb, 'AC-RSV-007 the read returns nothing while off');
select throws_ok($$ select set_stock_reservations(true) $$, '42501', 'RSV_FORBIDDEN: only an Admin changes reservation settings', 'AC-RSV-007 a non-Admin cannot turn it on');
select rsv_as('26930000-0000-0000-0000-0000000000a1');
select throws_ok($$ select set_stock_reservations(true, 'approve', 'Finance', null) $$, 'P0001', 'RSV_INVALID: name both the borrowing approver role and its step label, or neither', 'AC-RSV-007 a role needs its label');
select is(set_stock_reservations(true), true, 'AC-RSV-007 an Admin turns it on');
select is(rsv_t_n($$ select count(*) from audit_events where action = 'stock.reservations' $$), 1::bigint, 'AC-RSV-007 the change is audited');
select is(set_stock_reservations(true), true, 'AC-RSV-007 the same value is a no-op');
select is(rsv_t_n($$ select count(*) from audit_events where action = 'stock.reservations' $$), 1::bigint, 'AC-RSV-007 and writes no second audit row');
select create_stock_document(jsonb_build_object('kind','receive','warehouse_id','26930000-0000-0000-0000-000000002002'), jsonb_build_array(jsonb_build_object('item_id','26930000-0000-0000-0000-000000001001','quantity',10,'unit_cost',5)), true);
select is(rsv_t_n($$ select count(*) from stock_ledger where item_id = '26930000-0000-0000-0000-000000001001' $$), 1::bigint, 'setup: one ledger row, 10 on hand');

-- AC-RSV-001
select rsv_as('26930000-0000-0000-0000-0000000000a2');
select lives_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 4, null, 'planned slab', '26930000-0000-0000-0000-00000000f001') $$, 'AC-RSV-001 the keeper reserves 4 for work order A');
select is(rsv_t_res('26930000-0000-0000-0000-000000000401'), '4.000/0.000/0.000/active', 'AC-RSV-001 one active reservation of 4');
select is(rsv_t_n($$ select count(*) from stock_reservation_events where action = 'reserve' $$), 1::bigint, 'AC-RSV-001 a reserve event is written');
select is(rsv_t_free('qty_on_hand'), '10', 'AC-RSV-001 on hand is still 10') ;
select is(rsv_t_free('reserved_qty'), '4', 'AC-RSV-001 reserved reads 4');
select is(rsv_t_free('free_qty'), '6', 'AC-RSV-001 free reads 6');
select is(rsv_t_n($$ select count(*) from stock_ledger where item_id = '26930000-0000-0000-0000-000000001001' $$), 1::bigint, 'AC-RSV-001 the ledger is unchanged');
select is(rsv_t_n($$ select (qty_on_hand * 1000)::bigint from stock_balances where warehouse_id = '26930000-0000-0000-0000-000000002002' and item_id = '26930000-0000-0000-0000-000000001001' $$), 10000::bigint, 'AC-RSV-001 the balance is unchanged');
select is((select r->>'qty_on_hand' from jsonb_array_elements(get_stock_on_hand('26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001001')) r), '10', 'AC-RSV-001 get_stock_on_hand is unchanged by reservations');
select is((select (r->'reservations'->0->>'work_order_id') from jsonb_array_elements(get_stock_free_reserved('26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001001')) r), '26930000-0000-0000-0000-000000000401', 'AC-RSV-001 the read names the reserving work order');
select is(reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 4, null, 'planned slab', '26930000-0000-0000-0000-00000000f001'), (select id from stock_reservations where work_order_id = '26930000-0000-0000-0000-000000000401'), 'AC-RSV-001 replaying one client request id returns the same reservation');
select is(rsv_t_n($$ select count(*) from stock_reservation_events $$), 1::bigint, 'AC-RSV-001 and writes no second event');

-- AC-RSV-002
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000402', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 7) $$, 'P0001', 'RSV_EXCEEDS_FREE: only 6 is free at this location', 'AC-RSV-002 7 of 6 free is refused');
select is(rsv_t_n($$ select count(*) from stock_reservations $$), 1::bigint, 'AC-RSV-002 and nothing is written');
select lives_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000402', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 3) $$, 'AC-RSV-002 3 for B is fine');
select lives_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000402', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 3) $$, 'AC-RSV-002 a second 3 for B is fine (3 free)');
select is(rsv_t_res('26930000-0000-0000-0000-000000000402'), '6.000/0.000/0.000/active', 'AC-RSV-002 reserving twice tops up one reservation');
select is(rsv_t_n($$ select count(*) from stock_reservations where work_order_id = '26930000-0000-0000-0000-000000000402' $$), 1::bigint, 'AC-RSV-002 still one row for B');
select is(rsv_t_n($$ select count(*) from stock_reservation_events where action = 'adjust' $$), 1::bigint, 'AC-RSV-002 the top-up is an adjust event');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000402', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 1) $$, 'P0001', 'RSV_EXCEEDS_FREE: only 0 is free at this location', 'AC-RSV-002 nothing is free now');

-- AC-RSV-005
select rsv_as('26930000-0000-0000-0000-0000000000a4');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000402', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 1) $$, '42501', 'RSV_FORBIDDEN: only the keeper of this location, a stock planner or an Admin can change reservations', 'AC-RSV-005 an outsider cannot reserve');
select throws_ok($$ select release_reservation((select id from stock_reservations where work_order_id = '26930000-0000-0000-0000-000000000402'), 1, 'try') $$, '42501', 'RSV_FORBIDDEN: only the keeper of this location, a stock planner or an Admin can change reservations', 'AC-RSV-005 an outsider cannot release');
select rsv_as('26930000-0000-0000-0000-0000000000a3');
select is(release_reservation((select id from stock_reservations where work_order_id = '26930000-0000-0000-0000-000000000402'), 2, 'plan changed'), 2::numeric, 'AC-RSV-005 a planner releases 2 (partial)');
select is(rsv_t_res('26930000-0000-0000-0000-000000000402'), '6.000/0.000/2.000/active', 'AC-RSV-006 a partial release leaves the rest active');
select is(rsv_t_free('free_qty'), '2', 'AC-RSV-006 the released 2 are free again');
select throws_ok($$ select release_reservation((select id from stock_reservations where work_order_id = '26930000-0000-0000-0000-000000000402'), 5, 'too much') $$, 'P0001', 'RSV_EXCEEDS_REMAINING: only 4 remains on this reservation', 'AC-RSV-006 more than remains is refused');
select throws_ok($$ select release_reservation((select id from stock_reservations where work_order_id = '26930000-0000-0000-0000-000000000402'), 1, null) $$, 'P0001', 'RSV_INVALID: a release needs a reason (1 to 500 characters)', 'AC-RSV-006 a release needs a reason');
select lives_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000402', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 1) $$, 'AC-RSV-005 a planner reserves');
select rsv_as('26930000-0000-0000-0000-0000000000a1');
select lives_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000402', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 1) $$, 'AC-RSV-005 an Admin (not the keeper) reserves');
select is(rsv_t_n($$ select count(*) from audit_events where action = 'stock.reservation_admin' $$), 1::bigint, 'AC-RSV-005 the Admin override is audited');
select is(release_reservation((select id from stock_reservations where work_order_id = '26930000-0000-0000-0000-000000000402'), null, 'back to 4'), 6::numeric, 'AC-RSV-006 release without a quantity releases everything that remains');

select is(rsv_t_res('26930000-0000-0000-0000-000000000402'), '8.000/0.000/8.000/released', 'AC-RSV-006 a fully released reservation reads released');
select throws_ok($$ select release_reservation((select id from stock_reservations where work_order_id = '26930000-0000-0000-0000-000000000402'), 1, 'again') $$, 'P0001', 'RSV_NOT_ACTIVE: the reservation is no longer active', 'AC-RSV-006 a released reservation cannot be released again');
select is(rsv_t_free('free_qty'), '6', 'setup: A holds 4 of 10');

-- AC-RSV-003 on hand below reserved
select create_stock_document(jsonb_build_object('kind','transfer','warehouse_id','26930000-0000-0000-0000-000000002002','to_warehouse_id','26930000-0000-0000-0000-000000002001'), jsonb_build_array(jsonb_build_object('item_id','26930000-0000-0000-0000-000000001001','quantity',8)), true);
select is(rsv_t_free('qty_on_hand'), '2', 'AC-RSV-003 on hand fell to 2 while 4 is reserved');
select is(rsv_t_free('free_qty'), '0', 'AC-RSV-003 free reads 0, never negative');
select is(rsv_t_free('short_by'), '2', 'AC-RSV-003 and the shortfall reads 2');
select is(rsv_t_res('26930000-0000-0000-0000-000000000401'), '4.000/0.000/0.000/active', 'AC-RSV-003 the reservation itself is unchanged');
select create_stock_document(jsonb_build_object('kind','transfer','warehouse_id','26930000-0000-0000-0000-000000002001','to_warehouse_id','26930000-0000-0000-0000-000000002002'), jsonb_build_array(jsonb_build_object('item_id','26930000-0000-0000-0000-000000001001','quantity',8)), true);

-- AC-RSV-004 refusals (as Admin)
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002003', 1) $$, 'P0001', 'RSV_LOCATION: reservations are held at central, site, yard or staging locations that are not archived', 'AC-RSV-004 a vendor location is refused');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002004', 1) $$, 'P0001', 'RSV_LOCATION: reservations are held at central, site, yard or staging locations that are not archived', 'AC-RSV-004 an archived location is refused');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000403', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 1) $$, 'P0001', 'RSV_WORK_ORDER: the work order is closed or cancelled', 'AC-RSV-004 a cancelled work order is refused');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000411', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 1) $$, 'P0001', 'RSV_NOT_FOUND: the work order is not in your organisation', 'AC-RSV-004 another organisation''s work order is refused');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001011', '26930000-0000-0000-0000-000000002002', 1) $$, 'P0001', 'RSV_NOT_FOUND: the item is not in your organisation', 'AC-RSV-004 another organisation''s item is refused');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001003', '26930000-0000-0000-0000-000000002002', 1) $$, 'P0001', 'RSV_NOT_FOUND: the item is archived', 'AC-RSV-004 an archived item is refused');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 0) $$, 'P0001', 'RSV_INVALID: the quantity must be a positive number with at most three decimals', 'AC-RSV-004 zero is refused');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 1.0005) $$, 'P0001', 'RSV_INVALID: the quantity must be a positive number with at most three decimals', 'AC-RSV-004 four decimals are refused');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001002', '26930000-0000-0000-0000-000000002002', 1.5) $$, 'P0001', 'RSV_INVALID: this item is counted in whole units', 'AC-RSV-004 a fraction of a whole-unit item is refused');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 1, current_date - 1) $$, 'P0001', 'RSV_INVALID: the expiry date is in the past', 'AC-RSV-004 an expiry in the past is refused');

-- AC-RSV-006 expiry and close
select reserve_stock('26930000-0000-0000-0000-000000000404', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 2);
select lives_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000402', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 3, current_date + 5) $$, 'setup: B reserves 3 with an expiry');
select is(rsv_t_free('reserved_qty'), '9', 'setup: 4 + 2 + 3 reserved');
reset role;
update stock_reservations set expires_on = current_date - 1 where work_order_id = '26930000-0000-0000-0000-000000000402' and status = 'active';
update work_orders set status = 'Cancelled' where id = '26930000-0000-0000-0000-000000000404';
select rsv_as('26930000-0000-0000-0000-0000000000a1');
select is(rsv_t_free('reserved_qty'), '4', 'AC-RSV-006 an expired reservation and a cancelled work order stop counting at once');
select is(rsv_t_free('free_qty'), '6', 'AC-RSV-006 and their quantity is free');
select rsv_as('26930000-0000-0000-0000-0000000000a2');
select throws_ok($$ select release_stale_reservations() $$, '42501', 'RSV_FORBIDDEN: only an Admin sweeps stale reservations', 'AC-RSV-006 only an Admin sweeps');
select rsv_as('26930000-0000-0000-0000-0000000000a1');
select is(release_stale_reservations(), 2, 'AC-RSV-006 the sweep records the two stale reservations');
select is(rsv_t_res('26930000-0000-0000-0000-000000000402', 3), '3.000/0.000/3.000/expired', 'AC-RSV-006 the expired one reads expired');
select is(rsv_t_res('26930000-0000-0000-0000-000000000404'), '2.000/0.000/2.000/released', 'AC-RSV-006 the closed work order''s reads released');
select is(rsv_t_n($$ select count(*) from stock_reservation_events where action in ('expire') $$), 1::bigint, 'AC-RSV-006 an expire event is written');
select is(release_stale_reservations(), 0, 'AC-RSV-006 a second sweep finds nothing');

-- AC-RSV-015 tenancy and no client writes
select throws_ok($$ insert into stock_reservations (work_order_id, item_id, warehouse_id, quantity, created_by) values ('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 1, '26930000-0000-0000-0000-0000000000a1') $$, '42501', null, 'AC-RSV-015 no client insert');
select throws_ok($$ update stock_reservations set quantity = 99 $$, '42501', null, 'AC-RSV-015 no client update');
select throws_ok($$ delete from stock_reservations $$, '42501', null, 'AC-RSV-015 no client delete');
select throws_ok($$ insert into stock_reservation_events (reservation_id, action, qty) values ((select id from stock_reservations limit 1), 'reserve', 1) $$, '42501', null, 'AC-RSV-015 no client event write');
select rsv_as('26930000-0000-0000-0000-0000000000b1');
select is((select count(*) from stock_reservations), 0::bigint, 'AC-RSV-015 another organisation sees no reservations (read as its own authenticated user, RLS forced)');
select is((select count(*) from stock_reservation_events), 0::bigint, 'AC-RSV-015 nor events');
select is(get_stock_free_reserved(null, null), '[]'::jsonb, 'AC-RSV-015 nor a read (its own setting is off)');
select is(set_stock_reservations(true), true, 'AC-RSV-015 the other organisation turns it on for itself');
select is(get_stock_free_reserved('26930000-0000-0000-0000-000000002002', '26930000-0000-0000-0000-000000001001'), '[]'::jsonb, 'AC-RSV-015 and still reads none of ours');
-- AC-RSV-015 with BOTH organisations on and each holding stock and a live reservation, neither read shows the other's rows (mut:rsv_org: drop every org filter of the read, this goes red).
select create_stock_document(jsonb_build_object('kind','receive','warehouse_id','26930000-0000-0000-0000-000000002011'), jsonb_build_array(jsonb_build_object('item_id','26930000-0000-0000-0000-000000001011','quantity',5,'unit_cost',3)), true);
select reserve_stock('26930000-0000-0000-0000-000000000411', '26930000-0000-0000-0000-000000001011', '26930000-0000-0000-0000-000000002011', 2);
select is(jsonb_array_length(get_stock_free_reserved(null, null)), 1, 'AC-RSV-015 the other organisation''s read returns exactly its own one row');
select is((select r->>'item_id' from jsonb_array_elements(get_stock_free_reserved(null, null)) r), '26930000-0000-0000-0000-000000001011', 'AC-RSV-015 and that row is its own item');
select is((select r->'reservations'->0->>'work_order_id' from jsonb_array_elements(get_stock_free_reserved(null, null)) r), '26930000-0000-0000-0000-000000000411', 'AC-RSV-015 held for its own work order only');
select is(jsonb_array_length(get_stock_free_reserved(null, '26930000-0000-0000-0000-000000001001')), 0, 'AC-RSV-015 asking for our item by id returns nothing, with both organisations on');
select is(jsonb_array_length(get_stock_free_reserved('26930000-0000-0000-0000-000000002002', null)), 0, 'AC-RSV-015 asking for our location by id returns nothing, with both organisations on');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 1) $$, 'P0001', 'RSV_NOT_FOUND: the work order is not in your organisation', 'AC-RSV-015 it cannot reserve for our work order');
select throws_ok($$ select release_reservation((select x from public.rsv_t_ids() x limit 1), 1, 'x') $$, 'P0001', 'RSV_NOT_FOUND: the reservation is not in your organisation', 'AC-RSV-015 it cannot release ours');
select rsv_as('26930000-0000-0000-0000-0000000000a1');
select is((select stock_reservations from organizations where id = '26930000-0000-0000-0000-00000000000a'), true, 'AC-RSV-015 our setting is untouched by theirs');
select is((select count(*) from jsonb_array_elements(get_stock_free_reserved(null, null)) r where r->>'item_id' = '26930000-0000-0000-0000-000000001011'), 0::bigint, 'AC-RSV-015 our read shows none of the other organisation''s items');
select is((select count(*) from jsonb_array_elements(get_stock_free_reserved(null, null)) r where r->>'warehouse_id' = '26930000-0000-0000-0000-000000002011'), 0::bigint, 'AC-RSV-015 nor its locations');
select is((select count(*) from jsonb_array_elements(get_stock_free_reserved(null, null)) r, jsonb_array_elements(r->'reservations') x where x->>'work_order_id' = '26930000-0000-0000-0000-000000000411'), 0::bigint, 'AC-RSV-015 nor its work orders');
select cmp_ok(jsonb_array_length(get_stock_free_reserved(null, null)), '>', 0, 'AC-RSV-015 while our own rows are there');
select is(set_stock_reservations(false), false, 'AC-RSV-007 an Admin turns it off');
select throws_ok($$ select reserve_stock('26930000-0000-0000-0000-000000000401', '26930000-0000-0000-0000-000000001001', '26930000-0000-0000-0000-000000002002', 1) $$, 'P0001', 'RSV_OFF: reservations are not turned on for your organisation', 'AC-RSV-007 off again refuses');
select is(get_stock_free_reserved(null, null), '[]'::jsonb, 'AC-RSV-007 and reads nothing');
select is(rsv_t_n($$ select count(*) from stock_reservations $$) > 0, true, 'AC-RSV-007 turning it off keeps the data');
reset role;
select throws_ok($$ delete from stock_reservations $$, 'P0001', 'RSV_IMMUTABLE: reservations and their history cannot be deleted or rewritten; release the reservation instead', 'AC-RSV-015 even the owner cannot delete a reservation');
select throws_ok($$ update stock_reservation_events set qty = 9 $$, 'P0001', 'RSV_IMMUTABLE: reservations and their history cannot be deleted or rewritten; release the reservation instead', 'AC-RSV-015 events are append-only');
select * from finish();
rollback;
