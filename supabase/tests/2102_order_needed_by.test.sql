-- 2102_order_needed_by.test.sql — 1124d decision 3 (spec docs/specs/order-needed-by.spec.md). Migration under test: 2102.
--   AC-NBY-001 default off: an order moves to Ordered without a date, exactly as today.
--   AC-NBY-002 only an Admin turns the rule on; the moment it was turned on is kept.
--   AC-NBY-003 rule on: an order created after that moment cannot be sent (Ordered) without its header date; with the date it can.
--   AC-NBY-004 the header date fills every line that has none; a line with its own date keeps it; a line may be given its own date.
--   AC-NBY-005 an order created before the rule was turned on is never blocked.
--   AC-NBY-006 nobody writes the date by hand, a stranger or an unrelated Engineer is refused, and it is frozen once the order is sent.
--   AC-NBY-007 another organisation changes and reads nothing.
-- Mutation checks (orchestrator, each alone): mut:required -> 003 · mut:setting_admin -> 002 · mut:write_path -> 006 · mut:who -> 006 · mut:frozen -> 006 · mut:line_exempt -> 004.
begin;
select plan(23);

insert into organizations (id, name) values
  ('26970000-0000-0000-0000-000000000001', 'NBY Org A'),
  ('26970000-0000-0000-0000-000000000002', 'NBY Org B');
insert into auth.users (id, email) values
  ('26970000-0000-0000-0000-0000000000a1', 'nby-admin@example.com'),
  ('26970000-0000-0000-0000-0000000000a2', 'nby-req@example.com'),
  ('26970000-0000-0000-0000-0000000000a3', 'nby-other@example.com'),
  ('26970000-0000-0000-0000-0000000000a4', 'nby-fin@example.com'),
  ('26970000-0000-0000-0000-0000000000b1', 'nby-admin-b@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('26970000-0000-0000-0000-0000000000a1', '26970000-0000-0000-0000-000000000001', 'NBY Admin', 'nby-admin@example.com', 'Admin'),
  ('26970000-0000-0000-0000-0000000000a2', '26970000-0000-0000-0000-000000000001', 'NBY Requester', 'nby-req@example.com', 'Engineer'),
  ('26970000-0000-0000-0000-0000000000a3', '26970000-0000-0000-0000-000000000001', 'NBY Other', 'nby-other@example.com', 'Engineer'),
  ('26970000-0000-0000-0000-0000000000a4', '26970000-0000-0000-0000-000000000001', 'NBY Finance', 'nby-fin@example.com', 'Finance'),
  ('26970000-0000-0000-0000-0000000000b1', '26970000-0000-0000-0000-000000000002', 'NBY Admin B', 'nby-admin-b@example.com', 'Admin');
-- an order created BEFORE the rule is turned on (AC-NBY-005), created a day ago
insert into procurements (id, org_id, title, status, requested_by_id, created_at) values
  ('26970000-0000-0000-0000-000000000010', '26970000-0000-0000-0000-000000000001', 'NBY old order', 'Approved', '26970000-0000-0000-0000-0000000000a2', now() - interval '1 day');
create function public.nby_as(p_user uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true); end $$;

-- AC-NBY-001 default off: an Approved order moves to Ordered with no date
select nby_as('26970000-0000-0000-0000-0000000000a4');
select lives_ok($$ update procurements set status = 'Ordered' where id = '26970000-0000-0000-0000-000000000010' $$, 'AC-NBY-001 off by default: an order is sent with no date, as today');
select is((select po_needed_by_required_from from organizations where id = '26970000-0000-0000-0000-000000000001'), null, 'AC-NBY-001 the rule is off for an existing organisation');

-- AC-NBY-002 only an Admin turns it on
set local role authenticated;
select nby_as('26970000-0000-0000-0000-0000000000a4');
select throws_ok($$ select set_po_needed_by_required(true) $$, '42501', 'only an Admin changes the needed-by rule', 'AC-NBY-002 Finance cannot turn the rule on');
select nby_as('26970000-0000-0000-0000-0000000000a1');
select is(set_po_needed_by_required(true), true, 'AC-NBY-002 an Admin turns it on');
reset role;
select ok((select po_needed_by_required_from is not null from organizations where id = '26970000-0000-0000-0000-000000000001'), 'AC-NBY-002 the moment it was turned on is kept');

-- orders created after the moment
insert into procurements (id, org_id, title, status, requested_by_id, created_at) values
  ('26970000-0000-0000-0000-000000000011', '26970000-0000-0000-0000-000000000001', 'NBY new order', 'Approved', '26970000-0000-0000-0000-0000000000a2', now() + interval '1 minute'),
  ('26970000-0000-0000-0000-000000000012', '26970000-0000-0000-0000-000000000001', 'NBY new order two', 'Approved', '26970000-0000-0000-0000-0000000000a2', now() + interval '1 minute');
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('26970000-0000-0000-0000-000000000021', '26970000-0000-0000-0000-000000000001', '26970000-0000-0000-0000-000000000011', 'Line one', 1, 10),
  ('26970000-0000-0000-0000-000000000022', '26970000-0000-0000-0000-000000000001', '26970000-0000-0000-0000-000000000011', 'Line two', 1, 10);

-- AC-NBY-003 the rule blocks sending without the date
select nby_as('26970000-0000-0000-0000-0000000000a4');
select throws_ok($$ update procurements set status = 'Ordered' where id = '26970000-0000-0000-0000-000000000012' $$, 'P0001', 'Set the needed-by date before sending the order to the supplier', 'AC-NBY-003 an order without its date cannot be sent');
-- AC-NBY-004 the date fills every line; a line may differ
set local role authenticated;
select lives_ok($$ select set_procurement_needed_by('26970000-0000-0000-0000-000000000011', '2026-12-31') $$, 'AC-NBY-004 Finance sets the header date');
reset role;
select is((select count(*)::int from procurement_items where procurement_id = '26970000-0000-0000-0000-000000000011' and needed_by = date '2026-12-31'), 2, 'AC-NBY-004 the date fills every line');
set local role authenticated;
select nby_as('26970000-0000-0000-0000-0000000000a2');
select lives_ok($$ select set_procurement_needed_by('26970000-0000-0000-0000-000000000011', '2026-12-31', '[{"item_id":"26970000-0000-0000-0000-000000000022","needed_by":"2026-12-15"}]') $$, 'AC-NBY-004 the requester gives one line its own date');
reset role;
select is((select needed_by::text from procurement_items where id = '26970000-0000-0000-0000-000000000022'), '2026-12-15', 'AC-NBY-004 that line keeps its own date');
select is((select needed_by::text from procurement_items where id = '26970000-0000-0000-0000-000000000021'), '2026-12-31', 'AC-NBY-004 the other line follows the header');
set local role authenticated;
select nby_as('26970000-0000-0000-0000-0000000000a4');
select lives_ok($$ select set_procurement_needed_by('26970000-0000-0000-0000-000000000011', '2026-12-20') $$, 'AC-NBY-004 the header date is moved');
reset role;
select is((select needed_by::text from procurement_items where id = '26970000-0000-0000-0000-000000000021'), '2026-12-20', 'AC-NBY-004 a line that followed the header follows the move');
select is((select needed_by::text from procurement_items where id = '26970000-0000-0000-0000-000000000022'), '2026-12-15', 'AC-NBY-004 a line with its own date is left alone');
select lives_ok($$ select set_procurement_needed_by('26970000-0000-0000-0000-000000000011', '2026-12-20', '[{"item_id":"26970000-0000-0000-0000-000000000022","needed_by":null}]') $$, 'AC-NBY-004 explicitly clearing a line exception restores the header date');
select is((select needed_by::text from procurement_items where id = '26970000-0000-0000-0000-000000000022'), '2026-12-20', 'AC-NBY-004 the cleared line follows the header');
select nby_as('26970000-0000-0000-0000-0000000000a4');
select lives_ok($$ update procurements set status = 'Ordered' where id = '26970000-0000-0000-0000-000000000011' $$, 'AC-NBY-003 with the date the order is sent');

-- AC-NBY-005 the old order was sent before the rule and is untouched; a not-yet-sent old order would not be blocked either
insert into procurements (id, org_id, title, status, requested_by_id, created_at) values
  ('26970000-0000-0000-0000-000000000013', '26970000-0000-0000-0000-000000000001', 'NBY old open order', 'Approved', '26970000-0000-0000-0000-0000000000a2', now() - interval '2 days');
select lives_ok($$ update procurements set status = 'Ordered' where id = '26970000-0000-0000-0000-000000000013' $$, 'AC-NBY-005 an order created before the rule is never blocked');

-- AC-NBY-006 no hand writes, no strangers, frozen once sent
insert into procurements (id, org_id, title, status, requested_by_id, created_at) values
  ('26970000-0000-0000-0000-000000000014', '26970000-0000-0000-0000-000000000001', 'NBY fresh', 'Approved', '26970000-0000-0000-0000-0000000000a2', now() + interval '1 minute');
select throws_ok($$ update procurements set needed_by = '2026-12-01' where id = '26970000-0000-0000-0000-000000000014' $$, '42501', 'the needed-by date is set through the order, not by hand', 'AC-NBY-006 nobody writes the date by hand');
set local role authenticated;
select nby_as('26970000-0000-0000-0000-0000000000a3');
select throws_ok($$ select set_procurement_needed_by('26970000-0000-0000-0000-000000000014', '2026-12-01') $$, '42501', 'the needed-by date is not permitted', 'AC-NBY-006 an unrelated Engineer is refused');
select nby_as('26970000-0000-0000-0000-0000000000a4');
select throws_ok($$ select set_procurement_needed_by('26970000-0000-0000-0000-000000000011', '2026-12-01') $$, '42501', 'the needed-by date is not permitted', 'AC-NBY-006 a date cannot change once the order is sent');
-- AC-NBY-007 another organisation
select nby_as('26970000-0000-0000-0000-0000000000b1');
select throws_ok($$ select set_procurement_needed_by('26970000-0000-0000-0000-000000000014', '2026-12-01') $$, '42501', 'the needed-by date is not permitted', 'AC-NBY-007 another organisation changes nothing');
select is((select count(*)::int from procurements where id = '26970000-0000-0000-0000-000000000014'), 0, 'AC-NBY-007 and reads nothing');
reset role;
select * from finish();
rollback;
