-- #2525: three-way match — a vendor bill is checked against the order and the receipt before it can be paid
-- (AC-TWM-001..012). Spec docs/specs/three-way-match.spec.md · Plan docs/plans/2026-11-20-three-way-match.md.
-- Migration under test: 0965_three_way_match.sql. The mutation check is three_way_match_mutation.test.sql.
-- Orgs: A (match on, multi-member), B (match on, purchasing owned by an ERP), N (match never switched on).
-- Bills are recorded through create_procurement_invoice so their create audit carries the real author.
begin;
create extension if not exists pgtap;
select plan(64);

insert into organizations (id, name, default_currency) values
  ('25250000-0000-0000-0000-00000000000a', 'TWM Org',       'IDR'),
  ('25250000-0000-0000-0000-00000000000b', 'TWM ERP Org',   'IDR'),
  ('25250000-0000-0000-0000-00000000000c', 'TWM Plain Org', 'IDR');
insert into auth.users (id, email) values
  ('25250000-0000-0000-0000-0000000000a1', 'twm-admin@example.com'),
  ('25250000-0000-0000-0000-0000000000a2', 'twm-fin1@example.com'),
  ('25250000-0000-0000-0000-0000000000a3', 'twm-fin2@example.com'),
  ('25250000-0000-0000-0000-0000000000a4', 'twm-pm@example.com'),
  ('25250000-0000-0000-0000-0000000000a5', 'twm-eng@example.com'),
  ('25250000-0000-0000-0000-0000000000a6', 'twm-exec@example.com'),
  ('25250000-0000-0000-0000-0000000000b1', 'twm-erp-admin@example.com'),
  ('25250000-0000-0000-0000-0000000000c1', 'twm-plain-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25250000-0000-0000-0000-0000000000a1', '25250000-0000-0000-0000-00000000000a', 'TWM Admin', 'twm-admin@example.com', 'Admin', 'active'),
  ('25250000-0000-0000-0000-0000000000a2', '25250000-0000-0000-0000-00000000000a', 'TWM Fin1',  'twm-fin1@example.com',  'Finance', 'active'),
  ('25250000-0000-0000-0000-0000000000a3', '25250000-0000-0000-0000-00000000000a', 'TWM Fin2',  'twm-fin2@example.com',  'Finance', 'active'),
  ('25250000-0000-0000-0000-0000000000a4', '25250000-0000-0000-0000-00000000000a', 'TWM PM',    'twm-pm@example.com',    'Project Manager', 'active'),
  ('25250000-0000-0000-0000-0000000000a5', '25250000-0000-0000-0000-00000000000a', 'TWM Eng',   'twm-eng@example.com',   'Engineer', 'active'),
  ('25250000-0000-0000-0000-0000000000a6', '25250000-0000-0000-0000-00000000000a', 'TWM Exec',  'twm-exec@example.com',  'Executive', 'active'),
  ('25250000-0000-0000-0000-0000000000b1', '25250000-0000-0000-0000-00000000000b', 'TWM ERP Admin', 'twm-erp-admin@example.com', 'Admin', 'active'),
  ('25250000-0000-0000-0000-0000000000c1', '25250000-0000-0000-0000-00000000000c', 'TWM Plain Fin', 'twm-plain-fin@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status) values
  ('25250000-0000-0000-0000-0000000000d1', '25250000-0000-0000-0000-00000000000a', 'TWM Site',  'Ongoing Project'),
  ('25250000-0000-0000-0000-0000000000d2', '25250000-0000-0000-0000-00000000000b', 'TWM ERP Site', 'Ongoing Project'),
  ('25250000-0000-0000-0000-0000000000d3', '25250000-0000-0000-0000-00000000000c', 'TWM Plain Site', 'Ongoing Project');
-- p1: the goods purchase under test. p2: a subcontract purchase (its own cap applies). p3: a purchase whose bill has
-- no recorded author. pb: org B's purchase. pn: org N's purchase.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('25250000-0000-0000-0000-0000000000f1', '25250000-0000-0000-0000-00000000000a', 'TWM cement and steel', '25250000-0000-0000-0000-0000000000d1',
   '25250000-0000-0000-0000-0000000000a4', 'Vendor Invoiced', 600000, 600000, '25250000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false),
  ('25250000-0000-0000-0000-0000000000f2', '25250000-0000-0000-0000-00000000000a', 'TWM subcontract', '25250000-0000-0000-0000-0000000000d1',
   '25250000-0000-0000-0000-0000000000a4', 'Vendor Invoiced', 100000, 100000, '25250000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('25250000-0000-0000-0000-0000000000f3', '25250000-0000-0000-0000-00000000000a', 'TWM unknown author', '25250000-0000-0000-0000-0000000000d1',
   '25250000-0000-0000-0000-0000000000a4', 'Vendor Invoiced', 100000, 100000, '25250000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false),
  ('25250000-0000-0000-0000-0000000000fb', '25250000-0000-0000-0000-00000000000b', 'TWM ERP buy', '25250000-0000-0000-0000-0000000000d2',
   '25250000-0000-0000-0000-0000000000b1', 'Vendor Invoiced', 100000, 100000, '25250000-0000-0000-0000-0000000000b1', 'Materials', 'IDR', false),
  ('25250000-0000-0000-0000-0000000000fc', '25250000-0000-0000-0000-00000000000c', 'TWM plain buy', '25250000-0000-0000-0000-0000000000d3',
   '25250000-0000-0000-0000-0000000000c1', 'Vendor Invoiced', 100000, 100000, '25250000-0000-0000-0000-0000000000c1', 'Materials', 'IDR', false);
-- Ordered items (the order's lines): cement 100 @ 1,000 and steel 10 @ 50,000 on p1; one item on p3.
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('25250000-0000-0000-0000-000000000011', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f1', 'Cement', 100, 1000),
  ('25250000-0000-0000-0000-000000000012', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f1', 'Steel',   10, 50000),
  ('25250000-0000-0000-0000-000000000031', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f3', 'Sand',    10, 1000);
insert into procurement_receipts (id, org_id, procurement_id, gr_number, status) values
  ('25250000-0000-0000-0000-000000000021', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f1', 'GR-TWM-1', 'Partial'),
  ('25250000-0000-0000-0000-000000000022', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f1', 'GR-TWM-2', 'Partial');
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('25250000-0000-0000-0000-00000000000b', 'erpnext', 'procurement');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- A bill on p1 for p_amount (tax exclusive, zero tax), recorded by whoever is acting.
create or replace function pg_temp.bill(p_amount numeric) returns uuid language sql as $$
  select (create_procurement_invoice(
    p_procurement_id => '25250000-0000-0000-0000-0000000000f1', p_status => 'Received', p_invoice_date => current_date,
    p_amount => p_amount, p_tax_treatment => 'exclusive', p_tax_amount => 0)).id
$$;
create or replace function pg_temp.id(k text) returns uuid language sql as $$ select current_setting('twm.' || k)::uuid $$;
create or replace function pg_temp.status(k text) returns text language sql as $$ select get_bill_match(pg_temp.id(k))->>'status' $$;
create or replace function pg_temp.pay(p_amount numeric) returns uuid language sql as $$
  select (create_payment('25250000-0000-0000-0000-0000000000f1', null, null, null, current_date, p_amount)).id
$$;
create or replace function pg_temp.lines(p_item text, p_qty numeric, p_rate numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty, 'rate', p_rate))
$$;

-- ── Grants (AC-TWM-012) ────────────────────────────────────────────────────────────────────────────────────
select is(has_function_privilege('anon', 'public.approve_bill_match_exception(uuid,text)', 'EXECUTE')
       or has_function_privilege('anon', 'public.record_bill_match_lines(uuid,jsonb)', 'EXECUTE')
       or has_function_privilege('anon', 'public.get_bill_match(uuid)', 'EXECUTE'), false,
  'AC-TWM-012 anon cannot execute the three-way match RPCs');
select is(has_function_privilege('authenticated', 'public.bill_match_evaluate(uuid)', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.purchase_has_held_bill(uuid)', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.guard_payment_three_way_hold()', 'EXECUTE'), false,
  'AC-TWM-012 the evaluator and the gate are not client-executable');
select is(has_table_privilege('authenticated', 'public.bill_match_exceptions', 'INSERT')
       or has_table_privilege('authenticated', 'public.procurement_bill_match_lines', 'INSERT')
       or has_table_privilege('authenticated', 'public.procurement_receipt_lines', 'INSERT'), false,
  'AC-TWM-012 clients cannot write match rows directly');

-- ── AC-TWM-001: settings are Admin-only and range-checked ──────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a2');
select throws_ok($$ select set_three_way_match_settings(true, 5, 2) $$, '42501',
  'only an Admin sets the three-way match', 'AC-TWM-001 a Finance user cannot switch the match on');
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a1');
select throws_ok($$ select set_three_way_match_settings(true, 101, 2) $$, '22023', null,
  'AC-TWM-001 a tolerance above 100 percent is refused');
select throws_ok($$ select set_three_way_match_settings(true, 5, -1) $$, '22023', null,
  'AC-TWM-001 a negative tolerance is refused');
select lives_ok($$ select set_three_way_match_settings(true, 5, 2) $$, 'AC-TWM-001 an Admin switches the match on');
select is((select enabled_at is not null and quantity_tolerance_pct = 5 and amount_tolerance_pct = 2
             from org_three_way_match_settings where org_id = '25250000-0000-0000-0000-00000000000a'), true,
  'AC-TWM-001 the org''s tolerances and switch-on time are stored');

-- ── Receipt lines (FR-TWM-004) ──────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a4');
select lives_ok($$ select record_receipt_match_lines('25250000-0000-0000-0000-000000000021',
  '[{"item_id":"25250000-0000-0000-0000-000000000011","quantity":60}]'::jsonb) $$,
  'AC-TWM-004 a Project Manager records 60 cement received');
select throws_ok($$ select record_receipt_match_lines('25250000-0000-0000-0000-000000000022',
  '[{"item_id":"25250000-0000-0000-0000-000000000031","quantity":1}]'::jsonb) $$, '22023',
  'a receipt line names an item that is not on this purchase', 'AC-TWM-004 an item of another purchase is refused');
select throws_ok($$ select record_receipt_match_lines('25250000-0000-0000-0000-000000000022',
  '[{"item_id":"25250000-0000-0000-0000-000000000011","quantity":"lots"}]'::jsonb) $$, '22023', null,
  'AC-TWM-004 an unreadable quantity is refused');
select throws_ok($$ select record_receipt_match_lines('25250000-0000-0000-0000-000000000022',
  '[{"item_id":"25250000-0000-0000-0000-000000000011","quantity":1},{"item_id":"25250000-0000-0000-0000-000000000011","quantity":2}]'::jsonb) $$,
  '22023', null, 'AC-TWM-004 an item named twice is refused');
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a5');
select throws_ok($$ select record_receipt_match_lines('25250000-0000-0000-0000-000000000022',
  '[{"item_id":"25250000-0000-0000-0000-000000000011","quantity":1}]'::jsonb) $$, '42501', 'not authorized',
  'AC-TWM-004 an Engineer cannot record receipt lines');

-- ── AC-TWM-002 / AC-TWM-003: a bill with no lines, then over the received quantity, is held ────────────────
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a2');
select set_config('twm.bill1', pg_temp.bill(80000)::text, true);
select is(pg_temp.status('bill1'), 'held', 'AC-TWM-006 a bill with no match lines is held');
select is(get_bill_match(pg_temp.id('bill1'))->'reasons', '["no_lines"]'::jsonb, 'AC-TWM-006 the reason is no lines');
select throws_ok($$ select pg_temp.pay(1000) $$, 'MH001', null, 'AC-TWM-002 no payment is added while a bill is held');
select lives_ok($$ select record_bill_match_lines(pg_temp.id('bill1'),
  pg_temp.lines('25250000-0000-0000-0000-000000000011', 80, 1000)) $$, 'AC-TWM-002 the author records 80 cement billed');
select is(pg_temp.status('bill1'), 'held', 'AC-TWM-002 a bill over the received quantity (80 billed, 60 received) is held');
select is(get_bill_match(pg_temp.id('bill1'))->'lines'->0->'reasons', '["over_received"]'::jsonb,
  'AC-TWM-002 the line names over-received as its reason');
select throws_ok($$ select pg_temp.pay(1000) $$, 'MH001', null, 'AC-TWM-002 the held bill cannot move to payment');
reset role;
select throws_ok($$ insert into payments (procurement_id, status, amount) values ('25250000-0000-0000-0000-0000000000f1', 'Scheduled', 1) $$,
  'MH001', null, 'AC-TWM-002 a direct payment write is held too');
set local role authenticated;

-- ── AC-TWM-007: the receipt arriving releases the hold by itself ────────────────────────────────────────────
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a4');
select lives_ok($$ select record_receipt_match_lines('25250000-0000-0000-0000-000000000022',
  '[{"item_id":"25250000-0000-0000-0000-000000000011","quantity":20},{"item_id":"25250000-0000-0000-0000-000000000012","quantity":10}]'::jsonb) $$,
  'AC-TWM-007 the second receipt brings 20 cement and 10 steel');
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a2');
select is(pg_temp.status('bill1'), 'matched', 'AC-TWM-003 billed 80, received 80, ordered 100 at the order rate: matched');
select lives_ok($$ select pg_temp.pay(1000) $$, 'AC-TWM-003 a matched bill moves to payment');

-- ── AC-TWM-004: quantity tolerance, cumulative by bill order ────────────────────────────────────────────────
select set_config('twm.bill2', pg_temp.bill(3000)::text, true);
select lives_ok($$ select record_bill_match_lines(pg_temp.id('bill2'), pg_temp.lines('25250000-0000-0000-0000-000000000011', 3, 1000)) $$,
  'AC-TWM-004 bill2 bills 3 more cement (83 against 80 received)');
select is(pg_temp.status('bill2'), 'matched', 'AC-TWM-004 83 billed is within 5 percent of 80 received: matched');
select set_config('twm.bill3', pg_temp.bill(2000)::text, true);
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a3');
select lives_ok($$ select record_bill_match_lines(pg_temp.id('bill3'), pg_temp.lines('25250000-0000-0000-0000-000000000011', 2, 1000)) $$,
  'AC-TWM-004 a second Finance user records bill3''s lines: 2 more cement (85)');
select is(pg_temp.status('bill3'), 'held', 'AC-TWM-004 85 billed is beyond 5 percent of 80 received: held');
select is(pg_temp.status('bill2'), 'matched', 'AC-TWM-004 a later over-bill never holds an earlier bill');

-- ── AC-TWM-005: price and amount ───────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a2');
select set_config('twm.bill4', pg_temp.bill(52000)::text, true);
select record_bill_match_lines(pg_temp.id('bill4'), pg_temp.lines('25250000-0000-0000-0000-000000000012', 1, 52000));
select is(get_bill_match(pg_temp.id('bill4'))->'lines'->0->'reasons', '["price_variance"]'::jsonb,
  'AC-TWM-005 a rate 4 percent over the order rate (tolerance 2) is a price variance');
select set_config('twm.bill5', pg_temp.bill(60000)::text, true);
select record_bill_match_lines(pg_temp.id('bill5'), pg_temp.lines('25250000-0000-0000-0000-000000000012', 1, 50000));
select is(get_bill_match(pg_temp.id('bill5'))->'reasons', '["amount_mismatch"]'::jsonb,
  'AC-TWM-005 a bill amount 10,000 off its lines is an amount mismatch');
select is(pg_temp.status('bill5'), 'held', 'AC-TWM-005 the amount mismatch holds the bill');

-- ── AC-TWM-011: every route to payment is held ─────────────────────────────────────────────────────────────
select throws_ok($$ select pg_temp.pay(1000) $$, 'MH001', null, 'AC-TWM-011 no payment while bills 3-5 are held');
reset role;
select throws_ok($$ update procurement_invoices set status = 'Paid' where id = current_setting('twm.bill3')::uuid $$,
  'MH001', null, 'AC-TWM-011 a held bill is not marked paid');
select throws_ok($$ update procurements set status = 'Paid' where id = '25250000-0000-0000-0000-0000000000f1' $$,
  'MH001', null, 'AC-TWM-011 the purchase is not moved to paid while it has a held bill');
select throws_ok($$ update payments set status = 'Paid' where procurement_id = '25250000-0000-0000-0000-0000000000f1' $$,
  'MH001', null, 'AC-TWM-011 an earlier scheduled payment is not paid while a bill is held');
set local role authenticated;

-- ── AC-TWM-008 / AC-TWM-009: the exception — role, reason, SoD ─────────────────────────────────────────────
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a2');
select throws_ok($$ select approve_bill_match_exception(pg_temp.id('bill3'), 'agreed with the vendor') $$, '42501',
  'separation of duties: the person who recorded this bill or its lines cannot approve its exception',
  'AC-TWM-009 the bill''s author cannot approve its exception');
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a3');
select throws_ok($$ select approve_bill_match_exception(pg_temp.id('bill3'), 'agreed with the vendor') $$, '42501',
  'separation of duties: the person who recorded this bill or its lines cannot approve its exception',
  'AC-TWM-009 the person who recorded the bill''s lines cannot approve its exception');
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a6');
select throws_ok($$ select approve_bill_match_exception(pg_temp.id('bill3'), 'agreed with the vendor') $$, '42501',
  'not authorized', 'AC-TWM-008 an Executive cannot approve an exception');
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a4');
select throws_ok($$ select approve_bill_match_exception(pg_temp.id('bill3'), 'agreed with the vendor') $$, '42501',
  'not authorized', 'AC-TWM-008 a Project Manager cannot approve an exception');
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a1');
select throws_ok($$ select approve_bill_match_exception(pg_temp.id('bill3'), '   ') $$, '22023', null,
  'AC-TWM-008 an exception needs a reason');
select throws_ok($$ select approve_bill_match_exception(pg_temp.id('bill2'), 'not needed') $$, 'MH002', null,
  'AC-TWM-008 a matched bill has no exception to approve');
select is(approve_bill_match_exception(pg_temp.id('bill3'), 'extra cement delivered on site, receipt to follow')->>'status',
  'exception_approved', 'AC-TWM-008 an Admin who neither recorded the bill nor its lines approves the exception');
select is((select approved_by::text || '|' || reason from bill_match_exceptions where invoice_id = pg_temp.id('bill3')),
  '25250000-0000-0000-0000-0000000000a1|extra cement delivered on site, receipt to follow',
  'AC-TWM-008 the approval records who and why');
select is((select match->>'status' from bill_match_exceptions where invoice_id = pg_temp.id('bill3')), 'held',
  'AC-TWM-008 the approval keeps the match as it stood');
reset role;
select is((select count(*)::int from audit_events where entity_id = current_setting('twm.bill3')::uuid
             and action = 'procurement_invoice.match_exception' and actor_id = '25250000-0000-0000-0000-0000000000a1'), 1,
  'AC-TWM-008 the approval is audited');
select throws_ok($$ update bill_match_exceptions set reason = 'changed' $$, '42501', null,
  'AC-TWM-008 an approved exception cannot be edited');
select throws_ok($$ delete from bill_match_exceptions $$, '42501', null, 'AC-TWM-008 an approved exception cannot be removed');
set local role authenticated;
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a3');
select throws_ok($$ select record_bill_match_lines(pg_temp.id('bill3'), pg_temp.lines('25250000-0000-0000-0000-000000000011', 9, 1000)) $$,
  '23514', null, 'AC-TWM-008 the approval froze the bill''s lines');
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a1');
select throws_ok($$ select approve_bill_match_exception(pg_temp.id('bill3'), 'again') $$, '23505', null,
  'AC-TWM-008 a bill''s exception is approved once');

-- Bills 4 and 5 (author and lines Fin1): Fin2 approves. Then the purchase moves to payment again.
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a3');
select lives_ok($$ select approve_bill_match_exception(pg_temp.id('bill4'), 'price rise agreed in writing') $$,
  'AC-TWM-008 a Finance user who did not record bill4 approves its exception');
select lives_ok($$ select approve_bill_match_exception(pg_temp.id('bill5'), 'freight billed on the same bill') $$,
  'AC-TWM-008 and bill5''s');
select lives_ok($$ select pg_temp.pay(1000) $$, 'AC-TWM-008 with every exception approved the purchase moves to payment');

-- ── AC-TWM-009: the author is unknown → fail closed ────────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);   -- no acting user: the create audit records no author
insert into procurement_invoices (id, org_id, procurement_id, status, amount, tax_treatment, tax_amount) values
  ('25250000-0000-0000-0000-000000000033', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f3',
   'Received', 1000, 'exclusive', 0);
set local role authenticated;
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a1');
select throws_ok($$ select approve_bill_match_exception('25250000-0000-0000-0000-000000000033', 'unknown author') $$, '42501',
  'the author of this bill is not recorded; its exception cannot be approved',
  'AC-TWM-009 an exception is refused when the bill''s author is not recorded');

-- ── AC-TWM-010: scope — what the match leaves alone ────────────────────────────────────────────────────────
reset role;
insert into procurement_invoices (id, org_id, procurement_id, status, amount, tax_treatment, tax_amount, created_at) values
  ('25250000-0000-0000-0000-000000000034', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f3',
   'Received', 1000, 'exclusive', 0, now() - interval '1 day'),
  ('25250000-0000-0000-0000-000000000035', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f2',
   'Received', 1000, 'exclusive', 0, now()),
  ('25250000-0000-0000-0000-000000000036', '25250000-0000-0000-0000-00000000000b', '25250000-0000-0000-0000-0000000000fb',
   'Received', 1000, 'exclusive', 0, now()),
  ('25250000-0000-0000-0000-000000000037', '25250000-0000-0000-0000-00000000000c', '25250000-0000-0000-0000-0000000000fc',
   'Received', 1000, 'exclusive', 0, now());
insert into org_three_way_match_settings (org_id, enabled, enabled_at, updated_by) values
  ('25250000-0000-0000-0000-00000000000b', true, now(), '25250000-0000-0000-0000-0000000000b1');
select is(bill_match_evaluate('25250000-0000-0000-0000-000000000034')->>'status', 'not_applicable',
  'AC-TWM-010 a bill recorded before the match was switched on is not matched');
select is(bill_match_evaluate('25250000-0000-0000-0000-000000000035')->>'status', 'not_applicable',
  'AC-TWM-010 a subcontract bill keeps its own cap and is not matched');
select is(bill_match_evaluate('25250000-0000-0000-0000-000000000036')->>'status', 'not_applicable',
  'AC-TWM-010 an organisation whose ERP owns purchasing keeps its current behaviour even with the match on');
select is(bill_match_evaluate('25250000-0000-0000-0000-000000000037')->>'status', 'not_applicable',
  'AC-TWM-010 an organisation that never switched the match on is unaffected');
select lives_ok($$ insert into payments (procurement_id, status, amount) values ('25250000-0000-0000-0000-0000000000fb', 'Scheduled', 1) $$,
  'AC-TWM-010 the ERP organisation''s payment writes are not gated');
set local role authenticated;
select pg_temp.act_as('25250000-0000-0000-0000-0000000000c1');
select lives_ok($$ select create_payment('25250000-0000-0000-0000-0000000000fc', null, null, null, current_date, 500) $$,
  'AC-TWM-010 an organisation without the match pays a bill with no lines as before');

-- ── AC-TWM-012: tenancy and read roles ─────────────────────────────────────────────────────────────────────
select pg_temp.act_as('25250000-0000-0000-0000-0000000000b1');
select throws_ok($$ select get_bill_match(pg_temp.id('bill1')) $$, 'P0002', null, 'AC-TWM-012 another org cannot read a bill''s match');
select throws_ok($$ select approve_bill_match_exception(pg_temp.id('bill1'), 'x') $$, 'P0002', null,
  'AC-TWM-012 another org cannot approve an exception');
select is((select count(*)::int from procurement_bill_match_lines) + (select count(*)::int from bill_match_exceptions)
          + (select count(*)::int from procurement_receipt_lines), 0, 'AC-TWM-012 another org sees no match rows');
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a5');
select throws_ok($$ select get_bill_match(pg_temp.id('bill1')) $$, '42501', 'not authorized',
  'AC-TWM-012 an Engineer cannot read bill matches');

select * from finish();
rollback;
