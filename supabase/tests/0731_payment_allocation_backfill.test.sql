-- 0731_payment_allocation_backfill.test.sql — #1415 AC-NPA-006: receipts recorded before the allocation table existed
-- (live, cancelled, over-paying, split cash/withheld) settle every invoice EXACTLY as before once backfilled: the settled
-- figure, the outstanding, the overpaid and the status. Legacy-shaped rows are seeded directly (as 0275's tests do), which
-- is the shape production holds: a native receipt citing its invoice, with no allocation row.
-- Migration under test: 0731_payment_allocation.sql §3/§4.
begin;
create extension if not exists pgtap;
select plan(20);

insert into organizations (id, name) values ('07310000-0000-0000-0000-000000000001', 'NPA Org');
insert into companies (id, org_id, name, type) values
  ('07310000-0000-0000-0000-0000000000c1', '07310000-0000-0000-0000-000000000001', 'NPA Client', 'Client');
insert into public.sales_invoices (id, org_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency,
                                   status, pmo_native, native_lines, erp_outstanding_amount, overpaid_amount) values
  ('07310000-0000-0000-0000-0000000000e1', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c1',
   '2026-07-01', 1000, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"description":"A"}]'::jsonb, 500, 0),
  ('07310000-0000-0000-0000-0000000000e2', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c1',
   '2026-07-01', 500, 'inclusive', 0, 'IDR', 'Paid', true, '[{"description":"B"}]'::jsonb, 0, 200),
  ('07310000-0000-0000-0000-0000000000e3', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c1',
   '2026-07-01', 400, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"description":"C"}]'::jsonb, 300, 0),
  ('07310000-0000-0000-0000-0000000000e4', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c1',
   '2026-07-01', 250, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"description":"D"}]'::jsonb, 250, 0);
insert into public.incoming_payments (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount,
                                      withheld_amount, withholding_slip_number, currency, status, pmo_native, cancelled_at) values
  ('07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c1',
   '07310000-0000-0000-0000-0000000000e1', '2026-07-02', 300, 290, 10, 'BP-1', 'IDR', 'Paid', true, null),
  ('07310000-0000-0000-0000-0000000000f2', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c1',
   '07310000-0000-0000-0000-0000000000e1', '2026-07-03', 200, 200, 0, null, 'IDR', 'Paid', true, null),
  ('07310000-0000-0000-0000-0000000000f3', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c1',
   '07310000-0000-0000-0000-0000000000e2', '2026-07-02', 700, 700, 0, null, 'IDR', 'Paid', true, null),
  ('07310000-0000-0000-0000-0000000000f4', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c1',
   '07310000-0000-0000-0000-0000000000e3', '2026-07-02', 100, 100, 0, null, 'IDR', 'Paid', true, null),
  ('07310000-0000-0000-0000-0000000000f5', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c1',
   '07310000-0000-0000-0000-0000000000e3', '2026-07-02', 150, 150, 0, null, 'IDR', 'Paid', true, '2026-07-04 10:00+00');

-- What the pre-0731 function reported (its verbatim body) and what the rows hold, captured before any backfill.
create temp table before_fig as
select si.id,
       (select coalesce(sum(ip.amount), 0) from public.incoming_payments ip
         where ip.org_id = si.org_id and ip.sales_invoice_id = si.id and ip.pmo_native and ip.cancelled_at is null) as legacy_settled,
       si.erp_outstanding_amount as outstanding, si.overpaid_amount as overpaid, si.status
  from public.sales_invoices si where si.pmo_native;

-- The migration already backfilled whatever existed when it ran; this file seeds its own legacy data afterwards, so
-- start from the state a fresh upgrade would find: none of our receipts has an allocation yet.
select is((select count(*)::int from public.incoming_payment_allocations where org_id = '07310000-0000-0000-0000-000000000001'), 0,
  'AC-NPA-006 CONTROL before the backfill the legacy-shaped receipts have no allocation');                              -- 1
select is(public.native_invoice_settled('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000e1'), 0::numeric,
  'AC-NPA-006 CONTROL the settled figure now reads allocations only, so before the backfill it is zero');               -- 2

select is((select public.native_receipt_allocations_backfill()), 5, 'AC-NPA-006 the backfill writes one allocation per native receipt'); -- 3
select is((select count(*)::int from before_fig f where public.native_invoice_settled('07310000-0000-0000-0000-000000000001', f.id) is distinct from f.legacy_settled),
  0, 'AC-NPA-006 every invoice''s settled figure equals the legacy figure');                                            -- 4
select is(public.native_invoice_settled('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000e2'), 700::numeric,
  'AC-NPA-006 the over-paying invoice settles 700 against a gross of 500');                                              -- 5
select is(public.native_invoice_settled('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000e3'), 100::numeric,
  'AC-NPA-006 the cancelled receipt does not count');                                                                   -- 6
select is(public.native_invoice_settled('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000e4'), 0::numeric,
  'AC-NPA-006 the untouched invoice settles nothing');                                                                  -- 7
select is((select reversed_at is not null and reversed_by is null from public.incoming_payment_allocations
            where incoming_payment_id = '07310000-0000-0000-0000-0000000000f5'),
  true, 'AC-NPA-006 the cancelled receipt''s allocation is reversed, with no actor');                                    -- 8
select is((select row(amount, cash_amount, withheld_amount, currency)::text from public.incoming_payment_allocations
            where incoming_payment_id = '07310000-0000-0000-0000-0000000000f1'),
  row(300.00::numeric(14,2), 290.00::numeric(14,2), 10.00::numeric(14,2), 'IDR')::text,
  'AC-NPA-006 a backfilled allocation carries the receipt''s cash and withheld split');                                  -- 9
select is((select request_id from public.incoming_payment_allocations where incoming_payment_id = '07310000-0000-0000-0000-0000000000f1'),
  '07310000-0000-0000-0000-0000000000f1'::uuid, 'AC-NPA-006 the backfill''s request id is the receipt''s own id');       -- 10
select is((select public.native_receipt_allocations_backfill()), 0, 'AC-NPA-006 re-running the backfill writes nothing (idempotent)'); -- 11
select is((select count(*)::int from public.incoming_payment_allocations where org_id = '07310000-0000-0000-0000-000000000001'), 5, 'AC-NPA-006 …and the row count is unchanged'); -- 12

-- restate each invoice from the migrated figure: outstanding, overpaid and status are what they were
select lives_ok($$ select public.native_invoice_restate(id) from before_fig $$, 'AC-NPA-006 restating every PMO invoice works');  -- 13
select is((select count(*)::int from before_fig f join public.sales_invoices si on si.id = f.id
            where si.erp_outstanding_amount is distinct from f.outstanding), 0,
  'AC-NPA-006 every invoice''s outstanding is exactly what it was');                                                    -- 14
select is((select count(*)::int from before_fig f join public.sales_invoices si on si.id = f.id
            where coalesce(si.overpaid_amount, 0) is distinct from coalesce(f.overpaid, 0)), 0,
  'AC-NPA-006 every invoice''s overpaid figure is exactly what it was');                                                 -- 15
select is((select count(*)::int from before_fig f join public.sales_invoices si on si.id = f.id
            where si.status is distinct from f.status), 0, 'AC-NPA-006 every invoice''s status is exactly what it was'); -- 16

-- the backfill is not callable by a signed-in client
set local role authenticated;
set local request.jwt.claims = '{"sub":"07310000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.native_receipt_allocations_backfill() $$, '42501', null,
  'AC-NPA-006 a signed-in client cannot run the backfill');                                                             -- 17
reset role;
select is(has_function_privilege('anon', 'public.native_receipt_allocations_backfill()', 'EXECUTE'), false,
  'AC-NPA-006 anon cannot execute the backfill');                                                                       -- 18

-- a mismatch is possible only if a live receipt were missed: prove the migration's own self-check shape detects it
delete from public.incoming_payment_allocations where incoming_payment_id = '07310000-0000-0000-0000-0000000000f2';
select is((select count(*)::int from before_fig f
            where public.native_invoice_settled('07310000-0000-0000-0000-000000000001', f.id) is distinct from f.legacy_settled), 1,
  'AC-NPA-006 the equality probe the migration asserts WOULD catch a missed receipt (invoice A now differs)');           -- 19
select is((select public.native_receipt_allocations_backfill()), 1, 'AC-NPA-006 …and a re-run restores exactly the missing row'); -- 20

select * from finish();
rollback;
