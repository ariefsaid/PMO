-- 0441_work_order_milestones.test.sql — #1640 AC-WOMS-004..009: billing-milestone inputs and acceptance age.
-- Migration under test: 0441_work_order_acceptance_age.sql. Fixtures load with no JWT (a server load).
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name) values
  ('16400000-0000-0000-0000-000000000001', 'WOMS Org'),
  ('16400000-0000-0000-0000-000000000002', 'WOMS Other Org');
-- UTC-11 and UTC+14: at every hour at least one of these local dates differs from the UTC date, so a view that
-- counted days in UTC would fail test 3 or test 12 whenever it runs (AC-WOMS-005 "not UTC").
update organizations set default_timezone = 'Pacific/Pago_Pago' where id = '16400000-0000-0000-0000-000000000001';
update organizations set default_timezone = 'Pacific/Kiritimati' where id = '16400000-0000-0000-0000-000000000002';
insert into auth.users (id, email) values
  ('16400000-0000-0000-0000-0000000000a1', 'woms-fin@example.com'),
  ('16400000-0000-0000-0000-0000000000b1', 'woms-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16400000-0000-0000-0000-0000000000a1', '16400000-0000-0000-0000-000000000001', 'WOMS Fin', 'woms-fin@example.com', 'Finance', 'active'),
  ('16400000-0000-0000-0000-0000000000b1', '16400000-0000-0000-0000-000000000002', 'WOMS XOrg', 'woms-xorg@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('16400000-0000-0000-0000-0000000000f1', '16400000-0000-0000-0000-000000000001', 'WOMS Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-000000000001', 'WOMS P', 'Ongoing Project', 10000, 'exclusive', 0, '16400000-0000-0000-0000-0000000000f1'),
  ('16400000-0000-0000-0000-0000000000c9', '16400000-0000-0000-0000-000000000002', 'WOMS X', 'Ongoing Project', 10000, 'exclusive', 0, null);
-- d1 aged (only a draft and a Paid down payment); d2 invoiced after its BAST then a later BAST; d3 untotallable; d4 Draft;
-- d5 fully submitted; d6/d7 the Paid-vs-Unpaid pair; d8 undated submitted invoice; d9 other org.
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount) values
  ('16400000-0000-0000-0000-0000000000d1', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Aged',       'Issued', 'WO-M-1', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d2', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Restarted',  'Issued', 'WO-M-2', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d3', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'No total',   'Issued', 'WO-M-3', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d4', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Draft',      'Draft',  null,     1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d5', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'All billed', 'Issued', 'WO-M-5', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d6', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Unpaid',     'Issued', 'WO-M-6', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d7', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Paid',       'Issued', 'WO-M-7', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d8', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Undated',    'Issued', 'WO-M-8', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d9', '16400000-0000-0000-0000-000000000002', '16400000-0000-0000-0000-0000000000c9', 'X',          'Issued', 'WO-X-9', 1000, 'exclusive', 0);

-- Every date below is relative to the org-local today, written inline (no temp table: the reads run as
-- `authenticated`, which could not select a postgres-owned temp table), so the test never flakes on a UTC midnight.

insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis)
select v.id::uuid, v.org::uuid, v.project::uuid, v.wo::uuid, v.dt, false, v.status, v.who::uuid,
       case when v.status = 'Confirmed' then v.who::uuid end,
       case when v.status = 'Confirmed' then now() end,
       case when v.status = 'Confirmed' then 'sole_operator' end
  from (values
    ('16400000-0000-0000-0000-00000000e101', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d1', (now() at time zone 'Pacific/Pago_Pago')::date - 10, 'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e102', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d1', (now() at time zone 'Pacific/Pago_Pago')::date - 1,  'Draft', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e201', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d2', (now() at time zone 'Pacific/Pago_Pago')::date - 10, 'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e202', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d2', (now() at time zone 'Pacific/Pago_Pago')::date - 2,  'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e301', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d3', (now() at time zone 'Pacific/Pago_Pago')::date - 5,  'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e401', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d4', (now() at time zone 'Pacific/Pago_Pago')::date - 5,  'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e501', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d5', (now() at time zone 'Pacific/Pago_Pago')::date - 5,  'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e801', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d8', (now() at time zone 'Pacific/Pago_Pago')::date - 5,  'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e901', '16400000-0000-0000-0000-000000000002', '16400000-0000-0000-0000-0000000000c9', '16400000-0000-0000-0000-0000000000d9', (now() at time zone 'Pacific/Kiritimati')::date - 4, 'Confirmed', '16400000-0000-0000-0000-0000000000b1')
  ) as v(id, org, project, wo, dt, status, who);

-- d1: a Paid down-payment invoice does not stop the clock either (FR-WOMS-024). A down payment is an invoice that
-- reuses a down_payment claim's id (0262 §1); same shape as 0262_work_order_billing_figures.test.sql e4.
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, down_payment_amount,
                             recovery_pct, dp_recovery_amount, dp_item_code, created_by, withdrawn_by, withdrawn_at) values
  ('16400000-0000-0000-0000-0000000005a2', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d1',
   'down_payment', 'USD', 100, 100, 10, 0, 'DP-ITEM', '16400000-0000-0000-0000-0000000000a1', null, null);

insert into sales_invoices (id, org_id, project_id, customer_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
select v.id::uuid, '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000f1', v.wo::uuid, v.dt, v.amount, 'exclusive', 0, 'USD', v.status
  from (values
    -- d1: a Draft does not stop the clock (FR-WOMS-024).
    ('16400000-0000-0000-0000-0000000005a1', '16400000-0000-0000-0000-0000000000d1', (now() at time zone 'Pacific/Pago_Pago')::date - 3, 200::numeric, 'Draft'),
    ('16400000-0000-0000-0000-0000000005a2', '16400000-0000-0000-0000-0000000000d1', (now() at time zone 'Pacific/Pago_Pago')::date - 3, 100::numeric, 'Paid'),
    -- d2: submitted 5 days ago, after the 10-day BAST and before the 2-day BAST.
    ('16400000-0000-0000-0000-0000000005b1', '16400000-0000-0000-0000-0000000000d2', (now() at time zone 'Pacific/Pago_Pago')::date - 5, 300::numeric, 'Unpaid'),
    -- d3: an invoice with no amount makes the WO untotallable.
    ('16400000-0000-0000-0000-0000000005c1', '16400000-0000-0000-0000-0000000000d3', (now() at time zone 'Pacific/Pago_Pago')::date - 9, null::numeric, 'Unpaid'),
    -- d5: fully submitted (remaining 0, pending 0) but dated before the BAST.
    ('16400000-0000-0000-0000-0000000005e1', '16400000-0000-0000-0000-0000000000d5', (now() at time zone 'Pacific/Pago_Pago')::date - 9, 1000::numeric, 'Unpaid'),
    -- d6/d7: the same full invoice, Unpaid vs Paid (the state a recorded payment leaves: 0275 restate / ERP read-back).
    ('16400000-0000-0000-0000-0000000005f1', '16400000-0000-0000-0000-0000000000d6', (now() at time zone 'Pacific/Pago_Pago')::date - 9, 1000::numeric, 'Unpaid'),
    ('16400000-0000-0000-0000-0000000005f2', '16400000-0000-0000-0000-0000000000d7', (now() at time zone 'Pacific/Pago_Pago')::date - 9, 1000::numeric, 'Paid'),
    -- d8: a submitted invoice with no invoice date stops every clock.
    ('16400000-0000-0000-0000-0000000005f3', '16400000-0000-0000-0000-0000000000d8', null::date, 100::numeric, 'Unpaid')
  ) as v(id, wo, dt, amount, status);

set local role authenticated;
set local request.jwt.claims = '{"sub":"16400000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select ok((select unpaid_count = 1 and remaining = 0 and pending = 0 from work_order_billing where work_order_id = '16400000-0000-0000-0000-0000000000d6'),
  'AC-WOMS-004 a fully invoiced work order with an Unpaid invoice has one unpaid, nothing left, nothing pending (reads Invoiced)');   -- 1
select ok((select unpaid_count = 0 and remaining = 0 and pending = 0 from work_order_billing where work_order_id = '16400000-0000-0000-0000-0000000000d7'),
  'AC-WOMS-004 once that invoice is Paid nothing is unpaid, left or pending (reads Paid)');                                       -- 2
select is((select days from work_order_uninvoiced_acceptance where work_order_id = '16400000-0000-0000-0000-0000000000d1'), 10,
  'AC-WOMS-005 days since the confirmed BAST, counted in the organisation''s time zone; a Draft BAST, a draft invoice and a Paid down payment change nothing');  -- 3
select is((select anchor_date from work_order_uninvoiced_acceptance where work_order_id = '16400000-0000-0000-0000-0000000000d1'), (now() at time zone 'Pacific/Pago_Pago')::date - 10,
  'AC-WOMS-005 the anchor is the confirmed BAST''s acceptance date');                                                                     -- 4
select is((select days from work_order_uninvoiced_acceptance where work_order_id = '16400000-0000-0000-0000-0000000000d2'), 2,
  'AC-WOMS-006 an invoice submitted after a BAST satisfies it; a later BAST starts a new clock');                                         -- 5
select is((select count(*)::int from work_order_uninvoiced_acceptance where work_order_id = '16400000-0000-0000-0000-0000000000d8'), 0,
  'AC-WOMS-006 a submitted invoice with no invoice date stops every clock');                                                              -- 6
select is((select count(*)::int from work_order_uninvoiced_acceptance where work_order_id in (
  '16400000-0000-0000-0000-0000000000d3', '16400000-0000-0000-0000-0000000000d4', '16400000-0000-0000-0000-0000000000d5')), 0,
  'AC-WOMS-007 no age on an untotallable, Draft, or fully submitted work order, each with a confirmed BAST');                                                         -- 7
select is((select count(*)::int from work_order_uninvoiced_acceptance where org_id <> '16400000-0000-0000-0000-000000000001'), 0,
  'AC-WOMS-008 a user reads only their own organisation''s ages');                                                                        -- 8
select is((select (r ->> 'days_since_acceptance')::int from jsonb_array_elements(public.get_unbilled_work_orders(8) -> 'rows') r
            where r ->> 'wo_number' = 'WO-M-1'), 10,
  'AC-WOMS-009 the still-to-invoice rows carry the same days since acceptance');                                                          -- 9
select ok((select r -> 'days_since_acceptance' = 'null'::jsonb from jsonb_array_elements(public.get_unbilled_work_orders(8) -> 'rows') r
            where r ->> 'wo_number' = 'WO-M-8'),
  'AC-WOMS-009 a row with no acceptance age carries null');                                                                               -- 10
select ok((select bool_and(r ? 'days_since_closed') from jsonb_array_elements(public.get_unbilled_work_orders(8) -> 'rows') r),
  'AC-WOMS-009 days since closed is still returned on every row');                                                                        -- 11
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"16400000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select string_agg(work_order_id::text || ':' || days, ',') from work_order_uninvoiced_acceptance), '16400000-0000-0000-0000-0000000000d9:4',
  'AC-WOMS-008 the other organisation sees only its own work order, aged in its own time zone (AC-WOMS-005)');                                                                     -- 12
reset role;
select ok(not has_table_privilege('anon', 'public.work_order_uninvoiced_acceptance', 'select'),
  'AC-WOMS-008 anon cannot read the view');                                                                                               -- 13
select is((select reloptions from pg_class where oid = 'public.work_order_uninvoiced_acceptance'::regclass), array['security_invoker=true'],
  'AC-WOMS-008 the view is security_invoker — RLS stays the boundary');                                                                   -- 14
select * from finish();
rollback;
