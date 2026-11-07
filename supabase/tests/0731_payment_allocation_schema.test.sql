-- 0731_payment_allocation_schema.test.sql — #1415 AC-NPA-009 (the allocation table: RLS forced, authenticated reads its
-- own org only, anon nothing, no client write, service_role keeps DML, the money checks reject bad rows) and the relaxed
-- native-receipt shape (an on-account receipt needs a customer, not an invoice).
-- Migration under test: 0731_payment_allocation.sql §1/§2.
begin;
create extension if not exists pgtap;
select plan(24);

insert into organizations (id, name) values
  ('07310000-0000-0000-0000-000000000001', 'NPA Org'),
  ('07310000-0000-0000-0000-000000000002', 'NPA Other Org');
insert into auth.users (id, email) values
  ('07310000-0000-0000-0000-0000000000a1', 'npa-fin@example.com'),
  ('07310000-0000-0000-0000-0000000000a7', 'npa-eng@example.com'),
  ('07310000-0000-0000-0000-0000000000b1', 'npa-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07310000-0000-0000-0000-0000000000a1', '07310000-0000-0000-0000-000000000001', 'NPA Fin', 'npa-fin@example.com', 'Finance', 'active'),
  ('07310000-0000-0000-0000-0000000000a7', '07310000-0000-0000-0000-000000000001', 'NPA Eng', 'npa-eng@example.com', 'Engineer', 'active'),
  ('07310000-0000-0000-0000-0000000000b1', '07310000-0000-0000-0000-000000000002', 'NPA XOrg', 'npa-xorg@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('07310000-0000-0000-0000-0000000000c1', '07310000-0000-0000-0000-000000000001', 'NPA Client', 'Client');
insert into public.sales_invoices (id, org_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency,
                                   status, pmo_native, native_lines, erp_outstanding_amount) values
  ('07310000-0000-0000-0000-0000000000e1', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c1',
   '2026-07-01', 1000, 'inclusive', 0, 'IDR', 'Unpaid', true,
   '[{"item_code":"SVC","description":"Schema invoice","qty":1,"rate":1000,"amount":1000.00}]'::jsonb, 1000);
-- an on-account native receipt: no invoice at all
insert into public.incoming_payments (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount,
                                      withheld_amount, currency, status, pmo_native) values
  ('07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c1',
   null, '2026-07-02', 600, 600, 0, 'IDR', 'Paid', true);
insert into public.incoming_payment_allocations (id, org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount,
                                                 withheld_amount, currency, request_id) values
  ('07310000-0000-0000-0000-0000000000a9', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1',
   '07310000-0000-0000-0000-0000000000e1', 400, 400, 0, 'IDR', '07310000-0000-0000-0000-0000000000aa');

select has_table('public', 'incoming_payment_allocations', 'AC-NPA-009 the allocation table exists');                  -- 1
select columns_are('public', 'incoming_payment_allocations',
  array['id','org_id','incoming_payment_id','sales_invoice_id','amount','cash_amount','withheld_amount','currency',
        'request_id','created_at','created_by','reversed_at','reversed_by'],
  'AC-NPA-009 the allocation table has exactly its documented columns');                                                -- 2
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.incoming_payment_allocations'::regclass),
  true, 'AC-NPA-009 row level security is enabled and forced');                                                          -- 3
select ok(exists (select 1 from pg_indexes where tablename = 'incoming_payment_allocations' and indexname = 'ipa_invoice_live_idx'),
  'AC-NPA-009 the live-allocations-by-invoice partial index exists');                                                   -- 4
select ok(exists (select 1 from pg_indexes where tablename = 'incoming_payment_allocations' and indexname = 'ipa_receipt_live_idx'),
  'AC-NPA-009 the live-allocations-by-receipt partial index exists');                                                   -- 5
select is((select count(*)::int from public.incoming_payments where pmo_native and sales_invoice_id is null), 1,
  'AC-NPA-001 a native receipt can exist with no invoice (on account)');                                                -- 6
select throws_ok($$ insert into public.incoming_payments (id, org_id, sales_invoice_id, date, amount, currency, status, pmo_native)
  values ('07310000-0000-0000-0000-0000000000f9', '07310000-0000-0000-0000-000000000001', null, '2026-07-02', 5, 'IDR', 'Paid', true) $$,
  '23514', null, 'AC-NPA-001 a native receipt still needs a customer (the relaxed shape check)');                       -- 7
-- the money checks
select throws_ok($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 0, 0, 0, 'IDR', gen_random_uuid()) $$,
  '23514', null, 'AC-NPA-009 an allocation of zero is refused');                                                        -- 8
select throws_ok($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 10, 4, 4, 'IDR', gen_random_uuid()) $$,
  '23514', null, 'AC-NPA-009 cash plus withheld must equal the allocated amount (ipa_split)');                          -- 9
select throws_ok($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 10, -5, 15, 'IDR', gen_random_uuid()) $$,
  '23514', null, 'AC-NPA-009 a negative cash share is refused');                                                        -- 10
select throws_ok($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id, reversed_by)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 10, 10, 0, 'IDR', gen_random_uuid(), '07310000-0000-0000-0000-0000000000a1') $$,
  '23514', null, 'AC-NPA-009 a reversing actor without a reversal time is refused (ipa_reversal_pair)');                -- 11
select throws_ok($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 10, 10, 0, 'IDR', '07310000-0000-0000-0000-0000000000aa') $$,
  '23505', null, 'AC-NPA-005 the same receipt/request/invoice cannot be recorded twice (ipa_request_uniq)');            -- 12

-- privileges
select is(has_table_privilege('authenticated', 'public.incoming_payment_allocations', 'SELECT'), true,
  'AC-NPA-009 authenticated can read the table (rows are RLS-scoped)');                                                  -- 13
select is((has_table_privilege('authenticated', 'public.incoming_payment_allocations', 'INSERT')
        or has_table_privilege('authenticated', 'public.incoming_payment_allocations', 'UPDATE')
        or has_table_privilege('authenticated', 'public.incoming_payment_allocations', 'DELETE')), false,
  'AC-NPA-009 authenticated has no INSERT, UPDATE or DELETE: writes exist only inside the definer RPCs');               -- 14
select is((has_table_privilege('anon', 'public.incoming_payment_allocations', 'SELECT')
        or has_table_privilege('anon', 'public.incoming_payment_allocations', 'INSERT')
        or has_table_privilege('anon', 'public.incoming_payment_allocations', 'UPDATE')
        or has_table_privilege('anon', 'public.incoming_payment_allocations', 'DELETE')), false,
  'AC-NPA-009 anon has no access at all');                                                                               -- 15
select is((has_table_privilege('service_role', 'public.incoming_payment_allocations', 'SELECT')
       and has_table_privilege('service_role', 'public.incoming_payment_allocations', 'INSERT')
       and has_table_privilege('service_role', 'public.incoming_payment_allocations', 'UPDATE')
       and has_table_privilege('service_role', 'public.incoming_payment_allocations', 'DELETE')), true,
  'AC-NPA-009 service_role keeps full DML (0137 catalog backstop)');                                                    -- 16

-- reads
set local role authenticated;
set local request.jwt.claims = '{"sub":"07310000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.incoming_payment_allocations), 1,
  'AC-NPA-009 a Finance member reads the allocation of their own org');                                                  -- 17
select throws_ok($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 10, 10, 0, 'IDR', gen_random_uuid()) $$,
  '42501', null, 'AC-NPA-009 a signed-in Finance user cannot write an allocation directly');                            -- 18
select throws_ok($$ update public.incoming_payment_allocations set reversed_at = now() $$,
  '42501', null, 'AC-NPA-009 …nor reverse one directly (no UPDATE grant)');                                              -- 19
set local request.jwt.claims = '{"sub":"07310000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select is((select count(*)::int from public.incoming_payment_allocations), 0,
  'AC-NPA-009 an Engineer reads no allocations (the receipts read set excludes Engineer, 0350)');                        -- 20
set local request.jwt.claims = '{"sub":"07310000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.incoming_payment_allocations), 0,
  'AC-NPA-009 a member of another org reads none of this org''s allocations');                                           -- 21
reset role;
set local request.jwt.claims = '{}';
select lives_ok($$ insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000f1', '07310000-0000-0000-0000-0000000000e1', 10, 10, 0, 'IDR', gen_random_uuid()) $$,
  'AC-NPA-009 the owner/service path can still insert a well-formed allocation');                                       -- 22
select throws_ok($$ delete from public.incoming_payments where id = '07310000-0000-0000-0000-0000000000f1' $$,
  '23503', null, 'AC-NPA-009 a receipt with allocations cannot be deleted (on delete restrict)');                       -- 23
select throws_ok($$ delete from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e1' $$,
  '23503', null, 'AC-NPA-009 an invoice with allocations cannot be deleted (on delete restrict)');                      -- 24

select * from finish();
rollback;
