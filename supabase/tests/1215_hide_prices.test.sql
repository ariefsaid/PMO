-- 1215_hide_prices.test.sql — #2699 hide prices from requesters: the setting, the one rule, the masked views, the stock cost seam.
-- Migrations under test: 1215_hide_prices_setting, 1216_hide_prices_procurement_views, 1217_hide_prices_stock_views.
-- Mutation notes (break, see the named assertion go red, restore):
--   actor_may_see_prices_now returns true            -> AC-002 Field user row, AC-003 hidden rows
--   make actor_sees_prices() return true             -> AC-002 'Field user hidden'
--   drop the org_hide_prices_enabled test            -> AC-001 'setting off: Engineer sees', AC-005 org B row
--   remove the helper from procurement_items_masked  -> AC-003 'hidden item rate/amount'
--   drop the Admin check in set_hide_prices_enabled  -> AC-006 'Engineer cannot turn on'
begin;
select plan(22);

insert into organizations (id, name) values
  ('26990000-0000-0000-0000-000000000001','HP Org A'),
  ('26990000-0000-0000-0000-000000000002','HP Org B (setting stays off)');
insert into auth.users (id, email)
select ('26990000-0000-0000-0000-0000000000' || n)::uuid, 'hp-' || n || '@example.com'
from unnest(array['a1','b1','c1','d1','e1','f1','a2','a3','a4','b2']) n;
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26990000-0000-0000-0000-0000000000a1','26990000-0000-0000-0000-000000000001','HP Admin','hp-a1@example.com','Admin','active'),
  ('26990000-0000-0000-0000-0000000000b1','26990000-0000-0000-0000-000000000001','HP PM','hp-b1@example.com','Project Manager','active'),
  ('26990000-0000-0000-0000-0000000000c1','26990000-0000-0000-0000-000000000001','HP Finance','hp-c1@example.com','Finance','active'),
  ('26990000-0000-0000-0000-0000000000d1','26990000-0000-0000-0000-000000000001','HP Exec','hp-d1@example.com','Executive','active'),
  ('26990000-0000-0000-0000-0000000000e1','26990000-0000-0000-0000-000000000001','HP Engineer legacy','hp-e1@example.com','Engineer','active'),
  ('26990000-0000-0000-0000-0000000000f1','26990000-0000-0000-0000-000000000001','HP Buyer','hp-f1@example.com','Engineer','active'),
  ('26990000-0000-0000-0000-0000000000a2','26990000-0000-0000-0000-000000000001','HP Field user','hp-a2@example.com','Engineer','active'),
  ('26990000-0000-0000-0000-0000000000a3','26990000-0000-0000-0000-000000000001','HP Finance Officer','hp-a3@example.com','Finance','active'),
  ('26990000-0000-0000-0000-0000000000a4','26990000-0000-0000-0000-000000000001','HP Inactive','hp-a4@example.com','Engineer','disabled'),
  ('26990000-0000-0000-0000-0000000000b2','26990000-0000-0000-0000-000000000002','HP Engineer B','hp-b2@example.com','Engineer','active');
-- built-in keys are given by the service path with the #2709 setting on for organization A
update organizations set built_in_roles_enabled = true where id = '26990000-0000-0000-0000-000000000001';
update profiles set built_in_role = 'buyer' where id = '26990000-0000-0000-0000-0000000000f1';
update profiles set built_in_role = 'field_user' where id = '26990000-0000-0000-0000-0000000000a2';
update profiles set built_in_role = 'finance_officer' where id = '26990000-0000-0000-0000-0000000000a3';

insert into procurements (id, org_id, title, status, requested_by_id) values
  ('26990000-0000-0000-0000-000000000010','26990000-0000-0000-0000-000000000001','HP Case','Draft','26990000-0000-0000-0000-0000000000e1');
insert into procurement_items (id, procurement_id, name, quantity, rate) values
  ('26990000-0000-0000-0000-000000000011','26990000-0000-0000-0000-000000000010','HP Item',2,12.50);

-- The Buyer raised a case of their own, so they have the same access to it that the legacy Engineer has to the first one.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('26990000-0000-0000-0000-000000000012','26990000-0000-0000-0000-000000000001','HP Buyer Case','Draft','26990000-0000-0000-0000-0000000000f1');
insert into procurement_items (id, procurement_id, name, quantity, rate) values
  ('26990000-0000-0000-0000-000000000013','26990000-0000-0000-0000-000000000012','HP Buyer Item',2,12.50);

-- AC-001 default and setter
select is((select hide_prices_from_requesters from organizations where id = '26990000-0000-0000-0000-000000000001'), false, 'AC-006 the setting defaults to off');
set local role authenticated;
set local request.jwt.claims = '{"sub":"26990000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is(actor_may_see_prices_now(), true, 'AC-001 setting off: the legacy Engineer sees prices as today');
select is((select rate from procurement_items_masked where id = '26990000-0000-0000-0000-000000000011'), 12.50, 'AC-001 setting off: the masked view returns the rate');
select throws_ok($$ select set_hide_prices_enabled(true) $$, '42501', null, 'AC-006 an Engineer cannot turn the setting on');
set local request.jwt.claims = '{"sub":"26990000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(get_hide_prices_enabled(), false, 'AC-006 an Admin reads the setting off');
select is(set_hide_prices_enabled(true), true, 'AC-006 an Admin turns the setting on');
reset role;
select is((select hide_prices_from_requesters from organizations where id = '26990000-0000-0000-0000-000000000002'), false, 'AC-005 organization B is unchanged');

-- AC-002 truth table, setting on in A
create temp table hp_who (id text, expect boolean, label text);
insert into hp_who values
  ('a1', true,  'Admin sees'), ('b1', true, 'legacy Project Manager sees'), ('c1', true, 'legacy Finance sees'), ('d1', true, 'Executive sees'),
  ('e1', true, 'legacy Engineer sees'), ('f1', true, 'Buyer sees'), ('a2', false, 'Field user hidden'),
  ('a3', true, 'Finance Officer sees'), ('a4', false, 'inactive member hidden');
grant select on hp_who to authenticated;
do $$ declare r record; got boolean; begin
  for r in select * from hp_who loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"26990000-0000-0000-0000-0000000000' || r.id || '","role":"authenticated"}', true);
    got := public.actor_may_see_prices_now();
    execute 'reset role';
    if got is distinct from r.expect then raise exception 'AC-002 % expected % got %', r.label, r.expect, got; end if;
  end loop; end $$;
select pass('AC-002 the truth table holds for all nine actors (Field user hidden, inactive hidden, the rest see, the legacy Engineer included)');
select is((select count(*)::int from hp_who), 9, 'AC-002 nine actors were checked');
set local role authenticated;
set local request.jwt.claims = '{"sub":"26990000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is(actor_may_see_prices_now(), true, 'AC-005 organization B legacy Engineer still sees (its setting is off)');

-- AC-003 hidden actor: NULL prices, rest intact. The hidden person must be one who can read the case at all (a Field user cannot),
-- so the list is changed as data inside this transaction: the Engineer role loses its price right and the Engineer holds it.
reset role;
delete from built_in_role_capabilities where role_key = 'engineer' and capability = 'sees_prices';
update profiles set built_in_role = 'engineer' where id = '26990000-0000-0000-0000-0000000000e1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"26990000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select rate from procurement_items_masked where id = '26990000-0000-0000-0000-000000000011'), null, 'AC-003 hidden item rate is NULL');
select is((select amount from procurement_items_masked where id = '26990000-0000-0000-0000-000000000011'), null, 'AC-003 hidden item amount is NULL');
select is((select quantity from procurement_items_masked where id = '26990000-0000-0000-0000-000000000011'), 2::numeric, 'AC-003 the quantity stays visible');
select is((select total_value from procurements_masked where id = '26990000-0000-0000-0000-000000000010'), null, 'AC-003 hidden procurement total is NULL');
select is((select title from procurements_masked where id = '26990000-0000-0000-0000-000000000010'), 'HP Case', 'AC-003 the row and its title stay visible');
select is((select stock_can_see_cost()), false, 'AC-004 the stock cost seam is closed for a hidden actor');

-- purchasing and finance see the value
set local request.jwt.claims = '{"sub":"26990000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select rate from procurement_items_masked where id = '26990000-0000-0000-0000-000000000011'), 12.50, 'AC-003 Finance reads the rate');
select is((select amount from procurement_items_masked where id = '26990000-0000-0000-0000-000000000011'), 25.00, 'AC-003 Finance reads the amount');
select is((select stock_can_see_cost()), true, 'AC-004 Finance keeps the stock cost seam');
set local request.jwt.claims = '{"sub":"26990000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select count(*)::int from procurement_items_masked where id = '26990000-0000-0000-0000-000000000013'), 1, 'AC-003 the Buyer can see the row');
select is((select rate from procurement_items_masked where id = '26990000-0000-0000-0000-000000000013'), 12.50, 'AC-003 a Buyer reads the rate');
reset role;

-- structural: every masked view calls the helper (11 views)
select is((select count(*)::int from pg_views where schemaname = 'public' and viewname like '%\_masked' and definition like '%actor_may_see_prices_now%'),
  11, 'AC-003 all eleven masked views mask through the one helper');

select * from finish();
rollback;
