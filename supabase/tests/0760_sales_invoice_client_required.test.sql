-- 0760_sales_invoice_client_required.test.sql — #2003: a PMO-native sales invoice may only be raised for a client
-- company, the same rule the on-account receipt took (0731, #1415). A vendor-only or internal company is refused
-- 'customer not found' (P0002) exactly like an unknown or other-org customer, and a refused create writes nothing.
-- Migration under test: 0760_sales_invoice_client_required.sql (create_native_sales_invoice's company check).
begin;
create extension if not exists pgtap;
select plan(7);

insert into organizations (id, name) values
  ('07600000-0000-0000-0000-000000000001', 'SI-Client Org'),
  ('07600000-0000-0000-0000-000000000002', 'SI-Client Other Org');
insert into auth.users (id, email) values
  ('07600000-0000-0000-0000-0000000000a1', 'sifin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07600000-0000-0000-0000-0000000000a1', '07600000-0000-0000-0000-000000000001', 'SI Fin', 'sifin@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('07600000-0000-0000-0000-0000000000c1', '07600000-0000-0000-0000-000000000001', 'SI Client Co', 'Client'),
  ('07600000-0000-0000-0000-0000000000c2', '07600000-0000-0000-0000-000000000001', 'SI Vendor Co', 'Vendor'),
  ('07600000-0000-0000-0000-0000000000c3', '07600000-0000-0000-0000-000000000001', 'SI Internal Co', 'Internal'),
  ('07600000-0000-0000-0000-0000000000c9', '07600000-0000-0000-0000-000000000002', 'SI X Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('07600000-0000-0000-0000-0000000000d1', '07600000-0000-0000-0000-000000000001', 'SI Client project', 'Ongoing Project', 'IDR',
   10000000, 'exclusive', 0, null, 1, 1, false, 'CTR-SI-1', '07600000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07600000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Control: the rule must not over-refuse — a genuine client company still gets its invoice.
select lives_ok($$ select public.create_native_sales_invoice('07600000-0000-0000-0000-0000000000d1', '07600000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","description":"Client work","qty":1,"rate":500000}]'::jsonb) $$,
  'AC-2003 a Finance user can still raise an invoice for a client company');                                        -- 1

-- The rule: a company of the same org that is not a client is refused like an unknown customer (#1415's shape).
select throws_ok($$ select public.create_native_sales_invoice('07600000-0000-0000-0000-0000000000d1', '07600000-0000-0000-0000-0000000000c2',
  '[{"item_code":"SVC","description":"Vendor work","qty":1,"rate":100}]'::jsonb) $$,
  'P0002', 'customer not found',
  'AC-2003 an invoice for a vendor-only company of the same org is refused');                                        -- 2
select throws_ok($$ select public.create_native_sales_invoice('07600000-0000-0000-0000-0000000000d1', '07600000-0000-0000-0000-0000000000c3',
  '[{"item_code":"SVC","description":"Internal work","qty":1,"rate":100}]'::jsonb) $$,
  'P0002', 'customer not found',
  'AC-2003 an invoice for an internal company is refused too');                                                      -- 3
select throws_ok($$ select public.create_native_sales_invoice('07600000-0000-0000-0000-0000000000d1', '07600000-0000-0000-0000-0000000000c9',
  '[{"item_code":"SVC","description":"X-org work","qty":1,"rate":100}]'::jsonb) $$,
  'P0002', 'customer not found',
  'AC-2003 another org''s client company is still refused (the org ownership check survives)');                      -- 4

-- Mutation check: a refusal must not leave a half-written document — no invoice row, no author row.
select is((select count(*)::int from public.sales_invoices
            where customer_id in ('07600000-0000-0000-0000-0000000000c2', '07600000-0000-0000-0000-0000000000c3',
                                  '07600000-0000-0000-0000-0000000000c9')), 0,
  'AC-2003 a refused create writes no invoice for the non-client or cross-org company');                             -- 5
select is((select count(*)::int from public.sales_invoice_authors a
            join public.sales_invoices si on si.id = a.sales_invoice_id
            where si.customer_id not in ('07600000-0000-0000-0000-0000000000c1')), 0,
  'AC-2003 a refused create records no approval-SoD author row either');                                             -- 6
select is((select count(*)::int from public.sales_invoices si
            join public.sales_invoice_authors a on a.sales_invoice_id = si.id
            where si.customer_id = '07600000-0000-0000-0000-0000000000c1'), 1,
  'AC-2003 the client control invoice exists exactly once with its author recorded');                                -- 7

select * from finish();
rollback;
