-- 0270_native_revenue_create.test.sql — #784 AC-NAR-001: with no ERP owning revenue, a Finance user raises a customer
-- invoice; it saves as Draft with its tax treatment, tax and currency, its author recorded, and lists for the org only.
-- Migration under test: 0270_native_revenue.sql §1–§3 (and 0262's work-order fence, DD-BWO-4).
begin;
create extension if not exists pgtap;
select plan(26);

insert into organizations (id, name) values
  ('02700000-0000-0000-0000-000000000001', 'NAR Org'),
  ('02700000-0000-0000-0000-000000000002', 'NAR Other Org');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02700000-0000-0000-0000-0000000000a2', 'nar-fin2@example.com'),
  ('02700000-0000-0000-0000-0000000000a3', 'nar-admin@example.com'),
  ('02700000-0000-0000-0000-0000000000a4', 'nar-pm@example.com'),
  ('02700000-0000-0000-0000-0000000000a5', 'nar-off@example.com'),
  ('02700000-0000-0000-0000-0000000000b1', 'nar-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-000000000001', 'NAR Fin Two', 'nar-fin2@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a3', '02700000-0000-0000-0000-000000000001', 'NAR Admin', 'nar-admin@example.com', 'Admin', 'active'),
  ('02700000-0000-0000-0000-0000000000a4', '02700000-0000-0000-0000-000000000001', 'NAR PM', 'nar-pm@example.com', 'Project Manager', 'active'),
  ('02700000-0000-0000-0000-0000000000a5', '02700000-0000-0000-0000-000000000001', 'NAR Off', 'nar-off@example.com', 'Finance', 'disabled'),
  ('02700000-0000-0000-0000-0000000000b1', '02700000-0000-0000-0000-000000000002', 'NAR XOrg', 'nar-xorg@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client'),
  ('02700000-0000-0000-0000-0000000000c9', '02700000-0000-0000-0000-000000000002', 'NAR X Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1'),
  ('02700000-0000-0000-0000-0000000000d2', '02700000-0000-0000-0000-000000000001', 'NAR no-VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, null, 1, 1, false, null, '02700000-0000-0000-0000-0000000000c1'),
  ('02700000-0000-0000-0000-0000000000d3', '02700000-0000-0000-0000-000000000001', 'NAR VAT no-rate project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, null, 1, 1, true, null, '02700000-0000-0000-0000-0000000000c1'),
  ('02700000-0000-0000-0000-0000000000d9', '02700000-0000-0000-0000-000000000002', 'NAR X project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, null, 1, 1, true, null, '02700000-0000-0000-0000-0000000000c9');
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, currency, client_po_number) values
  ('02700000-0000-0000-0000-0000000000e1', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', 'NAR WO', 'Issued', 'WO-NAR-1', 2000000, 'exclusive', 0, 'IDR', 'PO-NAR-777'),
  ('02700000-0000-0000-0000-0000000000e9', '02700000-0000-0000-0000-000000000002', '02700000-0000-0000-0000-0000000000d9', 'NAR X WO', 'Issued', 'WO-NAR-X', 2000000, 'exclusive', 0, 'IDR', 'PO-NAR-X');
-- NFR-NAR-002: read back the org row's lock with pgrowlocks (a single session cannot race two transactions).
create extension if not exists pgrowlocks;

select ok(not exists (select 1 from pgrowlocks('public.organizations') l join public.organizations o on o.ctid = l.locked_row
                       where o.id = '02700000-0000-0000-0000-000000000001' and 'For Share' = any(l.modes)),
  'NFR-NAR-002 CONTROL before any create the org row is not share-locked (the setup''s foreign keys take only KEY SHARE)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","description":"Site survey","qty":2,"rate":500000}]'::jsonb) $$,
  'AC-NAR-001 a Finance user raises an invoice for a project and a client');                                        -- 1
select is(
  (select row(status, pmo_native, tax_treatment, tax_rate, tax_base_numerator, tax_base_denominator, tax_amount, amount, currency)::text
     from public.sales_invoices where native_lines @> '[{"description":"Site survey"}]'),
  row('Draft', true, 'exclusive', 12.000::numeric(6,3), 11, 12, 110000.00::numeric(14,2), 1000000.00::numeric(14,2), 'IDR')::text,
  'AC-NAR-001 it is a Draft of 1,000,000 excl. PPN at the project''s 12% on 11/12 (tax 110,000) in the project''s currency'); -- 2
select is(
  (select row(si_number, pmo_number, invoice_date, erp_outstanding_amount, reference_number, author_user_id)::text
     from public.sales_invoices where native_lines @> '[{"description":"Site survey"}]'),
  row(null::text, null::text, null::date, null::numeric(14,2), 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000a1'::uuid)::text,
  'AC-NAR-001 a Draft has no number, date or balance yet; its reference is the project''s contract reference; the author is the caller'); -- 3
select is(
  (select array_agg(a.user_id)::text from public.sales_invoice_authors a
     join public.sales_invoices si on si.id = a.sales_invoice_id
    where si.native_lines @> '[{"description":"Site survey"}]'),
  '{02700000-0000-0000-0000-0000000000a1}',
  'AC-NAR-001 the author set — the approval SoD oracle (0132) — records the creator');                              -- 4
select is(
  (select native_lines from public.sales_invoices where native_lines @> '[{"description":"Site survey"}]'),
  '[{"item_code":"SVC","description":"Site survey","qty":2,"rate":500000,"amount":1000000.00}]'::jsonb,
  'AC-NAR-001 the lines are kept as raised, each with its amount');                                                  -- 5
select lives_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d2', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","description":"No VAT work","qty":1,"rate":250000}]'::jsonb) $$,
  'AC-NAR-001 an invoice on a project not subject to VAT is accepted');                                             -- 6
select is(
  (select row(tax_rate, tax_amount)::text from public.sales_invoices where native_lines @> '[{"description":"No VAT work"}]'),
  row(0.000::numeric(6,3), 0.00::numeric(14,2))::text,
  'AC-NAR-001 a project not subject to VAT carries no tax (OD-TAX-4)');                                             -- 7
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d3', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  'P0001', 'this project is subject to VAT but has no VAT rate: record it with the contract value before invoicing',
  'AC-NAR-001 a VAT project with no recorded rate is refused, never invoiced untaxed (DD-TAX-4a)');                 -- 8
select lives_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","description":"WO billing","qty":1,"rate":1000000}]'::jsonb, '02700000-0000-0000-0000-0000000000e1') $$,
  'AC-NAR-001 an invoice may name an issued work order on its project');                                           -- 9
select is(
  (select row(work_order_id, reference_number, currency)::text from public.sales_invoices where native_lines @> '[{"description":"WO billing"}]'),
  row('02700000-0000-0000-0000-0000000000e1'::uuid, 'PO-NAR-777', 'IDR')::text,
  'AC-NAR-001 a work-order invoice takes the client PO and the currency from the work order (DD-BWO-8)');            -- 10
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","description":"Over WO","qty":1,"rate":1000000.01}]'::jsonb, '02700000-0000-0000-0000-0000000000e1') $$,
  'BW001', 'this invoice would bill 1000000.01 against work order WO-NAR-1 (worth 2000000.00 excl. tax, with 1000000.00 already invoiced or in draft): only 1000000.00 is still to invoice',
  'AC-NAR-001 a PMO invoice cannot bill past its work order (0262, DD-BWO-4)');                                     -- 11
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d9', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  'P0002', 'project not found', 'AC-NAR-001 another org''s project is refused');                                     -- 12
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c9',
  '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  'P0002', 'customer not found', 'AC-NAR-001 another org''s customer is refused');                                   -- 13
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb, '02700000-0000-0000-0000-0000000000e9') $$,
  'P0002', 'work order not found', 'AC-NAR-001 another org''s work order is refused');
reset role;
select ok(exists (select 1 from pgrowlocks('public.organizations') l join public.organizations o on o.ctid = l.locked_row
                   where o.id = '02700000-0000-0000-0000-000000000001' and 'For Share' = any(l.modes)),
  'NFR-NAR-002 a create holds the org row FOR SHARE, so an ERP take-over waits for it and then counts its draft');
set local role authenticated;
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[]'::jsonb) $$,
  '23514', 'an invoice needs between 1 and 100 lines', 'AC-NAR-001 an invoice with no lines is refused');           -- 14
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1.0001,"rate":100}]'::jsonb) $$,
  '23514', 'each line needs an item code or a description (up to 140 characters each), a quantity above zero with at most 3 decimals, and a rate of zero or more with at most 2 decimals',
  'AC-NAR-001 a quantity with more than 3 decimals is refused');                                                    -- 15
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":"100"}]'::jsonb) $$,
  '23514', 'each line needs an item code or a description (up to 140 characters each), a quantity above zero with at most 3 decimals, and a rate of zero or more with at most 2 decimals',
  'AC-NAR-001 a rate that is not a JSON number is refused, never coerced');                                          -- 16
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"qty":1,"rate":100}]'::jsonb) $$,
  '23514', 'each line needs an item code or a description (up to 140 characters each), a quantity above zero with at most 3 decimals, and a rate of zero or more with at most 2 decimals',
  'AC-NAR-001 a line with neither item code nor description is refused');                                          -- 17
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":0}]'::jsonb) $$,
  '23514', 'the invoice total must be above zero', 'AC-NAR-001 a zero-total invoice is refused');                     -- 18
select throws_ok($$ insert into public.sales_invoices (project_id, customer_id, amount, tax_treatment, tax_amount, pmo_native)
  values ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 100, 'exclusive', 0, true) $$,
  '42501', null, 'AC-NAR-001 no client marks a row as a PMO invoice except through the RPC (pmo_native is not granted)'); -- 19

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-NAR-001 a Project Manager cannot raise an invoice'); -- 20
select is((select count(*)::int from public.sales_invoices where native_lines @> '[{"description":"Site survey"}]'), 1,
  'AC-NAR-001 the Draft lists for the org — any active member reads it');                                          -- 21

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-NAR-001 an offboarded Finance member cannot raise an invoice');                                                -- 22

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.sales_invoices where native_lines @> '[{"description":"Site survey"}]'), 0,
  'AC-NAR-001 another org cannot see the invoice');                                                                  -- 23

select * from finish();
rollback;
