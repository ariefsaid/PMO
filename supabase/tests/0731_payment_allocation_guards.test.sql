-- 0731_payment_allocation_guards.test.sql — #1415 AC-NPA-009: the table defends itself. A writer that never calls the RPCs
-- (service_role, the table owner) cannot over-allocate a receipt, cross orgs, customers or currencies, cite a non-PMO
-- receipt or invoice, or lower a receipt below what is allocated from it. Un-reversing an allocation is a fresh
-- allocation and is held to the same limit.
-- Migration under test: 0731_payment_allocation.sql §2 (ipa_consistency, incoming_payments_amount_covers_allocations).
begin;
create extension if not exists pgtap;
select plan(24);

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
  ('07310000-0000-0000-0000-000000000002', 'NPA Other Org', 'IDR');
insert into companies (id, org_id, name, type) values
  ('07310000-0000-0000-0000-0000000000c9', '07310000-0000-0000-0000-000000000001', 'NPA Client', 'Client'),
  ('07310000-0000-0000-0000-0000000000ca', '07310000-0000-0000-0000-000000000001', 'NPA Other Client', 'Client'),
  ('07310000-0000-0000-0000-0000000000cb', '07310000-0000-0000-0000-000000000002', 'NPA Org2 Client', 'Client');
insert into public.sales_invoices (id, org_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency,
                                   status, pmo_native, native_lines, erp_outstanding_amount) values
  ('07310000-0000-0000-0000-0000000000e1', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 500, 'inclusive', 0, 'IDR', 'Unpaid', true,  '[{"d":"I1"}]'::jsonb, 500),
  ('07310000-0000-0000-0000-0000000000e3', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000ca', '2026-07-01', 500, 'inclusive', 0, 'IDR', 'Unpaid', true,  '[{"d":"other client"}]'::jsonb, 500),
  ('07310000-0000-0000-0000-0000000000e4', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 500, 'inclusive', 0, 'USD', 'Unpaid', true,  '[{"d":"usd"}]'::jsonb, 500),
  ('07310000-0000-0000-0000-0000000000e5', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 500, 'inclusive', 0, 'IDR', 'Unpaid', false, null, 500),
  ('07310000-0000-0000-0000-0000000000e9', '07310000-0000-0000-0000-000000000002', '07310000-0000-0000-0000-0000000000cb', '2026-07-01', 500, 'inclusive', 0, 'IDR', 'Unpaid', true,  '[{"d":"org2"}]'::jsonb, 500);
insert into public.incoming_payments (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount,
                                      withheld_amount, currency, status, pmo_native) values
  ('07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', null, '2026-07-02', 100, 100, 0, 'IDR', 'Paid', true),
  ('07310000-0000-0000-0000-0000000000f5', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', null, '2026-07-02', 100, 100, 0, 'IDR', 'Paid', false);

set local role service_role;
select lives_ok($$ insert into public.incoming_payment_allocations (id, org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-0000000000a1', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 60, 60, 0, 'IDR', gen_random_uuid()) $$,
  'AC-NPA-009 CONTROL a well-formed allocation by service_role is accepted');                                                              -- 1
select is(pg_temp.err($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 40.01, 40.01, 0, 'IDR', gen_random_uuid()) $$),
  '23514:allocation-exceeds-receipt', 'AC-NPA-009 a raw insert that would allocate more than the receipt is refused by the table');       -- 2
select lives_ok($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 40, 40, 0, 'IDR', gen_random_uuid()) $$,
  'AC-NPA-009 …while exactly the rest of the receipt is accepted');                                                                        -- 3
select is(pg_temp.err($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 0.01, 0.01, 0, 'IDR', gen_random_uuid()) $$),
  '23514:allocation-exceeds-receipt', 'AC-NPA-009 …and a single cent more is refused');                                                    -- 4
select is(pg_temp.err($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e9', 1, 1, 0, 'IDR', gen_random_uuid()) $$),
  '42501:', 'AC-NPA-009 an allocation to another org''s invoice is refused');                                                              -- 5
select is(pg_temp.err($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000002', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 1, 1, 0, 'IDR', gen_random_uuid()) $$),
  '42501:', 'AC-NPA-009 a row stamped with another org than its receipt and invoice is refused');                                          -- 6
select is(pg_temp.err($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e3', 1, 1, 0, 'IDR', gen_random_uuid()) $$),
  '23514:allocation-client-mismatch', 'AC-NPA-009 an allocation to another customer''s invoice is refused');                              -- 7
select is(pg_temp.err($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e4', 1, 1, 0, 'IDR', gen_random_uuid()) $$),
  '23514:allocation-currency-mismatch', 'AC-NPA-009 an allocation to an invoice in another currency is refused');                          -- 8
select is(pg_temp.err($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 1, 1, 0, 'USD', gen_random_uuid()) $$),
  '23514:allocation-currency-mismatch', 'AC-NPA-009 …and a row whose own currency differs from the receipt''s is refused');                  -- 9
select is(pg_temp.err($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e5', 1, 1, 0, 'IDR', gen_random_uuid()) $$),
  'P0001:not-pmo-native', 'AC-NPA-009 an allocation to an ERP invoice is refused');                                                       -- 10
select is(pg_temp.err($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f5', '07310000-0000-0000-0000-0000000000e1', 1, 1, 0, 'IDR', gen_random_uuid()) $$),
  'P0001:not-pmo-native', 'AC-NPA-009 an allocation from an ERP receipt is refused');                                                      -- 11

-- lowering the receipt below what is allocated
select is(pg_temp.err($$ update public.incoming_payments set amount = 99, received_amount = 99 where id = '07310000-0000-0000-0000-0000000000f1' $$),
  '23514:amount-below-allocations', 'AC-NPA-009 a receipt cannot be lowered below its live allocations');                                  -- 12
select is(pg_temp.err($$ update public.incoming_payments set amount = 120, received_amount = 120 where id = '07310000-0000-0000-0000-0000000000f1' $$),
  'no-error', 'AC-NPA-009 …but can be raised');                                                                                            -- 13
select is(pg_temp.err($$ update public.incoming_payments set amount = 100, received_amount = 100 where id = '07310000-0000-0000-0000-0000000000f1' $$),
  'no-error', 'AC-NPA-009 …and set back to exactly what is allocated');                                                                    -- 14

-- reversing frees room; un-reversing is held to the same limit
select lives_ok($$ update public.incoming_payment_allocations set reversed_at = now()
   where incoming_payment_id = '07310000-0000-0000-0000-0000000000f1' and amount = 60 $$, 'AC-NPA-009 a reversal is accepted');            -- 15
select lives_ok($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 60, 60, 0, 'IDR', gen_random_uuid()) $$,
  'AC-NPA-009 …which frees the 60 for a new allocation');                                                                                  -- 16
select is(pg_temp.err($$ update public.incoming_payment_allocations set reversed_at = null, reversed_by = null
   where incoming_payment_id = '07310000-0000-0000-0000-0000000000f1' and reversed_at is not null $$),
  '23514:allocation-exceeds-receipt', 'AC-NPA-009 un-reversing the old 60 on top of the new one would over-allocate and is refused');       -- 17
select lives_ok($$ update public.incoming_payments set amount = 100 where id = '07310000-0000-0000-0000-0000000000f1' $$,
  'AC-NPA-009 a receipt can be re-saved at the same amount');                                                                              -- 18

-- a reversed allocation no longer holds the receipt up
select lives_ok($$ update public.incoming_payment_allocations set reversed_at = now() where incoming_payment_id = '07310000-0000-0000-0000-0000000000f1' $$,
  'AC-NPA-009 every allocation reversed');                                                                                                 -- 19
select is(pg_temp.err($$ update public.incoming_payments set amount = 10, received_amount = 10 where id = '07310000-0000-0000-0000-0000000000f1' $$),
  'no-error', 'AC-NPA-009 …then the receipt can be lowered freely');                                                                       -- 20
reset role;

-- the guard functions are not a client surface
select is((select bool_and(not has_function_privilege(r, p.oid, 'EXECUTE'))
             from pg_proc p cross join (values ('anon'), ('authenticated')) as roles(r)
            where p.pronamespace = 'public'::regnamespace and p.proname in ('ipa_consistency', 'incoming_payments_amount_covers_allocations')),
  true, 'AC-NPA-009 neither guard function is executable by anon or authenticated');                                                       -- 21
select is((select count(*)::int from pg_trigger where tgrelid = 'public.incoming_payment_allocations'::regclass
              and tgname = 'incoming_payment_allocations_consistency' and not tgisinternal), 1,
  'AC-NPA-009 the consistency trigger is installed on the allocation table');                                                              -- 22
select is((select count(*)::int from pg_trigger where tgrelid = 'public.incoming_payments'::regclass
              and tgname = 'incoming_payments_amount_covers_allocations' and not tgisinternal), 1,
  'AC-NPA-009 the amount trigger is installed on incoming_payments');                                                                      -- 23
select is((select count(*)::int from public.incoming_payment_allocations where org_id = '07310000-0000-0000-0000-000000000001'
              and incoming_payment_id = '07310000-0000-0000-0000-0000000000f1'), 3,
  'AC-NPA-009 only the three well-formed allocations exist: every refused insert wrote nothing');                                          -- 24

select * from finish();
rollback;
