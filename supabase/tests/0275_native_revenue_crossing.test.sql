-- 0275_native_revenue_crossing.test.sql — #784 AC-NAR-004 (DD-NAR-11, OD-XING-1 default): once an ERP owns revenue,
-- PMO invoices and receipts from before stay readable, every PMO write is refused (RPC + mirror guards), and the ERP
-- cannot take revenue over while a PMO draft is open. DD-NAR-16: at that moment every PMO invoice still owed is stamped
-- with its outstanding (erp_opening_amount / erp_opening_at) — the tally Finance reconciles against the one opening
-- entry posted in the ERP; Paid and Cancelled invoices are never stamped; only the employ path writes the stamps, and
-- they stay as history if the ERP is released. Migration under test: 0275 §6–§7.
begin;
create extension if not exists pgtap;
select plan(25);

insert into organizations (id, name) values
  ('02700000-0000-0000-0000-000000000001', 'NAR Org');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02700000-0000-0000-0000-0000000000a2', 'nar-fin2@example.com'),
  ('02700000-0000-0000-0000-0000000000a3', 'nar-admin@example.com'),
  ('02700000-0000-0000-0000-0000000000a4', 'nar-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-000000000001', 'NAR Fin Two', 'nar-fin2@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a3', '02700000-0000-0000-0000-000000000001', 'NAR Admin', 'nar-admin@example.com', 'Admin', 'active'),
  ('02700000-0000-0000-0000-0000000000a4', '02700000-0000-0000-0000-000000000001', 'NAR PM', 'nar-pm@example.com', 'Project Manager', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Pre-connect unpaid","qty":1,"rate":1000}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Pre-connect draft","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Pre-connect paid","qty":1,"rate":500}]'::jsonb);
end $$;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'), 'Unpaid');
  perform public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'), p_amount => 100, p_date => (select invoice_date from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'));
  perform public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect paid"}]'), 'Unpaid');
  perform public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect paid"}]'), p_date => (select invoice_date from public.sales_invoices where native_lines @> '[{"description":"Pre-connect paid"}]'));
end $$;

reset role;
set local request.jwt.claims = '{}';
select throws_ok($$ insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('02700000-0000-0000-0000-000000000001', 'erpnext', 'revenue') $$,
  'P0001', 'approve or cancel the 1 draft invoice(s) raised in PMO before the ERP takes over customer invoicing',
  'AC-NAR-004 the ERP cannot take over customer invoicing while a PMO draft is open');                              -- 1
select is((select count(*)::int from public.sales_invoices where erp_opening_at is not null), 0,
  'AC-NAR-004 a refused take-over stamps nothing (DD-NAR-16)');                                                      -- 2
select lives_ok($$ insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('02700000-0000-0000-0000-000000000001', 'erpnext', 'procurement') $$,
  'AC-NAR-004 the guard binds the revenue domain only');                                                            -- 3
select is((select count(*)::int from public.sales_invoices where erp_opening_at is not null), 0,
  'AC-NAR-004 another domain''s take-over stamps no invoice (DD-NAR-16)');                                           -- 4
-- NFR-NAR-002: a revenue take-over serialises with create_native_sales_invoice on the org row (create holds FOR SHARE
-- from before it reads who owns revenue until it commits; the take-over takes FOR NO KEY UPDATE before counting
-- drafts). One session cannot race two transactions, so the lock is read back with pgrowlocks after the take-over; the
-- behaviour it protects (no take-over with a draft open, no create once the ERP owns revenue) is asserted at 1 and 9.
create extension if not exists pgrowlocks;
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect draft"}]'), 'Cancelled') $$,
  'AC-NAR-004 setup: Finance cancels the open PMO draft');                                                          -- 5
reset role;
set local request.jwt.claims = '{}';
select lives_ok($$ insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('02700000-0000-0000-0000-000000000001', 'erpnext', 'revenue') $$,
  'AC-NAR-004 with no PMO draft open, the ERP takes over customer invoicing');                                      -- 6
select ok(exists (select 1 from pgrowlocks('public.organizations') l join public.organizations o on o.ctid = l.locked_row
                   where o.id = '02700000-0000-0000-0000-000000000001' and 'For No Key Update' = any(l.modes)),
  'NFR-NAR-002 the revenue take-over holds the org row (FOR NO KEY UPDATE) before counting PMO drafts');
select is(
  (select row(erp_opening_amount, erp_opening_at is not null)::text from public.sales_invoices
    where native_lines @> '[{"description":"Pre-connect unpaid"}]'),
  row(1010.00::numeric(14,2), true)::text,
  'AC-NAR-004 an invoice still owed is stamped with its 1,010 outstanding at connect — the ERP opening tally (DD-NAR-16)'); -- 7
select is(
  (select count(*)::int from public.sales_invoices
    where (native_lines @> '[{"description":"Pre-connect paid"}]' or native_lines @> '[{"description":"Pre-connect draft"}]')
      and (erp_opening_amount is not null or erp_opening_at is not null)),
  0, 'AC-NAR-004 Paid and Cancelled invoices are never stamped — they are not in the ERP opening (DD-NAR-16)');      -- 8

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  'AC-NAR-004 no new PMO invoice once the ERP owns revenue');                                                       -- 9
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'), 'Cancelled') $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  'AC-NAR-004 a pre-connect PMO invoice cannot be cancelled in PMO');                                                -- 10
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'), p_amount => 10, p_date => (select invoice_date from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]')) $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  'AC-NAR-004 a pre-connect PMO invoice takes no PMO receipt');                                                      -- 11
select throws_ok($$ select public.cancel_native_receipt((select id from public.incoming_payments where pmo_native and amount = 100)) $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  'AC-NAR-004 a pre-connect PMO receipt cannot be cancelled in PMO');                                                -- 12
select throws_ok($$ update public.sales_invoices set erp_opening_amount = 0 where native_lines @> '[{"description":"Pre-connect unpaid"}]' $$,
  '42501', null, 'AC-NAR-004 a Finance member cannot write the ERP opening stamp directly (DD-NAR-16)');              -- 13
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ update public.sales_invoices set erp_opening_at = null where native_lines @> '[{"description":"Pre-connect unpaid"}]' $$,
  '42501', null, 'AC-NAR-004 an Admin cannot write the ERP opening stamp directly either (DD-NAR-16)');              -- 14

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from public.sales_invoices where pmo_native), 3,
  'AC-NAR-004 the PMO invoices from before connect stay listed and readable');                                      -- 15
select is((select count(*)::int from public.incoming_payments where pmo_native), 2,
  'AC-NAR-004 the PMO receipts from before connect stay listed and readable');                                      -- 16

reset role;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ update public.sales_invoices set pmo_number = 'INV-FORGED' where native_lines @> '[{"description":"Pre-connect unpaid"}]' $$,
  '42501', 'sales_invoices native fields are read-only while revenue is externally-owned',
  'AC-NAR-004 the mirror guard pins the PMO number while the ERP owns revenue (DD-WO-4 paired edit)');              -- 17
select throws_ok($$ update public.sales_invoices set native_lines = '[]' where native_lines @> '[{"description":"Pre-connect unpaid"}]' $$,
  '42501', 'sales_invoices native fields are read-only while revenue is externally-owned',
  'AC-NAR-004 …and the PMO lines');                                                                                  -- 18
select throws_ok($$ update public.sales_invoices set erp_opening_amount = 1 where native_lines @> '[{"description":"Pre-connect unpaid"}]' $$,
  '42501', 'sales_invoices native fields are read-only while revenue is externally-owned',
  'AC-NAR-004 …and the ERP opening stamp (DD-NAR-16)');                                                              -- 19
select throws_ok($$ update public.sales_invoices set overpaid_amount = 5 where native_lines @> '[{"description":"Pre-connect unpaid"}]' $$,
  '42501', 'sales_invoices native fields are read-only while revenue is externally-owned',
  'AC-NAR-004 …and the overpaid figure (DD-NAR-17)');                                                                -- 19b
select throws_ok($$ update public.incoming_payments set cancelled_at = now() where pmo_native $$,
  '42501', 'incoming_payments native fields are read-only while revenue is externally-owned',
  'AC-NAR-004 …and a PMO receipt''s cancellation stamp');                                                            -- 20

set local request.jwt.claims = '{}';
delete from public.external_domain_ownership where org_id = '02700000-0000-0000-0000-000000000001' and domain = 'revenue';
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'), p_amount => 10, p_date => (select invoice_date from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]')) $$,
  'AC-NAR-004 releasing the ERP re-opens PMO invoicing on the same rows — the crossing is reversible');             -- 21
select is(
  (select row(erp_opening_amount, erp_outstanding_amount)::text from public.sales_invoices
    where native_lines @> '[{"description":"Pre-connect unpaid"}]'),
  row(1010.00::numeric(14,2), 1000.00::numeric(14,2))::text,
  'AC-NAR-004 after release the opening stamp stays as history while the balance moves on (DD-NAR-16)');            -- 22
reset role;
set local request.jwt.claims = '{}';
insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('02700000-0000-0000-0000-000000000001', 'erpnext', 'revenue');
select is(
  (select erp_opening_amount from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'),
  1010.00::numeric(14,2),
  'AC-NAR-004 a later take-over keeps the first opening stamp — it is history, never rewritten (DD-NAR-16)');       -- 23

select * from finish();
rollback;
