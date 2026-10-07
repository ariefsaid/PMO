-- 0275_native_revenue_received_date_lock.test.sql — #784 NFR-NAR-002 (the received-date half):
-- set_sales_invoice_received_date serialises with an ERP take-over of revenue on the org row — it takes
-- `organizations … for share` BEFORE its frozen check, the same lock every PMO revenue writer takes from
-- before its own ownership read. One session cannot race two transactions, so the lock is read back with
-- pgrowlocks the way the create test does: control (no FOR SHARE before the write), the writer runs, the
-- lock is on the org row. The writer is the ONLY org-locking statement in this transaction, so the positive
-- assertion is unambiguously its own. (cancel_native_receipt's lock has its own file — one clean proof per
-- transaction.)
-- Migration under test: 0275_native_revenue.sql §5b.
begin;
create extension if not exists pgtap;
create extension if not exists pgrowlocks;
select plan(3);

insert into organizations (id, name) values ('02700000-0000-0000-0000-000000000001', 'NAR Org');
insert into auth.users (id, email) values ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1');
insert into public.sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount,
                                   tax_rate, tax_base_numerator, tax_base_denominator, currency, status, pmo_native,
                                   native_lines, erp_outstanding_amount) values
  ('02700000-0000-0000-0000-0000000000e1', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1',
   '02700000-0000-0000-0000-0000000000c1', '2026-07-01', 1000, 'exclusive', 120, 12, 11, 12, 'IDR', 'Paid', true,
   '[{"item_code":"SVC","description":"Received date paid","qty":1,"rate":1000,"amount":1000.00}]'::jsonb, 0);

select ok(not exists (select 1 from pgrowlocks('public.organizations') l join public.organizations o on o.ctid = l.locked_row
                       where o.id = '02700000-0000-0000-0000-000000000001' and 'For Share' = any(l.modes)),
  'NFR-NAR-002 CONTROL before the received-date write the org row is not share-locked (the seed''s foreign keys take only KEY SHARE)'); -- 1
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.set_sales_invoice_received_date('02700000-0000-0000-0000-0000000000e1', '2026-07-05') $$,
  '#784 while PMO owns revenue, Finance records a Paid PMO invoice''s received date');                                -- 2
reset role;
select ok(exists (select 1 from pgrowlocks('public.organizations') l join public.organizations o on o.ctid = l.locked_row
                   where o.id = '02700000-0000-0000-0000-000000000001' and 'For Share' = any(l.modes)),
  'NFR-NAR-002 the received-date writer holds the org row FOR SHARE from before its frozen check, so a take-over serialises with it'); -- 3

select * from finish();
rollback;
