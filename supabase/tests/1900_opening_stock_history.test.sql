begin;
create extension if not exists pgtap;
-- Opening stock with movement history (docs/specs/opening-stock-history.spec.md, AC-OSH-001..011; plan 2026-11-22-opening-stock-history.md).
-- ⚑ MUTATION CHECK (run by hand, quote the result in the build report; each break must turn the named assertions RED, then restore):
--   (a) 1901 opening_history_plan, line `-- mut:zero_cost`: make a non-zero cost on a client-supplied item pass (`if false then`)   -> AC-OSH-004 refusals go red.
--   (b) 1901 opening_history_plan, line `-- mut:over_issue`: let an out row exceed the running balance (`if false then`)            -> AC-OSH-003 / AC-OSH-006 go red.
--   (c) 1901 both entry points, line `-- mut:admin`: skip the Admin check (`if false then`)                                          -> AC-OSH-001 goes red.
--   (d) 1901 load_stock_opening_history, line `-- mut:idempotent`: skip the replay branch (`if false then`)                          -> AC-OSH-008 goes red.
--   (e) "balance = sum of movements": in 1901 opening_post_location change the out entry `-l.quantity` to `-l.quantity - 1`          -> AC-OSH-005 / AC-OSH-009 go red.
select plan(49);

insert into organizations (id, name, default_currency, default_timezone) values
  ('19000000-0000-0000-0000-000000000001', 'OSH Org',   'IDR', 'UTC'),
  ('19000000-0000-0000-0000-000000000002', 'OSH Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('19000000-0000-0000-0000-0000000000a1', 'osh-admin@example.invalid'),
  ('19000000-0000-0000-0000-0000000000a2', 'osh-fin@example.invalid'),
  ('19000000-0000-0000-0000-0000000000a3', 'osh-pm@example.invalid'),
  ('19000000-0000-0000-0000-0000000000b1', 'osh-xadmin@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('19000000-0000-0000-0000-0000000000a1', '19000000-0000-0000-0000-000000000001', 'OSH Admin', 'osh-admin@example.invalid', 'Admin', 'active'),
  ('19000000-0000-0000-0000-0000000000a2', '19000000-0000-0000-0000-000000000001', 'OSH Fin',   'osh-fin@example.invalid',   'Finance', 'active'),
  ('19000000-0000-0000-0000-0000000000a3', '19000000-0000-0000-0000-000000000001', 'OSH PM',    'osh-pm@example.invalid',    'Project Manager', 'active'),
  ('19000000-0000-0000-0000-0000000000b1', '19000000-0000-0000-0000-000000000002', 'OSH XAdm',  'osh-xadmin@example.invalid', 'Admin', 'active');
insert into stock_units (id, org_id, code, name, whole_only) values
  ('19000000-0000-0000-0000-0000000000d1', '19000000-0000-0000-0000-000000000001', 'pc', 'Piece', true),
  ('19000000-0000-0000-0000-0000000000d2', '19000000-0000-0000-0000-000000000001', 'kg', 'Kilogram', false),
  ('19000000-0000-0000-0000-0000000000d3', '19000000-0000-0000-0000-000000000002', 'kg', 'Kilogram', false);
insert into stock_tags (id, org_id, name, zero_cost, paper_required) values
  ('19000000-0000-0000-0000-0000000000e1', '19000000-0000-0000-0000-000000000001', 'Client supplied', true, false);
insert into stock_items (id, org_id, code, name, unit_id, tag_id) values
  ('19000000-0000-0000-0000-000000001001', '19000000-0000-0000-0000-000000000001', 'CEM',  'Cement',          '19000000-0000-0000-0000-0000000000d2', null),
  ('19000000-0000-0000-0000-000000001002', '19000000-0000-0000-0000-000000000001', 'CLI',  'Client steel',    '19000000-0000-0000-0000-0000000000d2', '19000000-0000-0000-0000-0000000000e1'),
  ('19000000-0000-0000-0000-000000001003', '19000000-0000-0000-0000-000000000001', 'BOLT', 'Bolt',            '19000000-0000-0000-0000-0000000000d1', null),
  ('19000000-0000-0000-0000-000000001009', '19000000-0000-0000-0000-000000000002', 'XIT',  'Other org item',  '19000000-0000-0000-0000-0000000000d3', null);
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('19000000-0000-0000-0000-000000002001', '19000000-0000-0000-0000-000000000001', 'W1', 'Warehouse one',   'central'),
  ('19000000-0000-0000-0000-000000002002', '19000000-0000-0000-0000-000000000001', 'W2', 'Warehouse two',   'central'),
  ('19000000-0000-0000-0000-000000002003', '19000000-0000-0000-0000-000000000001', 'W3', 'Warehouse three', 'central'),
  ('19000000-0000-0000-0000-000000002004', '19000000-0000-0000-0000-000000000001', 'W4', 'Warehouse four',  'central'),
  ('19000000-0000-0000-0000-000000002005', '19000000-0000-0000-0000-000000000001', 'W5', 'Warehouse five',  'central'),
  ('19000000-0000-0000-0000-000000002009', '19000000-0000-0000-0000-000000000002', 'XW', 'Other org wh',    'central');

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- one template row: date, location, item, direction, quantity, unit cost (null = blank), reference
create function pg_temp.mv(p_day integer, p_loc text, p_item text, p_dir text, p_qty text, p_cost text default null, p_ref text default null) returns jsonb language sql as $$
  select jsonb_build_object('date', (current_date - 3 + p_day)::text, 'location', p_loc, 'item', p_item, 'direction', p_dir, 'quantity', p_qty,
                            'unit_cost', p_cost, 'reference', p_ref) $$;
select set_config('osh.golive', (current_date - 3)::text, true);
select set_config('osh.req1', '19000000-0000-0000-0000-0000000000f1', true);
select set_config('osh.req2', '19000000-0000-0000-0000-0000000000f2', true);
select set_config('osh.req3', '19000000-0000-0000-0000-0000000000f3', true);
-- file A (W1): cost item in 10 at 5, out 4; client-supplied item in 10, out 4, in 2 at "0"; bolts in 7 at 1.5 with a delivery note
select set_config('osh.a', jsonb_build_array(
  pg_temp.mv(-30, 'W1', 'CEM', 'in', '10', '5'), pg_temp.mv(-20, 'W1', 'CEM', 'out', '4'),
  pg_temp.mv(-30, 'W1', 'CLI', 'in', '10'), pg_temp.mv(-20, 'W1', 'CLI', 'out', '4'), pg_temp.mv(-10, 'W1', 'CLI', 'in', '2', '0'),
  pg_temp.mv(-10, 'W1', 'BOLT', 'in', '7', '1.5', 'DN-1'))::text, true);
-- file B (W2): the out row is larger than what came in
select set_config('osh.b', jsonb_build_array(pg_temp.mv(-30, 'W2', 'CEM', 'in', '5', '2'), pg_temp.mv(-20, 'W2', 'CEM', 'out', '9'))::text, true);
-- file C (W3): a non-zero cost on a client-supplied item
select set_config('osh.c', jsonb_build_array(pg_temp.mv(-30, 'W3', 'CLI', 'in', '5', '3'))::text, true);
-- file D (W3): an out row dated before the stock came in
select set_config('osh.d', jsonb_build_array(pg_temp.mv(-30, 'W3', 'CEM', 'out', '1'), pg_temp.mv(-20, 'W3', 'CEM', 'in', '5', '1'))::text, true);
-- file E (W3): one refusal of each kind
select set_config('osh.e', jsonb_build_array(
  pg_temp.mv(-30, 'W3', 'CEM', 'in', '0', '1'),            -- 1 quantity not above zero
  pg_temp.mv(-30, 'W3', 'BOLT', 'in', '1.5', '1'),         -- 2 a whole-unit item with a fraction
  pg_temp.mv(-30, 'W3', 'CEM', 'in', '3'),                 -- 3 a cost item without a cost
  pg_temp.mv(-30, 'W3', 'NOPE', 'in', '3', '1'),           -- 4 unknown item
  pg_temp.mv(-30, 'NOWHERE', 'CEM', 'in', '3', '1'),       -- 5 unknown location
  pg_temp.mv(1, 'W3', 'CEM', 'in', '3', '1'),              -- 6 dated after go-live
  pg_temp.mv(-30, 'W3', 'CEM', 'sideways', '3', '1'),      -- 7 neither in nor out
  pg_temp.mv(-30, 'XW', 'XIT', 'in', '3', '1'),            -- 8 another organisation's location and item
  pg_temp.mv(-30, 'W3', 'CEM', 'in', '2', '1'))::text, true);   -- 9 fine
-- file F (W5): loaded, then reversed
select set_config('osh.f', jsonb_build_array(pg_temp.mv(-30, 'W5', 'CEM', 'in', '3', '2'), pg_temp.mv(-20, 'W5', 'CEM', 'out', '1'), pg_temp.mv(-10, 'W5', 'CLI', 'in', '4'))::text, true);
-- file G (W4): a location that has already moved
select set_config('osh.g', jsonb_build_array(pg_temp.mv(-30, 'W4', 'CEM', 'in', '1', '1'))::text, true);

-- grants ------------------------------------------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.preview_stock_opening_history(date,jsonb)', 'EXECUTE'), false, 'AC-OSH-001 anon cannot preview');
select is(has_function_privilege('anon', 'public.load_stock_opening_history(date,jsonb,uuid,text)', 'EXECUTE'), false, 'AC-OSH-001 anon cannot load');
select is(has_function_privilege('authenticated', 'public.opening_history_plan(uuid,date,jsonb)', 'EXECUTE'), false, 'AC-OSH-001 the validator is not client-callable');
select is(has_function_privilege('authenticated', 'public.opening_post_location(uuid,uuid,date,jsonb,text,boolean,uuid)', 'EXECUTE'), false, 'AC-OSH-001 the posting routine is not client-callable');
select is(has_column_privilege('authenticated', 'public.stock_document_lines', 'unit_cost', 'SELECT'), false, 'FR-OSH-013 line cost stays unreadable by clients');

-- AC-OSH-001 who may run it ----------------------------------------------------------------------------------------------
select pg_temp.as_user('19000000-0000-0000-0000-0000000000a2');
select throws_ok($$select * from public.preview_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.a')::jsonb)$$, '42501', null, 'AC-OSH-001 Finance cannot preview');
select throws_ok($$select public.load_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.a')::jsonb, current_setting('osh.req1')::uuid)$$, '42501', null, 'AC-OSH-001 Finance cannot confirm');
reset role;
select pg_temp.as_user('19000000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.load_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.a')::jsonb, current_setting('osh.req1')::uuid)$$, '42501', null, 'AC-OSH-001 a Project Manager cannot confirm');
reset role;
select pg_temp.as_user('19000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.preview_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.a')::jsonb) where verdict = 'refused'), 6,
  'AC-OSH-001 another organisation''s Admin sees none of this organisation''s locations or items (every row refused)');
reset role;

-- AC-OSH-002 preview writes nothing ---------------------------------------------------------------------------------------
select set_config('osh.n_led', (select count(*)::text from stock_ledger), true);
select set_config('osh.n_doc', (select count(*)::text from stock_documents), true);
select set_config('osh.n_bal', (select count(*)::text from stock_balances), true);
select set_config('osh.n_opn', (select count(*)::text from opening_balances), true);
select pg_temp.as_user('19000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.preview_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.a')::jsonb) where verdict = 'ok'), 6, 'AC-OSH-002 a valid file previews as six accepted rows');
select is((select run_qty from public.preview_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.a')::jsonb) where row_no = 2), 6::numeric,
  'AC-OSH-002 the preview''s running balance after the cost item''s out row is 6');
select is((select run_val from public.preview_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.a')::jsonb) where row_no = 2), 30::numeric,
  'AC-OSH-002 and its value is 30 (the out is priced at the moving average, 5 each)');
reset role;
select is((select count(*)::text from stock_ledger) || '/' || (select count(*)::text from stock_documents) || '/' || (select count(*)::text from stock_balances) || '/' || (select count(*)::text from opening_balances),
  current_setting('osh.n_led') || '/' || current_setting('osh.n_doc') || '/' || current_setting('osh.n_bal') || '/' || current_setting('osh.n_opn'),
  'AC-OSH-002 the preview wrote no ledger row, document, balance or opening');

-- AC-OSH-003 / 006 / 007 refusals ------------------------------------------------------------------------------------------
select pg_temp.as_user('19000000-0000-0000-0000-0000000000a1');
select is((select message from public.preview_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.b')::jsonb) where verdict = 'refused'), 'OPN_OVER_ISSUE: row 2',
  'AC-OSH-003 the preview names the out row larger than the balance');
select throws_ok($$select public.load_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.b')::jsonb, current_setting('osh.req2')::uuid)$$, 'P0001', 'OPN_OVER_ISSUE: row 2',
  'AC-OSH-003 confirm refuses the whole file with the same code and row');
select is((select message from public.preview_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.d')::jsonb) where verdict = 'refused'), 'OPN_OVER_ISSUE: row 1',
  'AC-OSH-006 an out row dated before the stock came in is refused (rows apply in date order)');
select is((select string_agg(coalesce(message, 'ok'), ' | ' order by row_no) from public.preview_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.e')::jsonb)),
  'OPN_ROW_INVALID: row 1 | OPN_ROW_INVALID: row 2 | OPN_COST_NEEDED: row 3 | OPN_UNKNOWN_ITEM: row 4 | OPN_UNKNOWN_LOCATION: row 5 | OPN_DATE_AFTER_GO_LIVE: row 6 | OPN_ROW_INVALID: row 7 | OPN_UNKNOWN_LOCATION: row 8 | ok',
  'AC-OSH-007 each kind of bad row gets its own code and row number, and the good row is accepted');
select is((select message from public.preview_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.c')::jsonb)), 'STK_ZERO_COST: row 1',
  'AC-OSH-004 a non-zero cost on a client-supplied item is refused in the preview');
select throws_ok($$select public.load_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.c')::jsonb, current_setting('osh.req3')::uuid)$$, 'P0001', 'STK_ZERO_COST: row 1',
  'AC-OSH-004 and refused on confirm');
select throws_ok($$select public.load_stock_opening_history(current_setting('osh.golive')::date, '[]'::jsonb, current_setting('osh.req3')::uuid)$$, '23514', 'OPN_TOO_MANY_ROWS: a file holds 1 to 5000 rows',
  'FR-OSH-010 an empty file is refused');
select throws_ok($$select * from public.preview_stock_opening_history((current_date + 1), current_setting('osh.a')::jsonb)$$, '23514', null, 'FR-OSH-007 a go-live date in the future is refused');
reset role;
select is((select count(*)::int from stock_documents where warehouse_id in ('19000000-0000-0000-0000-000000002002', '19000000-0000-0000-0000-000000002003')), 0,
  'AC-OSH-003 a refused file left no document behind');

-- AC-OSH-004 / 005 confirm file A -------------------------------------------------------------------------------------------
select pg_temp.as_user('19000000-0000-0000-0000-0000000000a1');
select lives_ok($$select set_config('osh.o1', (select string_agg(x::text, ',') from public.load_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.a')::jsonb, current_setting('osh.req1')::uuid, 'history') x), true)$$,
  'AC-OSH-005 an Admin confirms a clean file');
reset role;
select is((select count(*)::int from opening_balances where client_request_id = current_setting('osh.req1')::uuid), 1, 'AC-OSH-005 one opening record per location');
select is((select string_agg(l.kind || ':' || l.qty_delta::text || ':' || l.value_delta::text || '@' || (l.occurred_on - current_setting('osh.golive')::date)::text, ' ' order by l.seq)
             from stock_ledger l where l.item_id = '19000000-0000-0000-0000-000000001001'),
  'opening:10.000:50.00@-30 opening:-4.000:-20.00@-20', 'AC-OSH-005 cost item: in 10 at 5.00, out 4 at the moving average 5.00, each dated at its own day');
select is((select qty_on_hand::text || '/' || value_on_hand::text from stock_balances where item_id = '19000000-0000-0000-0000-000000001001' and warehouse_id = '19000000-0000-0000-0000-000000002001'),
  '6.000/30.00', 'AC-OSH-005 cost item balance is 6 at 30.00');
select is((select qty_on_hand::text || '/' || value_on_hand::text from stock_balances where item_id = '19000000-0000-0000-0000-000000001003'), '7.000/10.50', 'AC-OSH-005 bolts 7 at 10.50');
select is((select count(*)::int from stock_ledger where item_id = '19000000-0000-0000-0000-000000001002'), 3, 'AC-OSH-004 the client-supplied item has its three movements');
select is((select coalesce(sum(abs(value_delta)), 0) from stock_ledger where item_id = '19000000-0000-0000-0000-000000001002'), 0::numeric, 'AC-OSH-004 every one of them is at value 0');
select is((select qty_on_hand::text || '/' || value_on_hand::text from stock_balances where item_id = '19000000-0000-0000-0000-000000001002'), '8.000/0.00', 'AC-OSH-004 client-supplied balance is 8 at value 0');
select is((select count(*)::int from stock_document_lines where item_id = '19000000-0000-0000-0000-000000001002' and direction = 'in' and unit_cost = 0), 2,
  'AC-OSH-004 a blank cost on a client-supplied item is stored as 0');
select is((select reference from stock_document_lines where item_id = '19000000-0000-0000-0000-000000001003'), 'DN-1', 'FR-OSH-003 the paper reference is kept on the line');
select is((select d.kind || '/' || d.status from stock_documents d join opening_balances o on o.stock_document_id = d.id where o.client_request_id = current_setting('osh.req1')::uuid), 'opening/Posted', 'FR-OSH-003 one posted opening document');
select is((select count(*)::int from audit_events where action = 'opening_balance.load' and entity_id::text = current_setting('osh.o1')), 1, 'FR-OSH-009 the load is audited');

-- AC-OSH-008 the same file again --------------------------------------------------------------------------------------------
select set_config('osh.n_led', (select count(*)::text from stock_ledger), true);
select pg_temp.as_user('19000000-0000-0000-0000-0000000000a1');
select is((select string_agg(x::text, ',') from public.load_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.a')::jsonb, current_setting('osh.req1')::uuid, 'history') x),
  current_setting('osh.o1'), 'AC-OSH-008 the same request id returns the openings already made');
reset role;
select is((select count(*)::text from stock_ledger), current_setting('osh.n_led'), 'AC-OSH-008 and posts nothing a second time');

-- AC-OSH-010 a location that has an opening or has moved ---------------------------------------------------------------------
select pg_temp.as_user('19000000-0000-0000-0000-0000000000a1');
select is((select message from public.preview_stock_opening_history(current_setting('osh.golive')::date, jsonb_build_array(pg_temp.mv(-30, 'W1', 'CEM', 'in', '1', '1')))), 'OPN_ALREADY_LOADED: row 1',
  'AC-OSH-010 a location that already has an opening is refused');
select lives_ok($$select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','19000000-0000-0000-0000-000000002004'),
  '[{"item_id":"19000000-0000-0000-0000-000000001001","quantity":1,"unit_cost":1}]'::jsonb, true)$$, 'fixture: a real receipt at W4');
select is((select message from public.preview_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.g')::jsonb)), 'OPN_LOCATION_MOVED: row 1',
  'AC-OSH-010 a location that has already moved is refused');
reset role;

-- AC-OSH-011 reverse ------------------------------------------------------------------------------------------------------
select pg_temp.as_user('19000000-0000-0000-0000-0000000000a1');
select lives_ok($$select set_config('osh.o2', (select string_agg(x::text, ',') from public.load_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.f')::jsonb, '19000000-0000-0000-0000-0000000000f4')x), true)$$,
  'AC-OSH-011 fixture: a history is loaded at W5');
select lives_ok($$select public.reverse_opening_balance(current_setting('osh.o2')::uuid)$$, 'AC-OSH-011 an Admin reverses it while nothing real has moved');
reset role;
select is((select coalesce(sum(qty_on_hand), 0)::text || '/' || coalesce(sum(value_on_hand), 0)::text from stock_balances where warehouse_id = '19000000-0000-0000-0000-000000002005'), '0.000/0.00', 'AC-OSH-011 every balance at W5 is back to zero');
select isnt((select reversed_at from opening_balances where id = current_setting('osh.o2')::uuid), null, 'AC-OSH-011 the opening is marked reversed');
select is((select count(*)::int from audit_events where action = 'opening_balance.reverse' and entity_id = current_setting('osh.o2')::uuid), 1, 'AC-OSH-011 the reversal is audited');
select pg_temp.as_user('19000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.load_stock_opening_history(current_setting('osh.golive')::date, current_setting('osh.f')::jsonb, '19000000-0000-0000-0000-0000000000f5')$$, 'AC-OSH-011 a reversed location takes a corrected load');
reset role;

-- AC-OSH-009 the invariant: balance = sum of movements ---------------------------------------------------------------------------
select is((select count(*)::int from (
  select coalesce(s.item_id, b.item_id) i, coalesce(s.warehouse_id, b.warehouse_id) w
    from (select item_id, warehouse_id, sum(qty_delta) q, sum(value_delta) v from public.stock_ledger group by 1, 2) s
    full join public.stock_balances b on b.item_id = s.item_id and b.warehouse_id = s.warehouse_id
   where coalesce(s.q, 0) <> coalesce(b.qty_on_hand, 0) or coalesce(s.v, 0) <> coalesce(b.value_on_hand, 0)) bad), 0,
  'AC-OSH-009 for every item and location the movements sum to the balance row (quantity and value)');
select is((select count(*)::int from (
  select qty_after - sum(qty_delta) over (partition by item_id, warehouse_id order by seq) dq,
         value_after - sum(value_delta) over (partition by item_id, warehouse_id order by seq) dv from public.stock_ledger) x
  where dq <> 0 or dv <> 0), 0, 'AC-OSH-009 every entry''s running balance equals the cumulative sum up to it');
select is((select count(*)::int from stock_ledger l where l.kind = 'opening' and l.item_id = '19000000-0000-0000-0000-000000001001' and l.warehouse_id = '19000000-0000-0000-0000-000000002001'), 2,
  'AC-OSH-009 the movements that make the balance are all on the ledger');
select is((select qty_on_hand from stock_balances where item_id = '19000000-0000-0000-0000-000000001001' and warehouse_id = '19000000-0000-0000-0000-000000002001'),
  (select sum(qty_delta) from stock_ledger where item_id = '19000000-0000-0000-0000-000000001001' and warehouse_id = '19000000-0000-0000-0000-000000002001'), 'AC-OSH-009 a named balance equals its ledger sum');

select * from finish();
rollback;
