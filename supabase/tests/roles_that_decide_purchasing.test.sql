-- roles_that_decide_purchasing.test.sql — a person who fills an ordering job role raises and sends a purchase order
-- (docs/specs/roles-that-decide.spec.md §2.3). Migrations under test: 1840, 1842_purchase_order_job_roles.sql,
-- 1843_purchasing_read_scope_order_roles.sql.
-- AC-RTD-009 (ordering setting) Admin only, built-in roles on, catalogue keys that are not field roles, on every write path ·
-- AC-RTD-011 a Buyer named in the setting reads purchases, moves an approved one to Ordered and records the order ·
-- AC-RTD-012 never an unapproved purchase, never an approval, never a bill or a payment; a job role not named reads only its own ·
-- AC-RTD-013 with the setting empty a Buyer is refused and reads only their own (today's outcome for every level stays proven by the
-- existing 0350 / procurement tests, untouched).
-- Every denial asserts the errcode AND the message, except where an earlier unchanged gate answers first (noted).
-- MUTATION NOTES (break the rule in 1842/1843; the named assertion must go red; restore):
--   1842 transition_procurement: drop the mut:order_approved check ..... 'AC-RTD-012 a Buyer cannot order a purchase that skipped approval'
--   1842 transition_procurement: make mut:order_gate "p_to = 'Ordered'" alone 'AC-RTD-013 with the setting empty a Buyer cannot order'
--   1842 create_purchase_order: drop the mut:raise_approved check ....... 'AC-RTD-012 a Buyer cannot record an order on an unapproved purchase'
--   1842 guard_purchase_order_job_roles: drop "or r.tier = 'field'" ...... 'AC-RTD-009 a field role cannot be named as one that orders'
--   1842 guard_purchase_order_job_roles: drop the mut:order_roles_setting check 'AC-RTD-009 roles cannot be named while built-in roles are off'
--   1843 add "or (select public.actor_may_order_purchases())" to payments_engineer_read_scope
--                                                                         'AC-RTD-012 a Buyer reads no payment'
--   1843 drop the mut:read_procurements branch ........................... 'AC-RTD-011 a Buyer named in the setting reads every purchase'
begin;
create extension if not exists pgtap;
select plan(27);

insert into organizations (id, name, built_in_roles_enabled) values
  ('18420000-0000-0000-0000-00000000000a', 'RTD Buy Org', true),
  ('18420000-0000-0000-0000-00000000000b', 'RTD Buy Off Org', false);
insert into auth.users (id, email) values
  ('18420000-0000-0000-0000-0000000000a1', 'rtdb-admin@example.com'),
  ('18420000-0000-0000-0000-0000000000a2', 'rtdb-buyer@example.com'),
  ('18420000-0000-0000-0000-0000000000a3', 'rtdb-store@example.com'),
  ('18420000-0000-0000-0000-0000000000a4', 'rtdb-eng@example.com'),
  ('18420000-0000-0000-0000-0000000000a5', 'rtdb-pm@example.com'),
  ('18420000-0000-0000-0000-0000000000b1', 'rtdb-off-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('18420000-0000-0000-0000-0000000000a1', '18420000-0000-0000-0000-00000000000a', 'RTDB Admin', 'rtdb-admin@example.com', 'Admin', 'active', null),
  ('18420000-0000-0000-0000-0000000000a2', '18420000-0000-0000-0000-00000000000a', 'RTDB Buyer', 'rtdb-buyer@example.com', 'Engineer', 'active', 'buyer'),
  ('18420000-0000-0000-0000-0000000000a3', '18420000-0000-0000-0000-00000000000a', 'RTDB Store', 'rtdb-store@example.com', 'Engineer', 'active', 'storekeeper'),
  ('18420000-0000-0000-0000-0000000000a4', '18420000-0000-0000-0000-00000000000a', 'RTDB Eng',   'rtdb-eng@example.com',   'Engineer', 'active', null),
  ('18420000-0000-0000-0000-0000000000a5', '18420000-0000-0000-0000-00000000000a', 'RTDB PM',    'rtdb-pm@example.com',    'Project Manager', 'active', null),
  ('18420000-0000-0000-0000-0000000000b1', '18420000-0000-0000-0000-00000000000b', 'RTDB Off',   'rtdb-off-admin@example.com', 'Admin', 'active', null);
insert into procurements (id, org_id, title, status, currency, requested_by_id) values
  ('18420000-0000-0000-0000-0000000000c1', '18420000-0000-0000-0000-00000000000a', 'Approved purchase',  'Approved',  'IDR', '18420000-0000-0000-0000-0000000000a5'),
  ('18420000-0000-0000-0000-0000000000c2', '18420000-0000-0000-0000-00000000000a', 'Draft purchase',     'Draft',     'IDR', '18420000-0000-0000-0000-0000000000a5'),
  ('18420000-0000-0000-0000-0000000000c3', '18420000-0000-0000-0000-00000000000a', 'Requested purchase', 'Requested', 'IDR', '18420000-0000-0000-0000-0000000000a5'),
  ('18420000-0000-0000-0000-0000000000c4', '18420000-0000-0000-0000-00000000000a', 'Second approved',    'Approved',  'IDR', '18420000-0000-0000-0000-0000000000a5');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency) values
  ('18420000-0000-0000-0000-0000000000e1', '18420000-0000-0000-0000-00000000000a', '18420000-0000-0000-0000-0000000000c1', 'VI-RTD-1', '2026-11-20', 'Received', 1000, 'exclusive', 0, 'IDR');
insert into payments (id, org_id, procurement_id, pay_number, status, date, amount, currency) values
  ('18420000-0000-0000-0000-0000000000f1', '18420000-0000-0000-0000-00000000000a', '18420000-0000-0000-0000-0000000000c1', 'PAY-RTD-1', 'Scheduled', '2026-11-21', 1000, 'IDR');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
set local role authenticated;

-- AC-RTD-013: the setting is empty, so the Buyer is refused and reads only their own (none).
select pg_temp._as('18420000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from procurements), 0, 'AC-RTD-013 with the setting empty a Buyer reads no one else''s purchase');
select throws_ok($$ select transition_procurement('18420000-0000-0000-0000-0000000000c1', 'Ordered') $$, '42501',
  'PO_ORDER_FORBIDDEN: you cannot order purchases; ask an Admin to name your built-in role as one that orders',
  'AC-RTD-013 with the setting empty a Buyer cannot order');
select throws_ok($$ select create_purchase_order('18420000-0000-0000-0000-0000000000c1', 'REF-1', 'Issued', current_date, 1000) $$, '42501',
  'PO_ORDER_FORBIDDEN: you cannot order purchases; ask an Admin to name your built-in role as one that orders',
  'AC-RTD-013 with the setting empty a Buyer cannot record an order');

-- AC-RTD-009: the setting.
select pg_temp._as('18420000-0000-0000-0000-0000000000a5');
select throws_ok($$ select po_set_order_job_roles(array['buyer']) $$, '42501',
  'PO_ADMIN_ONLY: only an Admin can change purchase order settings', 'AC-RTD-009 a non-Admin cannot name roles that order');
select pg_temp._as('18420000-0000-0000-0000-0000000000b1');
select throws_ok($$ select po_set_order_job_roles(array['buyer']) $$, 'P0001',
  'PO_JOB_ROLE_OFF: turn on built-in roles before naming roles that order', 'AC-RTD-009 roles cannot be named while built-in roles are off');
select is((select count(*)::int from purchase_order_settings where org_id = '18420000-0000-0000-0000-00000000000b' and cardinality(order_job_roles) > 0), 0,
  'AC-RTD-009 nothing persisted while built-in roles are off');
select lives_ok($$ select po_set_order_job_roles(array[]::text[]) $$, 'AC-RTD-009 clearing is accepted while built-in roles are off');
select pg_temp._as('18420000-0000-0000-0000-0000000000a1');
select throws_ok($$ select po_set_order_job_roles(array['foreman']) $$, '23514',
  'PO_ORDER_ROLE_INVALID: choose built-in roles from the list; a field role cannot order', 'AC-RTD-009 a field role cannot be named as one that orders');
select throws_ok($$ select po_set_order_job_roles(array['no_such_role']) $$, '23514',
  'PO_ORDER_ROLE_INVALID: choose built-in roles from the list; a field role cannot order', 'AC-RTD-009 an unknown role cannot be named');
select is(po_set_order_job_roles(array['buyer', 'buyer']), array['buyer'], 'AC-RTD-009 an Admin names Buyer as a role that orders');
select throws_ok($$ update purchase_order_settings set order_job_roles = array['field_user'] where org_id = '18420000-0000-0000-0000-00000000000a' $$, '23514',
  'PO_ORDER_ROLE_INVALID: choose built-in roles from the list; a field role cannot order',
  'AC-RTD-009 the direct table path holds the same rule');

-- AC-RTD-011: the Buyer reads, orders an approved purchase and records the order.
select pg_temp._as('18420000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from procurements), 4, 'AC-RTD-011 a Buyer named in the setting reads every purchase');
select lives_ok($$ select transition_procurement('18420000-0000-0000-0000-0000000000c1', 'Ordered') $$,
  'AC-RTD-011 a Buyer moves an approved purchase to Ordered');
select is((select status::text from procurements where id = '18420000-0000-0000-0000-0000000000c1'), 'Ordered',
  'AC-RTD-011 the purchase is Ordered');
select is((select status from purchase_orders where procurement_id = '18420000-0000-0000-0000-0000000000c1'), 'Issued',
  'AC-RTD-011 the order is issued and the Buyer reads it');
select lives_ok($$ select create_purchase_order('18420000-0000-0000-0000-0000000000c1', 'REF-RTD-1', 'Issued', current_date, 1000) $$,
  'AC-RTD-011 a Buyer records the order''s reference and amount');
select is((select reference_number from purchase_orders where procurement_id = '18420000-0000-0000-0000-0000000000c1'), 'REF-RTD-1',
  'AC-RTD-011 the recorded reference persisted on the one order');

-- AC-RTD-012: never an unapproved purchase, never an approval, never a bill or a payment.
select throws_ok($$ select transition_procurement('18420000-0000-0000-0000-0000000000c2', 'Ordered') $$, '42501',
  'PO_ORDER_NOT_APPROVED: this purchase has not been approved yet, so it cannot be ordered',
  'AC-RTD-012 a Buyer cannot order a purchase that skipped approval');
select is((select status::text from procurements where id = '18420000-0000-0000-0000-0000000000c2'), 'Draft', 'AC-RTD-012 the draft stays a draft');
select throws_ok($$ select create_purchase_order('18420000-0000-0000-0000-0000000000c2', 'REF-2', 'Issued', current_date, 10) $$, '42501',
  'PO_ORDER_NOT_APPROVED: this purchase has not been approved yet, so it cannot be ordered',
  'AC-RTD-012 a Buyer cannot record an order on an unapproved purchase');
-- the unchanged approval gates (spend routing, then the level list) answer first; the errcode is the contract here
select throws_ok($$ select transition_procurement('18420000-0000-0000-0000-0000000000c3', 'Approved') $$, '42501', null,
  'AC-RTD-012 a Buyer cannot approve a purchase');
select is((select status::text from procurements where id = '18420000-0000-0000-0000-0000000000c3'), 'Requested', 'AC-RTD-012 the request stays unapproved');
select is((select count(*)::int from procurement_invoices), 0, 'AC-RTD-012 a Buyer reads no vendor bill');
select is((select count(*)::int from payments), 0, 'AC-RTD-012 a Buyer reads no payment');

-- A job role not named reads only its own; a person with no job role on the Buyer's level counts (FR-RTD-003, spec §7 Q2).
select pg_temp._as('18420000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from procurements), 0, 'AC-RTD-012 a Storekeeper, not named in the setting, reads no one else''s purchase');
select throws_ok($$ select transition_procurement('18420000-0000-0000-0000-0000000000c4', 'Ordered') $$, '42501',
  'PO_ORDER_FORBIDDEN: you cannot order purchases; ask an Admin to name your built-in role as one that orders',
  'AC-RTD-012 a Storekeeper, not named in the setting, cannot order');
select pg_temp._as('18420000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from procurements), 4,
  'AC-RTD-012 an Engineer with no built-in role fills Buyer and reads purchases while the setting names Buyer (spec Q2)');

select * from finish();
rollback;
