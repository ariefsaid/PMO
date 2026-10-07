-- 0264_native_revenue_receipts.test.sql — #784 AC-NAR-003 (part and full receipts; the balance is the gross less live
-- PMO receipts, never below zero; Paid exactly at zero; a receipt above the balance settles the invoice and the excess
-- reads as overpaid, DD-NAR-17) and AC-NAR-006 (a receipt can be cancelled; the balance comes back).
-- Every receipt states its payment date, which is never in the future (DD-NAR-17).
-- Migration under test: 0264 §5.
begin;
create extension if not exists pgtap;
select plan(28);

insert into organizations (id, name) values
  ('02640000-0000-0000-0000-000000000001', 'NAR Org');
insert into auth.users (id, email) values
  ('02640000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02640000-0000-0000-0000-0000000000a2', 'nar-fin2@example.com'),
  ('02640000-0000-0000-0000-0000000000a4', 'nar-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02640000-0000-0000-0000-0000000000a1', '02640000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02640000-0000-0000-0000-0000000000a2', '02640000-0000-0000-0000-000000000001', 'NAR Fin Two', 'nar-fin2@example.com', 'Finance', 'active'),
  ('02640000-0000-0000-0000-0000000000a4', '02640000-0000-0000-0000-000000000001', 'NAR PM', 'nar-pm@example.com', 'Project Manager', 'active');
insert into companies (id, org_id, name, type) values
  ('02640000-0000-0000-0000-0000000000c1', '02640000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02640000-0000-0000-0000-0000000000d1', '02640000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02640000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02640000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform public.create_native_sales_invoice('02640000-0000-0000-0000-0000000000d1', '02640000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Receipt invoice","qty":2,"rate":500000}]'::jsonb);
  perform public.create_native_sales_invoice('02640000-0000-0000-0000-0000000000d1', '02640000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Second invoice","qty":1,"rate":1000}]'::jsonb);
  perform public.create_native_sales_invoice('02640000-0000-0000-0000-0000000000d1', '02640000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Draft only","qty":1,"rate":100}]'::jsonb);
end $$;
set local request.jwt.claims = '{"sub":"02640000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'), 'Unpaid');
  perform public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Second invoice"}]'), 'Unpaid');
end $$;

set local request.jwt.claims = '{"sub":"02640000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Draft only"}]'),
  p_amount => 100, p_date => '2026-10-01') $$,
  'P0001', 'a receipt can be recorded only against an approved invoice that is not fully paid',
  'AC-NAR-003 a Draft takes no receipt');                                                                            -- 1
select lives_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  p_amount => 500000, p_date => '2026-10-01') $$,
  'AC-NAR-003 Finance records a part payment');                                                                      -- 2
select is((select row(status, erp_outstanding_amount, overpaid_amount)::text from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  row('Unpaid', 610000.00::numeric(14,2), 0.00::numeric(14,2))::text,
  'AC-NAR-003 a part payment leaves 610,000 of the 1,110,000 gross outstanding and the invoice Unpaid');             -- 3
select is(
  (select row(pmo_native, pmo_number ~ '^RCV-[0-9]{10}$', status, customer_id, currency, received_amount, withheld_amount, date)::text
     from public.incoming_payments
    where sales_invoice_id = (select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]')
      and amount = 500000),
  row(true, true, 'Paid', '02640000-0000-0000-0000-0000000000c1'::uuid, 'IDR', 500000.00::numeric(14,2), 0.00::numeric(14,2), '2026-10-01'::date)::text,
  'AC-NAR-003 the receipt is a numbered PMO receipt for the invoice''s customer, in its currency, all cash, on its payment date'); -- 4
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  p_amount => 100) $$,
  '23502', 'a receipt needs its payment date',
  'AC-NAR-003 a receipt states its payment date (DD-NAR-17)');                                                       -- 5
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  p_amount => 100, p_date => current_date + 2) $$,
  '23514', 'the payment date cannot be in the future',
  'AC-NAR-003 a payment date in the future is refused (DD-NAR-17)');                                                 -- 6
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'), 'Cancelled') $$,
  'P0001', 'cancel the receipts recorded against this invoice first',
  'AC-NAR-005 an invoice with a live receipt cannot be cancelled');                                                 -- 7
select lives_ok($$ insert into public.incoming_payments (customer_id, sales_invoice_id, date, amount)
  values ('02640000-0000-0000-0000-0000000000c1', (select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'), '2026-10-01', 999) $$,
  'AC-NAR-003 setup: a client-inserted receipt row (the 0178 column-limited insert) lands');                         -- 8
select is((select erp_outstanding_amount from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  610000.00::numeric(14,2), 'AC-NAR-003 …and moves no PMO invoice''s balance: only PMO receipts settle a PMO invoice'); -- 9
select lives_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  610000, 600000, 10000, 'BP-NAR-1', '2026-10-01') $$,
  'AC-NAR-003 Finance records the rest, with tax withheld by the client (DD-RCPT-1) — the client row did not count'); -- 10
select is((select row(status, erp_outstanding_amount, overpaid_amount)::text from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  row('Paid', 0.00::numeric(14,2), 0.00::numeric(14,2))::text, 'AC-NAR-003 settled in full, the invoice is Paid');    -- 11
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  p_amount => 1, p_date => '2026-10-01') $$,
  'P0001', 'a receipt can be recorded only against an approved invoice that is not fully paid',
  'AC-NAR-003 a Paid invoice takes no more receipts');                                                              -- 12
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Second invoice"}]'), 100, 90, 0, null, '2026-10-01') $$,
  '23514', 'cash received plus tax withheld must equal the amount settled',
  'AC-NAR-003 cash plus withholding must add up to the amount settled');                                            -- 13
select lives_ok($$ select public.cancel_native_receipt((select id from public.incoming_payments where withholding_slip_number = 'BP-NAR-1')) $$,
  'AC-NAR-006 Finance cancels a receipt recorded in error');                                                         -- 14
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  row('Unpaid', 610000.00::numeric(14,2))::text, 'AC-NAR-006 the balance is restored and the invoice is Unpaid again'); -- 15
select throws_ok($$ select public.cancel_native_receipt((select id from public.incoming_payments where withholding_slip_number = 'BP-NAR-1')) $$,
  'P0001', 'this receipt is already cancelled', 'AC-NAR-006 a receipt is cancelled once');                          -- 16

-- DD-NAR-17: a receipt above the balance is accepted; the balance never goes below zero and the excess reads as overpaid.
select lives_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  p_amount => 700000, p_date => '2026-10-01') $$,
  'AC-NAR-003 a receipt above the balance is recorded (DD-NAR-17)');                                                 -- 17
select is((select row(status, erp_outstanding_amount, overpaid_amount)::text from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  row('Paid', 0.00::numeric(14,2), 90000.00::numeric(14,2))::text,
  'AC-NAR-003 an overpaid invoice is Paid, owes nothing, and shows the 90,000 received beyond its gross');           -- 18
select lives_ok($$ select public.cancel_native_receipt((select id from public.incoming_payments where pmo_native and amount = 700000)) $$,
  'AC-NAR-006 Finance cancels the overpaying receipt');                                                              -- 19
select is((select row(status, erp_outstanding_amount, overpaid_amount)::text from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  row('Unpaid', 610000.00::numeric(14,2), 0.00::numeric(14,2))::text,
  'AC-NAR-006 cancelling it restores the balance and clears the overpayment');                                       -- 20
select lives_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Second invoice"}]'),
  p_date => '2026-10-06') $$,
  'AC-NAR-003 a receipt with no amount stated settles what is outstanding (DD-NAR-17)');                             -- 21
select is(
  (select row(ip.amount, ip.received_amount, si.status, si.erp_outstanding_amount, si.overpaid_amount)::text
     from public.incoming_payments ip join public.sales_invoices si on si.id = ip.sales_invoice_id
    where si.native_lines @> '[{"description":"Second invoice"}]' and ip.pmo_native),
  row(1110.00::numeric(14,2), 1110.00::numeric(14,2), 'Paid', 0.00::numeric(14,2), 0.00::numeric(14,2))::text,
  'AC-NAR-003 the default amount is the 1,110 outstanding, and the invoice is Paid');                                 -- 22

set local request.jwt.claims = '{"sub":"02640000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  p_amount => 100, p_date => '2026-10-01') $$,
  '42501', 'only Finance or an Admin can record a customer receipt', 'AC-NAR-003 a Project Manager cannot record a receipt'); -- 23
select throws_ok($$ select public.cancel_native_receipt((select id from public.incoming_payments where pmo_native and amount = 500000)) $$,
  '42501', 'only Finance or an Admin can cancel a customer receipt', 'AC-NAR-006 a Project Manager cannot cancel a receipt'); -- 24

reset role;
set local request.jwt.claims = '{}';
insert into public.sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status, erp_outstanding_amount)
  values ('02640000-0000-0000-0000-0000000000f3', '02640000-0000-0000-0000-000000000001', '02640000-0000-0000-0000-0000000000d1',
          '02640000-0000-0000-0000-0000000000c1', 100, 'inclusive', 0, 'IDR', 'Unpaid', 100);
set local role authenticated;
set local request.jwt.claims = '{"sub":"02640000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.record_native_receipt('02640000-0000-0000-0000-0000000000f3', p_amount => 10, p_date => '2026-10-01') $$,
  'P0001', 'receipts for an ERP invoice are recorded in the ERP', 'AC-NAR-003 an ERP invoice takes no PMO receipt'); -- 25
select throws_ok($$ update public.sales_invoices set overpaid_amount = 0 where native_lines @> '[{"description":"Receipt invoice"}]' $$,
  '42501', null, 'AC-NAR-003 no client writes the overpaid figure directly — only the receipt RPCs restate it');      -- 26
reset role;
select is(
  (select count(*)::int from public.sales_invoices si
    where si.org_id = '02640000-0000-0000-0000-000000000001' and si.pmo_native and si.status in ('Unpaid','Paid')
      and (si.erp_outstanding_amount is distinct from greatest(si.amount + si.tax_amount - public.native_invoice_settled(si.id), 0)
           or si.overpaid_amount is distinct from greatest(public.native_invoice_settled(si.id) - (si.amount + si.tax_amount), 0)
           or (si.status = 'Paid') is distinct from (si.erp_outstanding_amount = 0))),
  0, 'AC-NAR-003 every PMO invoice''s stored balance is its gross less its live receipts (never below zero), its overpaid figure is the excess, and it is Paid exactly at zero'); -- 27
select is(
  (select count(*)::int from public.sales_invoices where org_id = '02640000-0000-0000-0000-000000000001' and erp_outstanding_amount < 0),
  0, 'AC-NAR-003 no invoice''s balance is ever negative — readers rely on it (DD-NAR-17)');                        -- 28

select * from finish();
rollback;
