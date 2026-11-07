-- 0731_payment_allocation_apply.test.sql — #1415 AC-NPA-001..005: an on-account receipt (no invoice), applied across one
-- or more invoices by apply_native_receipt; over-allocation refused (total and per invoice, exactly-equal succeeds);
-- every refusal carries its SQLSTATE AND stable detail code; cross-org ids are indistinguishable from missing ones;
-- role / membership / ERP-ownership / feature gates hold on all three RPCs; replay is idempotent; the cash/withheld
-- split of a withholding receipt sums to the cash received (remainder rule); org_id is always the caller's.
-- Migration under test: 0731_payment_allocation.sql §5.
begin;
create extension if not exists pgtap;
select plan(78);

-- ── helpers: run a statement, report 'SQLSTATE:detail' of its error (or 'no-error') ─────────────────────────────
create function pg_temp.act_as(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare d text;
begin
  execute p_sql;
  return 'no-error';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return sqlstate || ':' || coalesce(d, '');
end $$;

insert into organizations (id, name, default_currency) values
  ('07310000-0000-0000-0000-000000000001', 'NPA Org', 'IDR'),
  ('07310000-0000-0000-0000-000000000002', 'NPA Other Org', 'IDR'),
  ('07310000-0000-0000-0000-000000000003', 'NPA ERP Org', 'IDR');
insert into auth.users (id, email) values
  ('07310000-0000-0000-0000-0000000000a1', 'npa-fin@example.com'),
  ('07310000-0000-0000-0000-0000000000a2', 'npa-admin@example.com'),
  ('07310000-0000-0000-0000-0000000000a4', 'npa-pm@example.com'),
  ('07310000-0000-0000-0000-0000000000a6', 'npa-exec@example.com'),
  ('07310000-0000-0000-0000-0000000000a7', 'npa-eng@example.com'),
  ('07310000-0000-0000-0000-0000000000a8', 'npa-off@example.com'),
  ('07310000-0000-0000-0000-0000000000b1', 'npa-xorg@example.com'),
  ('07310000-0000-0000-0000-0000000000c1', 'npa-erp@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07310000-0000-0000-0000-0000000000a1', '07310000-0000-0000-0000-000000000001', 'NPA Fin', 'npa-fin@example.com', 'Finance', 'active'),
  ('07310000-0000-0000-0000-0000000000a2', '07310000-0000-0000-0000-000000000001', 'NPA Admin', 'npa-admin@example.com', 'Admin', 'active'),
  ('07310000-0000-0000-0000-0000000000a4', '07310000-0000-0000-0000-000000000001', 'NPA PM', 'npa-pm@example.com', 'Project Manager', 'active'),
  ('07310000-0000-0000-0000-0000000000a6', '07310000-0000-0000-0000-000000000001', 'NPA Exec', 'npa-exec@example.com', 'Executive', 'active'),
  ('07310000-0000-0000-0000-0000000000a7', '07310000-0000-0000-0000-000000000001', 'NPA Eng', 'npa-eng@example.com', 'Engineer', 'active'),
  ('07310000-0000-0000-0000-0000000000a8', '07310000-0000-0000-0000-000000000001', 'NPA Off', 'npa-off@example.com', 'Finance', 'active'),
  ('07310000-0000-0000-0000-0000000000b1', '07310000-0000-0000-0000-000000000002', 'NPA XOrg', 'npa-xorg@example.com', 'Finance', 'active'),
  ('07310000-0000-0000-0000-0000000000c1', '07310000-0000-0000-0000-000000000003', 'NPA ERP Fin', 'npa-erp@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('07310000-0000-0000-0000-0000000000c9', '07310000-0000-0000-0000-000000000001', 'NPA Client', 'Client'),
  ('07310000-0000-0000-0000-0000000000ca', '07310000-0000-0000-0000-000000000001', 'NPA Other Client', 'Client'),
  ('07310000-0000-0000-0000-0000000000cb', '07310000-0000-0000-0000-000000000002', 'NPA Org2 Client', 'Client'),
  ('07310000-0000-0000-0000-0000000000cc', '07310000-0000-0000-0000-000000000003', 'NPA ERP Client', 'Client');

-- Invoices (seeded in the shape production writes: native, approved, balance = gross; tax inclusive so gross = amount).
insert into public.sales_invoices (id, org_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency,
                                   status, pmo_native, native_lines, erp_outstanding_amount) values
  ('07310000-0000-0000-0000-0000000000e1', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01',  60,    'inclusive', 0, 'IDR', 'Unpaid',    true,  '[{"d":"I1"}]'::jsonb,  60),
  ('07310000-0000-0000-0000-0000000000e2', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100,    'inclusive', 0, 'IDR', 'Unpaid',    true,  '[{"d":"I2"}]'::jsonb, 100),
  ('07310000-0000-0000-0000-0000000000e3', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000ca', '2026-07-01', 100,    'inclusive', 0, 'IDR', 'Unpaid',    true,  '[{"d":"other client"}]'::jsonb, 100),
  ('07310000-0000-0000-0000-0000000000e4', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100,    'inclusive', 0, 'USD', 'Unpaid',    true,  '[{"d":"usd"}]'::jsonb, 100),
  ('07310000-0000-0000-0000-0000000000e5', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100,    'inclusive', 0, 'IDR', 'Unpaid',    false, null,                    100),
  ('07310000-0000-0000-0000-0000000000e6', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100,    'inclusive', 0, 'IDR', 'Draft',     true,  '[{"d":"draft"}]'::jsonb, null),
  ('07310000-0000-0000-0000-0000000000e7', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100,    'inclusive', 0, 'IDR', 'Paid',      true,  '[{"d":"paid"}]'::jsonb, 0),
  ('07310000-0000-0000-0000-0000000000e8', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100,    'inclusive', 0, 'IDR', 'Cancelled', true,  '[{"d":"cancelled"}]'::jsonb, 0),
  ('07310000-0000-0000-0000-0000000000e9', '07310000-0000-0000-0000-000000000002', '07310000-0000-0000-0000-0000000000cb', '2026-07-01', 100,    'inclusive', 0, 'IDR', 'Unpaid',    true,  '[{"d":"org2"}]'::jsonb, 100),
  ('07310000-0000-0000-0000-0000000000ea', '07310000-0000-0000-0000-000000000003', '07310000-0000-0000-0000-0000000000cc', '2026-07-01', 100,    'inclusive', 0, 'IDR', 'Unpaid',    true,  '[{"d":"erp org"}]'::jsonb, 100),
  ('07310000-0000-0000-0000-0000000000eb', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01',  30.01, 'inclusive', 0, 'IDR', 'Unpaid',    true,  '[{"d":"cents1"}]'::jsonb, 30.01),
  ('07310000-0000-0000-0000-0000000000ec', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01',  40.02, 'inclusive', 0, 'IDR', 'Unpaid',    true,  '[{"d":"cents2"}]'::jsonb, 40.02),
  ('07310000-0000-0000-0000-0000000000ed', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01',  50.03, 'inclusive', 0, 'IDR', 'Unpaid',    true,  '[{"d":"cents3"}]'::jsonb, 50.03),
  ('07310000-0000-0000-0000-0000000000ee', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100,    'inclusive', 0, 'IDR', 'Unpaid',    true,  '[{"d":"spare"}]'::jsonb, 100);
-- Receipts seeded directly: another org's on-account receipt, a cancelled one, an ERP-org one.
insert into public.incoming_payments (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount,
                                      withheld_amount, currency, status, pmo_native, cancelled_at) values
  ('07310000-0000-0000-0000-0000000000f2', '07310000-0000-0000-0000-000000000002', '07310000-0000-0000-0000-0000000000cb', null, '2026-07-02', 100, 100, 0, 'IDR', 'Paid', true, null),
  ('07310000-0000-0000-0000-0000000000f3', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', null, '2026-07-02', 100, 100, 0, 'IDR', 'Paid', true, '2026-07-03 00:00+00'),
  ('07310000-0000-0000-0000-0000000000f4', '07310000-0000-0000-0000-000000000003', '07310000-0000-0000-0000-0000000000cc', null, '2026-07-02', 100, 100, 0, 'IDR', 'Paid', true, null);
insert into external_domain_ownership (org_id, external_tier, domain)
  values ('07310000-0000-0000-0000-000000000003', 'erpnext', 'revenue');

set local role authenticated;
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a1');

-- ── AC-NPA-001: an on-account receipt ───────────────────────────────────────────────────────────────────────
select is(public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 100, null, null, null, '2026-07-05',
                                                  '07310000-0000-0000-0000-0000000000f1'),
  '07310000-0000-0000-0000-0000000000f1'::uuid, 'AC-NPA-001 Finance records a receipt for a customer with no invoice and gets its id');   -- 1
select is((select row(sales_invoice_id is null, pmo_native, pmo_number ~ '^RCV-[0-9]{10}$', status, customer_id, currency,
                      amount, received_amount, withheld_amount, org_id)::text
             from public.incoming_payments where id = '07310000-0000-0000-0000-0000000000f1'),
  row(true, true, true, 'Paid', '07310000-0000-0000-0000-0000000000c9'::uuid, 'IDR', 100.00::numeric(14,2), 100.00::numeric(14,2),
      0.00::numeric(14,2), '07310000-0000-0000-0000-000000000001'::uuid)::text,
  'AC-NPA-001 the receipt is a numbered PMO receipt with no invoice, all cash, in the caller''s org');                                    -- 2
select is((select count(*)::int from public.incoming_payment_allocations where incoming_payment_id = '07310000-0000-0000-0000-0000000000f1'),
  0, 'AC-NPA-001 …and it has no allocation, so the whole amount is "Not yet applied"');                                                   -- 3
select is(public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 100, null, null, null, '2026-07-05',
                                                  '07310000-0000-0000-0000-0000000000f1'),
  '07310000-0000-0000-0000-0000000000f1'::uuid, 'AC-NPA-005 replaying the same receipt id and payload returns it again');                  -- 4
select is((select count(*)::int from public.incoming_payments where pmo_native and org_id = '07310000-0000-0000-0000-000000000001'), 2,
  'AC-NPA-005 …and writes no second receipt (this one plus the seeded cancelled one)');                                                   -- 5
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 90, null, null, null, '2026-07-05', '07310000-0000-0000-0000-0000000000f1') $$),
  'P0001:request-id-reused', 'AC-NPA-005 the same receipt id with a different amount is refused');                                         -- 6
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000ca', 100, null, null, null, '2026-07-05', '07310000-0000-0000-0000-0000000000f1') $$),
  'P0001:request-id-reused', 'AC-NPA-005 …and so is the same id for a different customer');                                               -- 7
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 100, null, null, null, '2026-07-05', '07310000-0000-0000-0000-0000000000f2') $$),
  '42501:', 'AC-NPA-004 a receipt id that belongs to another org is refused without saying so');                                           -- 8
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000cb', 100, null, null, null, '2026-07-05') $$),
  'P0002:', 'AC-NPA-004 another org''s customer is a plain "not found", as an unknown one is');                                            -- 9
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 0, null, null, null, '2026-07-05') $$),
  '23514:receipt-amount-invalid', 'AC-NPA-001 a zero amount is refused with its code');                                                    -- 10
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 100, 90, 5, 'X', '2026-07-05') $$),
  '23514:receipt-split-mismatch', 'AC-NPA-001 cash plus withheld must equal the amount');                                                  -- 11
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 100, 90, 10, null, '2026-07-05') $$),
  '23514:withholding-slip-missing', 'AC-NPA-001 tax withheld needs its slip number');                                                      -- 12
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 100, null, null, null, null) $$),
  '23502:payment-date-missing', 'AC-NPA-001 a receipt states its payment date');                                                           -- 13
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 100, null, null, null, current_date + 3) $$),
  '23514:payment-date-future', 'AC-NPA-001 a payment date in the future is refused');                                                      -- 14

-- ── AC-NPA-003/004: refusals on apply (each leaves the receipt untouched) ────────────────────────────────────
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":60},{"invoice_id":"07310000-0000-0000-0000-0000000000e2","amount":50}]'::jsonb,
    gen_random_uuid()) $$), '23514:allocation-exceeds-unapplied', 'AC-NPA-003 applying more than the receipt has left is refused');       -- 15
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":61}]'::jsonb, gen_random_uuid()) $$),
  '23514:allocation-exceeds-balance', 'AC-NPA-003 applying more than an invoice owes is refused');                                         -- 16
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":0}]'::jsonb, gen_random_uuid()) $$),
  '23514:allocation-amount-invalid', 'AC-NPA-003 an amount of zero is refused');                                                          -- 17
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":-5}]'::jsonb, gen_random_uuid()) $$),
  '23514:allocation-amount-invalid', 'AC-NPA-003 a negative amount is refused');                                                          -- 18
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10.001}]'::jsonb, gen_random_uuid()) $$),
  '23514:allocation-amount-invalid', 'AC-NPA-003 an amount with three decimals is refused');                                              -- 19
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1', '[]'::jsonb, gen_random_uuid()) $$),
  '23514:allocation-amount-invalid', 'AC-NPA-003 an empty allocation list is refused');                                                   -- 20
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10},{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb,
    gen_random_uuid()) $$), '23514:allocation-duplicate-invoice', 'AC-NPA-003 the same invoice twice in one request is refused');         -- 21
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e3","amount":10}]'::jsonb, gen_random_uuid()) $$),
  '23514:allocation-client-mismatch', 'AC-NPA-004 another customer''s invoice is refused');                                               -- 22
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e4","amount":10}]'::jsonb, gen_random_uuid()) $$),
  '23514:allocation-currency-mismatch', 'AC-NPA-004 an invoice in another currency is refused');                                          -- 23
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e5","amount":10}]'::jsonb, gen_random_uuid()) $$),
  'P0001:not-pmo-native', 'AC-NPA-004 an ERP invoice is refused');                                                                        -- 24
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e6","amount":10}]'::jsonb, gen_random_uuid()) $$),
  'P0001:invoice-not-receivable', 'AC-NPA-004 a Draft invoice is refused');                                                               -- 25
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e7","amount":10}]'::jsonb, gen_random_uuid()) $$),
  'P0001:invoice-not-receivable', 'AC-NPA-004 a Paid invoice is refused');                                                                -- 26
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e8","amount":10}]'::jsonb, gen_random_uuid()) $$),
  'P0001:invoice-not-receivable', 'AC-NPA-004 a Cancelled invoice is refused');                                                           -- 27
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f3',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb, gen_random_uuid()) $$),
  'P0001:receipt-not-applicable', 'AC-NPA-004 a cancelled receipt is refused');                                                           -- 28
-- cross-org ids are indistinguishable from missing ones
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e9","amount":10}]'::jsonb, gen_random_uuid()) $$),
  pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000ff","amount":10}]'::jsonb, gen_random_uuid()) $$),
  'AC-NPA-004 another org''s invoice id gives the very same error as an id that does not exist');                                        -- 29
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f2',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb, gen_random_uuid()) $$),
  pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000fe',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb, gen_random_uuid()) $$),
  'AC-NPA-004 another org''s receipt id gives the very same error as an id that does not exist');                                         -- 30
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f2',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb, gen_random_uuid()) $$),
  'P0002:', 'AC-NPA-004 …and that error is a plain "not found" with no detail');                                                         -- 31
select is((select count(*)::int from public.incoming_payment_allocations where org_id = '07310000-0000-0000-0000-000000000001'),
  0, 'AC-NPA-003/004 none of the refused calls wrote a row');                                                                              -- 32

-- ── roles, membership, anon ─────────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a4');
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1', '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb, gen_random_uuid()) $$),
  '42501:', 'AC-NPA-004 a Project Manager cannot apply a receipt');                                                                        -- 33
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 10, null, null, null, '2026-07-05') $$),
  '42501:', 'AC-NPA-004 a Project Manager cannot record an on-account receipt');                                                          -- 34
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a6');
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1', '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb, gen_random_uuid()) $$),
  '42501:', 'AC-NPA-004 an Executive cannot apply a receipt');                                                                             -- 35
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 10, null, null, null, '2026-07-05') $$),
  '42501:', 'AC-NPA-004 an Executive cannot record an on-account receipt');                                                               -- 36
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a7');
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1', '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb, gen_random_uuid()) $$),
  '42501:', 'AC-NPA-004 an Engineer cannot apply a receipt');                                                                              -- 37
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 10, null, null, null, '2026-07-05') $$),
  '42501:', 'AC-NPA-004 an Engineer cannot record an on-account receipt');                                                                -- 38
select is(pg_temp.err($$ select public.unapply_native_allocation(gen_random_uuid()) $$),
  '42501:', 'AC-NPA-004 an Engineer cannot unapply');                                                                                      -- 39
select pg_temp.act_as('07310000-0000-0000-0000-0000000000b1');
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1', '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb, gen_random_uuid()) $$),
  'P0002:', 'AC-NPA-004 a Finance user of another org gets "not found" for this org''s receipt');                                          -- 40
reset role;
update profiles set status = 'disabled' where id = '07310000-0000-0000-0000-0000000000a8';
set local role authenticated;
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a8');
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1', '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":10}]'::jsonb, gen_random_uuid()) $$),
  '42501:', 'AC-NPA-004 a disabled Finance account with a valid token is refused');                                                       -- 41
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 10, null, null, null, '2026-07-05') $$),
  '42501:', 'AC-NPA-004 …on the on-account path too');                                                                                     -- 42
reset role;
set local role anon;
select throws_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1', '[]'::jsonb, gen_random_uuid()) $$,
  '42501', null, 'AC-NPA-004 anon cannot execute apply_native_receipt');                                                                   -- 43
select throws_ok($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 1, null, null, null, '2026-07-05') $$,
  '42501', null, 'AC-NPA-004 anon cannot execute record_native_on_account_receipt');                                                      -- 44
select throws_ok($$ select public.unapply_native_allocation(gen_random_uuid()) $$,
  '42501', null, 'AC-NPA-004 anon cannot execute unapply_native_allocation');                                                              -- 45
reset role;

-- ── ERP-owned org: all three RPCs refuse ───────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('07310000-0000-0000-0000-0000000000c1');
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f4', '[{"invoice_id":"07310000-0000-0000-0000-0000000000ea","amount":10}]'::jsonb, gen_random_uuid()) $$),
  '42501:erp-owns-revenue', 'AC-NPA-004 an org whose ERP owns revenue cannot apply a receipt');                                           -- 46
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000cc', 10, null, null, null, '2026-07-05') $$),
  '42501:erp-owns-revenue', 'AC-NPA-004 …nor record an on-account receipt');                                                              -- 47
select is(pg_temp.err($$ select public.unapply_native_allocation(gen_random_uuid()) $$),
  '42501:erp-owns-revenue', 'AC-NPA-004 …nor unapply');                                                                                    -- 48
reset role;

-- ── AC-NPA-002: apply 60 / 40 across two invoices ──────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a1');
select is((select array_length(public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":60},{"invoice_id":"07310000-0000-0000-0000-0000000000e2","amount":40}]'::jsonb,
    '07310000-0000-0000-0000-0000000000a9'), 1)), 2,
  'AC-NPA-002/003 Finance applies 60 and 40 (exactly the receipt and exactly invoice 1''s balance) and gets two allocation ids');           -- 49
select is((select row(status, erp_outstanding_amount, overpaid_amount)::text from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e1'),
  row('Paid', 0.00::numeric(14,2), 0.00::numeric(14,2))::text, 'AC-NPA-002 invoice 1 is Paid');                                            -- 50
select is((select row(status, erp_outstanding_amount, overpaid_amount)::text from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e2'),
  row('Unpaid', 60.00::numeric(14,2), 0.00::numeric(14,2))::text, 'AC-NPA-002 invoice 2 owes 60');                                         -- 51
select is((select coalesce(sum(amount), 0) from public.incoming_payment_allocations
            where incoming_payment_id = '07310000-0000-0000-0000-0000000000f1' and reversed_at is null),
  100.00::numeric, 'AC-NPA-002 the receipt has nothing left to apply');                                                                    -- 52
select is((select count(*)::int from public.incoming_payment_allocations where org_id = '07310000-0000-0000-0000-000000000001'
              and request_id = '07310000-0000-0000-0000-0000000000a9' and created_by = '07310000-0000-0000-0000-0000000000a1'), 2,
  'AC-NPA-002 each allocation is stamped with the request id and the actor');                                                              -- 53
select is((select sum(amount) from public.incoming_payment_allocations
            where sales_invoice_id = '07310000-0000-0000-0000-0000000000e2' and reversed_at is null), 40.00::numeric,
  'AC-NPA-002 invoice 2''s settled figure is its live allocations');                                                                       -- 54

-- ── AC-NPA-005: replay ─────────────────────────────────────────────────────────────────────────────────────
select is((select array_length(public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e2","amount":40},{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":60}]'::jsonb,
    '07310000-0000-0000-0000-0000000000a9'), 1)), 2, 'AC-NPA-005 replaying the same request (any order) returns the same two ids');         -- 55
select is((select count(*)::int from public.incoming_payment_allocations where org_id = '07310000-0000-0000-0000-000000000001'), 2,
  'AC-NPA-005 …writes no new row');                                                                                                        -- 56
select is((select erp_outstanding_amount from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e2'), 60.00::numeric(14,2),
  'AC-NPA-005 …and moves no balance');                                                                                                     -- 57
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e2","amount":39}]'::jsonb, '07310000-0000-0000-0000-0000000000a9') $$),
  'P0001:request-id-reused', 'AC-NPA-005 the same request id with a different payload is refused');                                        -- 58
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e2","amount":1}]'::jsonb, gen_random_uuid()) $$),
  '23514:allocation-exceeds-unapplied', 'AC-NPA-003 a fully applied receipt takes nothing more');                                          -- 59

-- ── org_id is the caller's, whatever the client JSON says ──────────────────────────────────────────────────
select is(public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 50, null, null, null, '2026-07-05',
                                                  '07310000-0000-0000-0000-0000000000f5'),
  '07310000-0000-0000-0000-0000000000f5'::uuid, 'setup: a second on-account receipt of 50');                                               -- 60
select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f5',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e2","amount":10,"org_id":"07310000-0000-0000-0000-000000000002","cash_amount":999}]'::jsonb,
    gen_random_uuid()) $$, 'AC-NPA-004 extra keys in the client JSON are ignored');                                                         -- 61
select is((select row(org_id, cash_amount)::text from public.incoming_payment_allocations
            where incoming_payment_id = '07310000-0000-0000-0000-0000000000f5'),
  row('07310000-0000-0000-0000-000000000001'::uuid, 10.00::numeric(14,2))::text,
  'AC-NPA-004 the new row carries the caller''s org and a server-computed cash share, not the client''s');                                  -- 62
-- the exact-balance boundary on a fresh invoice: 50 left on receipt 5 after 10; invoice 2 owes 50 now
select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f5',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e2","amount":40}]'::jsonb, gen_random_uuid()) $$,
  'AC-NPA-003 exactly the invoice''s remaining balance (50 less the 10 above) is not refused');                                            -- 63
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e2'),
  row('Unpaid', 10.00::numeric(14,2))::text, 'AC-NPA-003 …leaving the invoice owing 10 of its 100 after 40 + 10 + 40');                       -- 64

-- ── the cash / withheld split: a withholding receipt applied across three invoices sums to the cash received ──
select is(public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 120.06, 100.05, 20.01, 'BP-NPA-1', '2026-07-05',
                                                  '07310000-0000-0000-0000-0000000000f6'),
  '07310000-0000-0000-0000-0000000000f6'::uuid, 'setup: a withholding receipt of 120.06 (cash 100.05, withheld 20.01)');                    -- 65
select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f6',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000eb","amount":30.01},{"invoice_id":"07310000-0000-0000-0000-0000000000ec","amount":40.02},
      {"invoice_id":"07310000-0000-0000-0000-0000000000ed","amount":50.03}]'::jsonb, gen_random_uuid()) $$,
  'AC-NPA-003 the receipt is applied in full over three invoices with awkward cents');                                                     -- 66
select is((select sum(cash_amount) from public.incoming_payment_allocations where incoming_payment_id = '07310000-0000-0000-0000-0000000000f6'),
  100.05::numeric, 'AC-NPA-002 once fully applied the cash shares sum to the cash received exactly (remainder rule)');                      -- 67
select is((select sum(withheld_amount) from public.incoming_payment_allocations where incoming_payment_id = '07310000-0000-0000-0000-0000000000f6'),
  20.01::numeric, 'AC-NPA-002 …and the withheld shares to the tax withheld exactly');                                                      -- 68
select is((select count(*)::int from public.incoming_payment_allocations where incoming_payment_id = '07310000-0000-0000-0000-0000000000f6'
              and cash_amount + withheld_amount = amount), 3, 'AC-NPA-002 …and every share adds up to its allocation');                    -- 69
select is(public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 100, 90, 10, 'BP-NPA-2', '2026-07-05',
                                                  '07310000-0000-0000-0000-0000000000f7'),
  '07310000-0000-0000-0000-0000000000f7'::uuid, 'setup: a withholding receipt of 100 (cash 90, withheld 10)');                              -- 70
select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f7',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000ee","amount":30}]'::jsonb, gen_random_uuid()) $$,
  'AC-NPA-002 a part application of a withholding receipt');                                                                               -- 71
select is((select row(cash_amount, withheld_amount)::text from public.incoming_payment_allocations
            where incoming_payment_id = '07310000-0000-0000-0000-0000000000f7'),
  row(27.00::numeric(14,2), 3.00::numeric(14,2))::text, 'AC-NPA-002 …takes the proportional 27 cash and 3 withheld');                      -- 72

-- ── Admin may; the feature switch gates ────────────────────────────────────────────────────────────────────
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a2');
select is(public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 20, null, null, null, '2026-07-05',
                                                  '07310000-0000-0000-0000-0000000000f8'),
  '07310000-0000-0000-0000-0000000000f8'::uuid, 'AC-NPA-004 an Admin may record an on-account receipt');                                    -- 73
select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f8',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000ee","amount":20}]'::jsonb, gen_random_uuid()) $$,
  'AC-NPA-004 an Admin may apply a receipt');                                                                                              -- 74
reset role;
savepoint feature_off;
insert into org_features (org_id, feature_key, enabled) values ('07310000-0000-0000-0000-000000000001', 'revenue', false);
set local role authenticated;
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a1');
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f5', '[{"invoice_id":"07310000-0000-0000-0000-0000000000ee","amount":1}]'::jsonb, gen_random_uuid()) $$),
  'P0001:revenue', 'AC-NPA-004 with revenue switched off apply_native_receipt refuses (feature_off)');                                      -- 75
select is(pg_temp.err($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 10, null, null, null, '2026-07-05') $$),
  'P0001:revenue', 'AC-NPA-004 …and so does record_native_on_account_receipt');                                                            -- 76
reset role;
rollback to savepoint feature_off;

-- ── audit ──────────────────────────────────────────────────────────────────────────────────────────────────
select cmp_ok((select count(*)::int from public.audit_events where action = 'incoming_payment.apply'
                  and actor_id = '07310000-0000-0000-0000-0000000000a1' and org_id = '07310000-0000-0000-0000-000000000001'), '>=', 4,
  'AC-NPA-002 every apply is on the audit trail with its actor');                                                                          -- 77
select cmp_ok((select count(*)::int from public.audit_events where action = 'incoming_payment.on_account'
                  and org_id = '07310000-0000-0000-0000-000000000001'), '>=', 5,
  'AC-NPA-001 every on-account receipt is on the audit trail');                                                                            -- 78

select * from finish();
rollback;
