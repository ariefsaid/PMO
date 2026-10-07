-- 0275_native_revenue_serialise.test.sql — #784 NFR-NAR-002 (the brief's cancel half): cancel_native_receipt
-- serialises with an ERP take-over of revenue on the org row — it takes `organizations … for share` BEFORE its
-- ownership check, the same lock create_native_sales_invoice takes from before its own ownership read — and,
-- sequentially, once the ERP owns revenue a Paid PMO invoice's receipt can no longer be cancelled in PMO.
-- One session cannot race two transactions, so the lock is read back with pgrowlocks the way the create test
-- does: control (no FOR SHARE before the write), the writer runs, the lock is on the org row. The cancel is
-- the ONLY org-locking statement in this transaction, so the positive assertion is unambiguously its own.
-- (set_sales_invoice_received_date's lock has its own file — one clean proof per transaction.)
-- Migration under test: 0275_native_revenue.sql §5.
begin;
create extension if not exists pgtap;
create extension if not exists pgrowlocks;
select plan(10);

insert into organizations (id, name) values ('02700000-0000-0000-0000-000000000001', 'NAR Org');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02700000-0000-0000-0000-0000000000a2', 'nar-fin2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-000000000001', 'NAR Fin Two', 'nar-fin2@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1');
-- Two approved (Paid) PMO invoices, each settled by one PMO receipt, and one ERP-path invoice. Seeded directly
-- (the shapes production writes) so no RPC runs before the control.
insert into public.sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount,
                                   tax_rate, tax_base_numerator, tax_base_denominator, currency, status, pmo_native,
                                   native_lines, erp_outstanding_amount) values
  ('02700000-0000-0000-0000-0000000000e1', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1',
   '02700000-0000-0000-0000-0000000000c1', '2026-07-01', 1000, 'exclusive', 120, 12, 11, 12, 'IDR', 'Paid', true,
   '[{"item_code":"SVC","description":"Serialise paid one","qty":1,"rate":1000,"amount":1000.00}]'::jsonb, 0),
  ('02700000-0000-0000-0000-0000000000e2', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1',
   '02700000-0000-0000-0000-0000000000c1', '2026-07-01', 1000, 'exclusive', 120, 12, 11, 12, 'IDR', 'Paid', true,
   '[{"item_code":"SVC","description":"Serialise paid two","qty":1,"rate":1000,"amount":1000.00}]'::jsonb, 0),
  ('02700000-0000-0000-0000-0000000000e3', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1',
   '02700000-0000-0000-0000-0000000000c1', '2026-07-01', 100, 'exclusive', 0, null, 1, 1, 'IDR', 'Unpaid', false,
   null, null);
update public.sales_invoices set si_number = 'SI-ERP-1', erp_docstatus = 1 where id = '02700000-0000-0000-0000-0000000000e3';
insert into public.incoming_payments (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount,
                                      withheld_amount, currency, status, pmo_native) values
  ('02700000-0000-0000-0000-0000000000f1', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1',
   '02700000-0000-0000-0000-0000000000e1', '2026-07-02', 1120, 1120, 0, 'IDR', 'Paid', true),
  ('02700000-0000-0000-0000-0000000000f2', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1',
   '02700000-0000-0000-0000-0000000000e2', '2026-07-02', 1120, 1120, 0, 'IDR', 'Paid', true);

select ok(not exists (select 1 from pgrowlocks('public.organizations') l join public.organizations o on o.ctid = l.locked_row
                       where o.id = '02700000-0000-0000-0000-000000000001' and 'For Share' = any(l.modes)),
  'NFR-NAR-002 CONTROL before the cancel the org row is not share-locked (the seed''s foreign keys take only KEY SHARE)'); -- 1
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.cancel_native_receipt('02700000-0000-0000-0000-0000000000f2') $$,
  'AC-NAR-006 while PMO owns revenue, Finance cancels a Paid PMO invoice''s receipt');                                -- 2
select is((select status from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000e2'), 'Unpaid',
  'AC-NAR-006 the Paid invoice is owed again once its only receipt is cancelled');                                    -- 3
select is((select erp_outstanding_amount from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000e2'),
  1110.00::numeric(14,2), 'AC-NAR-006 …and its balance is the gross again (restate, never an increment)');            -- 4
reset role;
select ok(exists (select 1 from pgrowlocks('public.organizations') l join public.organizations o on o.ctid = l.locked_row
                   where o.id = '02700000-0000-0000-0000-000000000001' and 'For Share' = any(l.modes)),
  'NFR-NAR-002 the receipt-cancel holds the org row FOR SHARE from before its ownership check — the create''s pattern'); -- 5

-- ── the sequential proof: the ERP takes revenue over, then the PMO writers refuse ───────────────────────────
set local request.jwt.claims = '{}';
select lives_ok($$ insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('02700000-0000-0000-0000-000000000001', 'erpnext', 'revenue') $$,
  'setup: with no PMO draft open, the ERP takes over customer invoicing');                                            -- 6
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.cancel_native_receipt('02700000-0000-0000-0000-0000000000f1') $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  'AC-NAR-004 once the ERP owns revenue, cancelling the Paid invoice''s PMO receipt is refused');                     -- 7
select is((select cancelled_at is null from public.incoming_payments where id = '02700000-0000-0000-0000-0000000000f1'),
  true, 'AC-NAR-004 …and the refused cancel leaves the receipt live');                                                -- 8
select throws_ok($$ select public.set_sales_invoice_received_date('02700000-0000-0000-0000-0000000000e1', null) $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  'DD-NAR-11 …and the frozen PMO invoice takes no received date either');                                             -- 9
select lives_ok($$ select public.set_sales_invoice_received_date('02700000-0000-0000-0000-0000000000e3', '2026-07-10') $$,
  'CONTROL an ERP invoice''s received date is still recorded while the ERP owns revenue');                            -- 10

select * from finish();
rollback;
