-- 1300_stock_vendor_location.test.sql — #2683 (spec docs/specs/stock-vendor-location.spec.md). Migration under test: 1300.
-- AC-SVL-001 vendor location shape and company link · 002 out and back · 003 cannot return more than held · 004 only transfer/adjust/count ·
-- 005 work order rules · 006 on-hand names the vendor · 007 old kinds unchanged · 008 reorder usage · 009 project location totals.
-- Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(34);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26830000-0000-0000-0000-00000000000a', 'SVL Org',       'IDR', 'UTC'),
  ('26830000-0000-0000-0000-00000000000b', 'SVL Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26830000-0000-0000-0000-0000000000a1', 'svl-admin@example.com'),
  ('26830000-0000-0000-0000-0000000000a3', 'svl-pm@example.com'),
  ('26830000-0000-0000-0000-0000000000a6', 'svl-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26830000-0000-0000-0000-0000000000a1', '26830000-0000-0000-0000-00000000000a', 'SVL Admin', 'svl-admin@example.com', 'Admin', 'active'),
  ('26830000-0000-0000-0000-0000000000a3', '26830000-0000-0000-0000-00000000000a', 'SVL PM',    'svl-pm@example.com',    'Project Manager', 'active'),
  ('26830000-0000-0000-0000-0000000000a6', '26830000-0000-0000-0000-00000000000a', 'SVL Eng',   'svl-eng@example.com',   'Engineer', 'active');
insert into companies (id, org_id, name, type) values
  ('26830000-0000-0000-0000-0000000000f1', '26830000-0000-0000-0000-00000000000a', 'SVL Client',  'Client'),
  ('26830000-0000-0000-0000-0000000000f2', '26830000-0000-0000-0000-00000000000a', 'SVL Coater',  'Vendor'),
  ('26830000-0000-0000-0000-0000000000f3', '26830000-0000-0000-0000-00000000000b', 'SVL Other Vendor', 'Vendor');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('26830000-0000-0000-0000-0000000000c1', '26830000-0000-0000-0000-00000000000a', 'SVL Job One', 'Ongoing Project', 1000000, 'exclusive', 0, '26830000-0000-0000-0000-0000000000f1', '26830000-0000-0000-0000-0000000000a3'),
  ('26830000-0000-0000-0000-0000000000c2', '26830000-0000-0000-0000-00000000000a', 'SVL Job Two', 'Ongoing Project', 1000000, 'exclusive', 0, '26830000-0000-0000-0000-0000000000f1', '26830000-0000-0000-0000-0000000000a3');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26830000-0000-0000-0000-0000000000e1', '26830000-0000-0000-0000-00000000000a', '26830000-0000-0000-0000-0000000000c1', 'W-1', 'Slab', 'm3', 50, 1000);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26830000-0000-0000-0000-000000000401', '26830000-0000-0000-0000-00000000000a', '26830000-0000-0000-0000-0000000000c1', 'SVL WO one', 'Issued', 10000, 'exclusive', 0),
  ('26830000-0000-0000-0000-000000000403', '26830000-0000-0000-0000-00000000000a', '26830000-0000-0000-0000-0000000000c2', 'SVL WO other job', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26830000-0000-0000-0000-0000000000d1', '26830000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('26830000-0000-0000-0000-000000001001', '26830000-0000-0000-0000-00000000000a', 'PIPE', 'Pipe', '26830000-0000-0000-0000-0000000000d1');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26830000-0000-0000-0000-000000002001', '26830000-0000-0000-0000-00000000000a', 'CEN',   'Central', 'central', null),
  ('26830000-0000-0000-0000-000000002002', '26830000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26830000-0000-0000-0000-0000000000c1'),
  ('26830000-0000-0000-0000-000000002003', '26830000-0000-0000-0000-00000000000a', 'USED',  'Used site', 'site', '26830000-0000-0000-0000-0000000000c1');

create function public.svl_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.svl_doc(p_kind text, p_wh uuid, p_to uuid, p_qty numeric, p_extra jsonb default '{}') returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind',p_kind,'warehouse_id',p_wh) || coalesce(case when p_to is null then null else jsonb_build_object('to_warehouse_id',p_to) end, '{}') || p_extra,
    jsonb_build_array(jsonb_build_object('item_id','26830000-0000-0000-0000-000000001001','quantity',p_qty) ||
      case when p_kind = 'receive' then jsonb_build_object('unit_cost', 4)
           when p_kind = 'issue' then jsonb_build_object('boq_item_id', '26830000-0000-0000-0000-0000000000e1') else '{}'::jsonb end), true) $$;
create function public.svl_attr(p_doc uuid, p_wo uuid) returns integer language sql as $$
  select public.set_cost_attribution('stock_document', array[p_doc], p_wo, null) $$;
create function public.svl_bal(p_wh uuid) returns text language sql security definer as $$
  select coalesce((select qty_on_hand::text || '/' || value_on_hand::text from public.stock_balances where warehouse_id = p_wh and item_id = '26830000-0000-0000-0000-000000001001'), 'none') $$;

-- ── AC-SVL-007 old kinds unchanged ───────────────────────────────────────────────────────────────────
select throws_ok($$ insert into stock_warehouses (org_id, code, name, kind) values ('26830000-0000-0000-0000-00000000000a','BAD','Bad','depot') $$,
  '23514', null, 'AC-SVL-007 an unknown location kind is still refused');
select lives_ok($$ insert into stock_warehouses (org_id, code, name, kind) values ('26830000-0000-0000-0000-00000000000a','OLD-S','Old site','site') $$,
  'AC-SVL-007 existing kinds are still accepted');
select is((select count(*)::int from stock_warehouses where kind = 'vendor'), 0, 'AC-SVL-007 no vendor location exists until an organisation creates one');

-- ── AC-SVL-001 shape and company link ────────────────────────────────────────────────────────────────
select svl_as('26830000-0000-0000-0000-0000000000a1');
select lives_ok($$ insert into stock_warehouses (id, code, name, kind, vendor_company_id) values ('26830000-0000-0000-0000-000000002010','VEND','At coater','vendor','26830000-0000-0000-0000-0000000000f2') $$,
  'AC-SVL-001 an Admin creates a vendor location linked to a Vendor company');
select lives_ok($$ insert into stock_warehouses (id, code, name, kind) values ('26830000-0000-0000-0000-000000002011','VEND2','Unlinked vendor','vendor') $$,
  'AC-SVL-001 the company link is optional');
select throws_ok($$ insert into stock_warehouses (code, name, kind, project_id) values ('VP','Vendor with project','vendor','26830000-0000-0000-0000-0000000000c1') $$,
  '23514', null, 'AC-SVL-001 a vendor location with a project is refused');
select throws_ok($$ insert into stock_warehouses (code, name, kind, vendor_company_id) values ('VC','Client as vendor','vendor','26830000-0000-0000-0000-0000000000f1') $$,
  'P0001', 'STK_NOT_FOUND: the vendor is not a vendor company of your organisation', 'AC-SVL-001 a Client company cannot be the vendor');
select throws_ok($$ insert into stock_warehouses (code, name, kind, vendor_company_id) values ('VX','Other org vendor','vendor','26830000-0000-0000-0000-0000000000f3') $$,
  'P0001', 'STK_NOT_FOUND: the vendor is not a vendor company of your organisation', 'AC-SVL-001 another organisation''s vendor cannot be linked');
select throws_ok($$ insert into stock_warehouses (code, name, kind, vendor_company_id) values ('SV','Site with vendor','site','26830000-0000-0000-0000-0000000000f2') $$,
  '23514', null, 'AC-SVL-001 a non-vendor location cannot carry a vendor company');
select throws_ok($$ update stock_warehouses set project_id = '26830000-0000-0000-0000-0000000000c1' where id = '26830000-0000-0000-0000-000000002010' $$,
  '23514', null, 'AC-SVL-001 a vendor location cannot be given a project later');
reset role;
select svl_as('26830000-0000-0000-0000-0000000000a6');
select throws_ok($$ insert into stock_warehouses (code, name, kind) values ('ENG','Eng vendor','vendor') $$, '42501', null, 'FR-SVL-005 a non-master-writer still cannot create a location');
reset role;

-- ── AC-SVL-002 out and back; AC-SVL-003; AC-SVL-009 ────────────────────────────────────────────────
select svl_as('26830000-0000-0000-0000-0000000000a1');
select svl_doc('receive', '26830000-0000-0000-0000-000000002001', null, 10);
select svl_doc('transfer', '26830000-0000-0000-0000-000000002001', '26830000-0000-0000-0000-000000002002', 10);
select is(svl_bal('26830000-0000-0000-0000-000000002002'), '10.000/40.00', 'AC-SVL-009 the project site holds 10 before the send-out');
select lives_ok($$ select svl_doc('transfer', '26830000-0000-0000-0000-000000002002', '26830000-0000-0000-0000-000000002010', 4) $$, 'AC-SVL-002 a transfer to a vendor location posts');
select is(svl_bal('26830000-0000-0000-0000-000000002010') || ' ' || svl_bal('26830000-0000-0000-0000-000000002002'), '4.000/16.00 6.000/24.00',
  'AC-SVL-002 the vendor holds 4 at the carried value; the site keeps 6');
select throws_ok($$ select svl_doc('transfer', '26830000-0000-0000-0000-000000002010', '26830000-0000-0000-0000-000000002002', 5) $$,
  'P0001', null, 'AC-SVL-003 the vendor cannot send back more than it holds');
select lives_ok($$ select svl_doc('transfer', '26830000-0000-0000-0000-000000002010', '26830000-0000-0000-0000-000000002002', 4) $$, 'AC-SVL-002 the transfer back posts');
select is(svl_bal('26830000-0000-0000-0000-000000002010') || ' ' || svl_bal('26830000-0000-0000-0000-000000002002'), '0.000/0.00 10.000/40.00',
  'AC-SVL-002 the vendor holds zero and the site is back to 10 at 40');
reset role;
select is((select sum(qty_delta) from stock_ledger where warehouse_id = '26830000-0000-0000-0000-000000002010'), 0::numeric, 'AC-SVL-002 the vendor ledger sums to zero (two legs each way)');
select is((select count(*)::int from stock_ledger where warehouse_id = '26830000-0000-0000-0000-000000002010'), 2, 'AC-SVL-002 one row per leg at the vendor');

-- ── AC-SVL-004 only transfers, adjustments and counts ───────────────────────────────────────────────
select svl_as('26830000-0000-0000-0000-0000000000a1');
select throws_ok($$ select svl_doc('receive', '26830000-0000-0000-0000-000000002010', null, 1) $$, 'P0001', 'STK_VENDOR_LOCATION: a vendor location takes only transfers, adjustments and counts', 'AC-SVL-004 a receive at a vendor is refused');
select throws_ok($$ select svl_doc('issue', '26830000-0000-0000-0000-000000002010', null, 1, '{"project_id":"26830000-0000-0000-0000-0000000000c1"}') $$, 'P0001', 'STK_VENDOR_LOCATION: a vendor location takes only transfers, adjustments and counts', 'AC-SVL-004 an issue at a vendor is refused');
select throws_ok($$ select svl_doc('return', '26830000-0000-0000-0000-000000002010', null, 1, '{"project_id":"26830000-0000-0000-0000-0000000000c1"}') $$, 'P0001', 'STK_VENDOR_LOCATION: a vendor location takes only transfers, adjustments and counts', 'AC-SVL-004 a return at a vendor is refused');
select set_config('svl.adj', public.create_stock_document('{"kind":"adjustment","warehouse_id":"26830000-0000-0000-0000-000000002010","reason":"found at vendor"}'::jsonb,
  '[{"item_id":"26830000-0000-0000-0000-000000001001","quantity":2,"direction":"in","unit_cost":4}]'::jsonb, false)::text, false);
select set_config('svl.cnt', public.create_stock_document('{"kind":"count","warehouse_id":"26830000-0000-0000-0000-000000002010"}'::jsonb,
  '[{"item_id":"26830000-0000-0000-0000-000000001001","counted_quantity":1}]'::jsonb, false)::text, false);
reset role;
select svl_as('26830000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.post_stock_document(current_setting('svl.adj')::uuid, (select revision from public.stock_documents where id = current_setting('svl.adj')::uuid)) $$,
  'AC-SVL-004 an adjustment at a vendor is accepted (posted by a second person)');
select lives_ok($$ select public.post_stock_document(current_setting('svl.cnt')::uuid, (select revision from public.stock_documents where id = current_setting('svl.cnt')::uuid)) $$,
  'AC-SVL-004 a count at a vendor is accepted (posted by a second person)');
reset role;
select throws_ok($$ update stock_warehouses set kind = 'vendor' where id = '26830000-0000-0000-0000-000000002001' $$, 'P0001',
  'STK_VENDOR_LOCATION: a location with receipts, issues or returns cannot become a vendor location', 'FR-SVL-013 a location with receipts cannot become a vendor location');

-- ── AC-SVL-005 work order rules ─────────────────────────────────────────────────────────────────────
select svl_as('26830000-0000-0000-0000-0000000000a1');
select throws_ok($$ select svl_attr(svl_doc('transfer', '26830000-0000-0000-0000-000000002002', '26830000-0000-0000-0000-000000002010', 1), '26830000-0000-0000-0000-000000000401') $$,
  '23514', 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order', 'AC-SVL-005 a transfer to a vendor cannot name a work order');
select svl_doc('transfer', '26830000-0000-0000-0000-000000002002', '26830000-0000-0000-0000-000000002010', 3);
select lives_ok($$ select svl_attr(svl_doc('transfer', '26830000-0000-0000-0000-000000002010', '26830000-0000-0000-0000-000000002002', 1), '26830000-0000-0000-0000-000000000401') $$,
  'AC-SVL-005 a transfer back may name the work order of the site''s project');
select throws_ok($$ select svl_attr(svl_doc('transfer', '26830000-0000-0000-0000-000000002010', '26830000-0000-0000-0000-000000002002', 1), '26830000-0000-0000-0000-000000000403') $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-SVL-005 a work order of another project is refused');
reset role;

-- ── AC-SVL-006 on-hand names the vendor ──────────────────────────────────────────────────────────────
select svl_as('26830000-0000-0000-0000-0000000000a3');
select is((select r->>'warehouse_kind' || '/' || coalesce(r->>'vendor_name', '-') from jsonb_array_elements(public.get_stock_on_hand('26830000-0000-0000-0000-000000002010')) r limit 1),
  'vendor/SVL Coater', 'AC-SVL-006 stock at the vendor reads as at the vendor, with its name');
select is((select r ? 'vendor_name' from jsonb_array_elements(public.get_stock_on_hand('26830000-0000-0000-0000-000000002002')) r limit 1), false, 'AC-SVL-006 a site row has no vendor_name key');
select ok((select r ? 'value_on_hand' from jsonb_array_elements(public.get_stock_on_hand('26830000-0000-0000-0000-000000002010')) r limit 1), 'AC-SVL-006 a Project Manager still sees value (cost rule unchanged)');
reset role;
select svl_as('26830000-0000-0000-0000-0000000000a6');
select ok(not (select r ? 'value_on_hand' from jsonb_array_elements(public.get_stock_on_hand('26830000-0000-0000-0000-000000002010')) r limit 1), 'AC-SVL-006 an Engineer still does not see value');
reset role;

-- ── AC-SVL-008 a send-out to a vendor is not usage ───────────────────────────────────────────────────
create function public.svl_today() returns date language sql as $$ select (now() at time zone 'UTC')::date $$;
create function public.svl_on(p_kind text, p_from uuid, p_to uuid, p_qty numeric, p_ago int) returns uuid language sql as $$
  select public.svl_doc(p_kind, p_from, p_to, p_qty, jsonb_build_object('occurred_on', (public.svl_today() - p_ago)::text)
    || case when p_kind = 'issue' then '{"project_id":"26830000-0000-0000-0000-0000000000c1"}'::jsonb else '{}'::jsonb end) $$;
select svl_as('26830000-0000-0000-0000-0000000000a1');
select svl_on('receive', '26830000-0000-0000-0000-000000002003', null, 100, 60);
select svl_on('transfer', '26830000-0000-0000-0000-000000002003', '26830000-0000-0000-0000-000000002010', 5, 40);
select svl_on('transfer', '26830000-0000-0000-0000-000000002003', '26830000-0000-0000-0000-000000002010', 5, 30);
select svl_on('transfer', '26830000-0000-0000-0000-000000002003', '26830000-0000-0000-0000-000000002010', 5, 20);
select is(public.get_reorder_suggestions('26830000-0000-0000-0000-000000002003', '26830000-0000-0000-0000-000000001001') ->> 'status', 'insufficient_history',
  'AC-SVL-008 three send-outs to a vendor are not usage movements');
select svl_on('issue', '26830000-0000-0000-0000-000000002003', null, 5, 10);
select svl_on('issue', '26830000-0000-0000-0000-000000002003', null, 5, 8);
select svl_on('issue', '26830000-0000-0000-0000-000000002003', null, 5, 6);
select is(public.get_reorder_suggestions('26830000-0000-0000-0000-000000002003', '26830000-0000-0000-0000-000000001001') #>> '{inputs,usage}', '15',
  'AC-SVL-008 only the three issues count as usage (15), not the 15 sent to the vendor');
reset role;

select * from finish();
rollback;
