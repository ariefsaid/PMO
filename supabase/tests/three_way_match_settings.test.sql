-- #2634: three-way match — the Admin setting, the edit states of the line writers, and clearing a hold by editing lines
-- (AC-TWM-017..020). Spec docs/specs/three-way-match.spec.md section 7 · Plan docs/plans/2026-11-21-bill-match-settings.md.
-- Migration under test: 1357_three_way_match_edit_states.sql (over 1018). The mutation check is
-- three_way_match_edit_mutation.test.sql. Org A: Admin, two Finance, PM, Engineer, Executive. Org B: one Admin.
begin;
create extension if not exists pgtap;
select plan(40);

insert into organizations (id, name, default_currency) values
  ('26340000-0000-0000-0000-00000000000a', 'TWS Org',  'IDR'),
  ('26340000-0000-0000-0000-00000000000b', 'TWS Org B', 'IDR');
insert into auth.users (id, email) values
  ('26340000-0000-0000-0000-0000000000a1', 'tws-admin@example.com'),
  ('26340000-0000-0000-0000-0000000000a2', 'tws-fin1@example.com'),
  ('26340000-0000-0000-0000-0000000000a3', 'tws-fin2@example.com'),
  ('26340000-0000-0000-0000-0000000000a4', 'tws-pm@example.com'),
  ('26340000-0000-0000-0000-0000000000a5', 'tws-eng@example.com'),
  ('26340000-0000-0000-0000-0000000000a6', 'tws-exec@example.com'),
  ('26340000-0000-0000-0000-0000000000b1', 'tws-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26340000-0000-0000-0000-0000000000a1', '26340000-0000-0000-0000-00000000000a', 'TWS Admin', 'tws-admin@example.com', 'Admin', 'active'),
  ('26340000-0000-0000-0000-0000000000a2', '26340000-0000-0000-0000-00000000000a', 'TWS Fin1',  'tws-fin1@example.com',  'Finance', 'active'),
  ('26340000-0000-0000-0000-0000000000a3', '26340000-0000-0000-0000-00000000000a', 'TWS Fin2',  'tws-fin2@example.com',  'Finance', 'active'),
  ('26340000-0000-0000-0000-0000000000a4', '26340000-0000-0000-0000-00000000000a', 'TWS PM',    'tws-pm@example.com',    'Project Manager', 'active'),
  ('26340000-0000-0000-0000-0000000000a5', '26340000-0000-0000-0000-00000000000a', 'TWS Eng',   'tws-eng@example.com',   'Engineer', 'active'),
  ('26340000-0000-0000-0000-0000000000a6', '26340000-0000-0000-0000-00000000000a', 'TWS Exec',  'tws-exec@example.com',  'Executive', 'active'),
  ('26340000-0000-0000-0000-0000000000b1', '26340000-0000-0000-0000-00000000000b', 'TWS B Admin', 'tws-b-admin@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status) values
  ('26340000-0000-0000-0000-0000000000d1', '26340000-0000-0000-0000-00000000000a', 'TWS Site', 'Ongoing Project');
-- p1 and p4: goods purchases (two held-bill scenarios). p2 Paid and p3 Cancelled purchases. p5: open purchase with a Paid bill.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('26340000-0000-0000-0000-0000000000f1', '26340000-0000-0000-0000-00000000000a', 'TWS p1', '26340000-0000-0000-0000-0000000000d1',
   '26340000-0000-0000-0000-0000000000a4', 'Vendor Invoiced', 600000, 600000, '26340000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false),
  ('26340000-0000-0000-0000-0000000000f4', '26340000-0000-0000-0000-00000000000a', 'TWS p4', '26340000-0000-0000-0000-0000000000d1',
   '26340000-0000-0000-0000-0000000000a4', 'Vendor Invoiced', 600000, 600000, '26340000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false),
  ('26340000-0000-0000-0000-0000000000f2', '26340000-0000-0000-0000-00000000000a', 'TWS p2 paid', '26340000-0000-0000-0000-0000000000d1',
   '26340000-0000-0000-0000-0000000000a4', 'Vendor Invoiced', 100000, 100000, '26340000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false),
  ('26340000-0000-0000-0000-0000000000f3', '26340000-0000-0000-0000-00000000000a', 'TWS p3 cancelled', '26340000-0000-0000-0000-0000000000d1',
   '26340000-0000-0000-0000-0000000000a4', 'Vendor Invoiced', 100000, 100000, '26340000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false),
  ('26340000-0000-0000-0000-0000000000f5', '26340000-0000-0000-0000-00000000000a', 'TWS p5 paid bill', '26340000-0000-0000-0000-0000000000d1',
   '26340000-0000-0000-0000-0000000000a4', 'Vendor Invoiced', 100000, 100000, '26340000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false);
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate)
select ('26340000-0000-0000-0000-0000000001' || right(p, 2))::uuid, '26340000-0000-0000-0000-00000000000a',
       ('26340000-0000-0000-0000-0000000000' || p)::uuid, 'Cement', 100, 1000
  from (values ('f1'), ('f4'), ('f2'), ('f3'), ('f5')) v(p);
insert into procurement_receipts (id, org_id, procurement_id, gr_number, status)
select ('26340000-0000-0000-0000-0000000002' || right(p, 2))::uuid, '26340000-0000-0000-0000-00000000000a',
       ('26340000-0000-0000-0000-0000000000' || p)::uuid, 'GR-TWS-' || p, 'Partial'
  from (values ('f1'), ('f4'), ('f2'), ('f3')) v(p);
-- Move p2 to Paid and p3 to Cancelled after their receipts exist (direct writes as the owner; no held bill, match not yet on).
update procurements set status = 'Paid' where id = '26340000-0000-0000-0000-0000000000f2';
update procurements set status = 'Cancelled' where id = '26340000-0000-0000-0000-0000000000f3';
-- A Paid bill on the open purchase p5, recorded before the match is switched on.
insert into procurement_invoices (id, org_id, procurement_id, status, amount, tax_treatment, tax_amount, created_at) values
  ('26340000-0000-0000-0000-000000000351', '26340000-0000-0000-0000-00000000000a', '26340000-0000-0000-0000-0000000000f5', 'Paid', 1000, 'exclusive', 0, now() - interval '1 day');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.bill(p_proc text, p_amount numeric) returns uuid language sql as $$
  select (create_procurement_invoice(
    p_procurement_id => ('26340000-0000-0000-0000-0000000000' || p_proc)::uuid, p_status => 'Received',
    p_invoice_date => current_date, p_amount => p_amount, p_tax_treatment => 'exclusive', p_tax_amount => 0)).id
$$;
create or replace function pg_temp.id(k text) returns uuid language sql as $$ select current_setting('tws.' || k)::uuid $$;
create or replace function pg_temp.status(k text) returns text language sql as $$ select get_bill_match(pg_temp.id(k))->>'status' $$;
create or replace function pg_temp.lines(p_item text, p_qty numeric, p_rate numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty, 'rate', p_rate))
$$;
create or replace function pg_temp.rcpt(p_item text, p_qty numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty))
$$;

-- ── AC-TWM-017: the setting is Admin-only, tenant-scoped, audited ───────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a6');
select throws_ok($$ select set_three_way_match_settings(true, 0, 0) $$, '42501', 'only an Admin sets the three-way match',
  'AC-TWM-017 an Executive cannot set the match');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a4');
select throws_ok($$ select set_three_way_match_settings(true, 0, 0) $$, '42501', 'only an Admin sets the three-way match',
  'AC-TWM-017 a Project Manager cannot set the match');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a2');
select throws_ok($$ select set_three_way_match_settings(true, 0, 0) $$, '42501', 'only an Admin sets the three-way match',
  'AC-TWM-017 a Finance user cannot set the match');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a5');
select throws_ok($$ select set_three_way_match_settings(true, 0, 0) $$, '42501', 'only an Admin sets the three-way match',
  'AC-TWM-017 an Engineer cannot set the match');
select throws_ok($$ select three_way_match_held_count() $$, '42501', 'only an Admin sees the held bill count',
  'AC-TWM-017 an Engineer cannot read the held count');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a2');
select throws_ok($$ select three_way_match_held_count() $$, '42501', 'only an Admin sees the held bill count',
  'AC-TWM-017 a Finance user cannot read the held count');
reset role;
select is((select count(*)::int from org_three_way_match_settings), 0, 'AC-TWM-017 refused writes left no settings row');
set local role authenticated;
select pg_temp.act_as('26340000-0000-0000-0000-0000000000b1');
select lives_ok($$ select set_three_way_match_settings(true, 3, 3) $$, 'AC-TWM-017 the other organisation''s Admin sets their own match');
select is((select count(*)::int from org_three_way_match_settings), 1, 'AC-TWM-017 they see only their own organisation''s row');
select is(three_way_match_held_count(), 0, 'AC-TWM-017 their held count is their own (zero)');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from org_three_way_match_settings), 0, 'AC-TWM-017 org A sees no setting yet (the match is off)');
select lives_ok($$ select set_three_way_match_settings(true, 0, 0) $$, 'AC-TWM-017 the Admin switches org A''s match on');
select is((select quantity_tolerance_pct || '/' || amount_tolerance_pct || '/' || (enabled_at is not null)::text
             from org_three_way_match_settings), '0.00/0.00/true', 'AC-TWM-017 org A stores its own tolerances and switch-on time');
reset role;
select is((select quantity_tolerance_pct from org_three_way_match_settings where org_id = '26340000-0000-0000-0000-00000000000b'), 3.00,
  'AC-TWM-017 org B''s row is untouched by org A''s Admin');
select is((select count(*)::int from audit_events where action = 'three_way_match.settings'
             and actor_id = '26340000-0000-0000-0000-0000000000a1' and org_id = '26340000-0000-0000-0000-00000000000a'), 1,
  'AC-TWM-017 the Admin''s change is audited');

-- ── AC-TWM-019: a held bill clears by editing lines, with no exception ──────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a4');
select lives_ok($$ select record_receipt_match_lines('26340000-0000-0000-0000-0000000002f1',
  pg_temp.rcpt('26340000-0000-0000-0000-0000000001f1', 60)) $$, 'AC-TWM-019 a Project Manager records 60 received on p1');
select lives_ok($$ select record_receipt_match_lines('26340000-0000-0000-0000-0000000002f4',
  pg_temp.rcpt('26340000-0000-0000-0000-0000000001f4', 60)) $$, 'AC-TWM-019 and 60 received on p4');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a2');
select set_config('tws.billA', pg_temp.bill('f1', 60000)::text, true);
select record_bill_match_lines(pg_temp.id('billA'), pg_temp.lines('26340000-0000-0000-0000-0000000001f1', 80, 1000));
select is(pg_temp.status('billA'), 'held', 'AC-TWM-019 billA (80 billed, 60 received, amount off its lines) is held');
select set_config('tws.billB', pg_temp.bill('f4', 80000)::text, true);
select record_bill_match_lines(pg_temp.id('billB'), pg_temp.lines('26340000-0000-0000-0000-0000000001f4', 80, 1000));
select is(pg_temp.status('billB'), 'held', 'AC-TWM-019 billB (80 billed, 60 received) is held');
select throws_ok($$ select create_payment('26340000-0000-0000-0000-0000000000f1', null, null, null, current_date, 1000) $$,
  'MH001', null, 'AC-TWM-019 no payment on p1 while billA is held');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a1');
select is(three_way_match_held_count(), 2, 'AC-TWM-017 the Admin''s held count names both held bills');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a2');
select lives_ok($$ select record_bill_match_lines(pg_temp.id('billA'), pg_temp.lines('26340000-0000-0000-0000-0000000001f1', 60, 1000)) $$,
  'AC-TWM-019 the bill''s lines are corrected to 60');
select is(pg_temp.status('billA'), 'matched', 'AC-TWM-019 billA is matched after the correction');
select lives_ok($$ select create_payment('26340000-0000-0000-0000-0000000000f1', null, null, null, current_date, 1000) $$,
  'AC-TWM-019 the purchase can be paid, with no exception');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a4');
select lives_ok($$ select record_receipt_match_lines('26340000-0000-0000-0000-0000000002f4',
  pg_temp.rcpt('26340000-0000-0000-0000-0000000001f4', 80)) $$, 'AC-TWM-019 the receipt is raised to 80');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a2');
select is(pg_temp.status('billB'), 'matched', 'AC-TWM-019 billB is matched once the receipt covers it');
select lives_ok($$ select create_payment('26340000-0000-0000-0000-0000000000f4', null, null, null, current_date, 1000) $$,
  'AC-TWM-019 p4 can be paid, with no exception');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a1');
select is(three_way_match_held_count(), 0, 'AC-TWM-017 the held count falls to zero');
reset role;
select is((select count(*)::int from bill_match_exceptions), 0, 'AC-TWM-019 neither hold was cleared by an exception');
set local role authenticated;

-- ── AC-TWM-018: lines of posted bills and closed purchases do not change ────────────────────────────────────
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a2');
select throws_ok($$ select record_bill_match_lines('26340000-0000-0000-0000-000000000351',
  pg_temp.lines('26340000-0000-0000-0000-0000000001f5', 1, 1000)) $$, '23514', 'this bill is paid; its lines cannot change',
  'AC-TWM-018 a Paid bill''s lines cannot be recorded');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a4');
select throws_ok($$ select record_receipt_match_lines('26340000-0000-0000-0000-0000000002f2',
  pg_temp.rcpt('26340000-0000-0000-0000-0000000001f2', 5)) $$, '23514', 'this purchase is closed; its receipt lines cannot change',
  'AC-TWM-018 a Paid purchase''s receipt lines cannot be recorded');
select throws_ok($$ select record_receipt_match_lines('26340000-0000-0000-0000-0000000002f3',
  pg_temp.rcpt('26340000-0000-0000-0000-0000000001f3', 5)) $$, '23514', 'this purchase is closed; its receipt lines cannot change',
  'AC-TWM-018 a Cancelled purchase''s receipt lines cannot be recorded');
reset role;
select is((select count(*)::int from procurement_bill_match_lines where invoice_id = '26340000-0000-0000-0000-000000000351')
        + (select count(*)::int from procurement_receipt_lines where receipt_id in
             ('26340000-0000-0000-0000-0000000002f2', '26340000-0000-0000-0000-0000000002f3')), 0,
  'AC-TWM-018 the refused writes changed nothing');
select is((select count(*)::int from procurement_receipt_lines where receipt_id = '26340000-0000-0000-0000-0000000002f1'), 1,
  'AC-TWM-018 an open purchase''s receipt lines stay editable (the control is the edit state, not a blanket refusal)');

-- ── AC-TWM-020: whoever re-records a bill''s lines becomes their recorder; the edit is audited before and after ─
set local role authenticated;
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a2');
select set_config('tws.billC', pg_temp.bill('f1', 10000)::text, true);
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a1');
select record_bill_match_lines(pg_temp.id('billC'), pg_temp.lines('26340000-0000-0000-0000-0000000001f1', 10, 1000));
select is(pg_temp.status('billC'), 'held', 'AC-TWM-020 billC (70 billed, 60 received) is held');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a3');
select record_bill_match_lines(pg_temp.id('billC'), pg_temp.lines('26340000-0000-0000-0000-0000000001f1', 10, 1000));
select throws_ok($$ select approve_bill_match_exception(pg_temp.id('billC'), 'agreed with the vendor') $$, '42501',
  'separation of duties: the person who recorded this bill or its lines cannot approve its exception',
  'AC-TWM-020 the person who last re-recorded the lines cannot approve');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a2');
select throws_ok($$ select approve_bill_match_exception(pg_temp.id('billC'), 'agreed with the vendor') $$, '42501', null,
  'AC-TWM-020 the author still cannot approve');
select pg_temp.act_as('26340000-0000-0000-0000-0000000000a1');
select lives_ok($$ select approve_bill_match_exception(pg_temp.id('billC'), 'agreed with the vendor') $$,
  'AC-TWM-020 the first recorder, no longer the recorder, may approve');
reset role;
select is((select count(*)::int from audit_events where entity_id = current_setting('tws.billC')::uuid
             and action = 'procurement_invoice.match_lines' and jsonb_array_length(detail->'before') = 1
             and jsonb_array_length(detail->'lines') = 1), 1,
  'AC-TWM-020 the second recording is audited with the lines before and after');
select is((select count(*)::int from audit_events where entity_id = '26340000-0000-0000-0000-0000000002f4'
             and action = 'procurement_receipt.match_lines' and jsonb_array_length(detail->'before') = 1), 1,
  'AC-TWM-020 the receipt edit is audited with the lines before (no SoD on receipts: the audit is the control)');

select * from finish();
rollback;
