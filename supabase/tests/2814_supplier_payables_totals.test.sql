-- 2814: the home screen's supplier figures from one server read equal the browser's row-by-row sums, for every role.
-- Each fixture row names the browser rule it exercises (procurementMoney.ts supplierUnpaid, useCompanyFigures.ts splitPayables);
-- the expected figures are the browser's (pinned by useCompanyFigures.supplierTotals.test.ts on the same rows).
begin;
create extension if not exists pgtap;
select plan(12);

insert into public.organizations (id, name, default_currency) values
  ('28140000-0000-0000-0000-00000000000a', 'Payables A', 'IDR'),
  ('28140000-0000-0000-0000-00000000000b', 'Payables B', 'IDR');
insert into auth.users (id, email) values
  ('28140000-0000-0000-0000-0000000000a1', 'pay-fin@example.test'),
  ('28140000-0000-0000-0000-0000000000a2', 'pay-exec@example.test'),
  ('28140000-0000-0000-0000-0000000000a3', 'pay-eng@example.test'),
  ('28140000-0000-0000-0000-0000000000b1', 'pay-b@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('28140000-0000-0000-0000-0000000000a1', '28140000-0000-0000-0000-00000000000a', 'Fin', 'pay-fin@example.test', 'Finance', 'active'),
  ('28140000-0000-0000-0000-0000000000a2', '28140000-0000-0000-0000-00000000000a', 'Exec', 'pay-exec@example.test', 'Executive', 'active'),
  ('28140000-0000-0000-0000-0000000000a3', '28140000-0000-0000-0000-00000000000a', 'Eng', 'pay-eng@example.test', 'Engineer', 'active'),
  ('28140000-0000-0000-0000-0000000000b1', '28140000-0000-0000-0000-00000000000b', 'B Fin', 'pay-b@example.test', 'Finance', 'active');

insert into public.procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
  -- P0 the only waiting purchase in its currency and no supplier invoice date: no age, so no oldest age (not 0 days).
  ('28140000-0000-0000-0000-0000000000e0', '28140000-0000-0000-0000-00000000000a', 'P0', '28140000-0000-0000-0000-0000000000a1', 'EUR', 10, 'Draft'),
  -- P1 known 1000 - 300 Paid (the Scheduled 500 is not paid) = 700, 27 days old: not due.
  ('28140000-0000-0000-0000-0000000000e1', '28140000-0000-0000-0000-00000000000a', 'P1', '28140000-0000-0000-0000-0000000000a3', 'IDR', 1000, 'Draft'),
  -- P2 known 500, 150 days old: overdue; the voided 999 bill neither counts nor dates it.
  ('28140000-0000-0000-0000-0000000000e2', '28140000-0000-0000-0000-00000000000a', 'P2', '28140000-0000-0000-0000-0000000000a1', 'IDR', 500, 'Draft'),
  -- P3 no supplier invoice at all: unknown, no age.
  ('28140000-0000-0000-0000-0000000000e3', '28140000-0000-0000-0000-00000000000a', 'P3', '28140000-0000-0000-0000-0000000000a1', 'IDR', 10, 'Draft'),
  -- P4 only an accounting invoice: its outstanding 250.55 is the balance, no age (not due).
  ('28140000-0000-0000-0000-0000000000e4', '28140000-0000-0000-0000-00000000000a', 'P4', '28140000-0000-0000-0000-0000000000a1', 'USD', 800, 'Draft'),
  -- P5 100.10 invoiced less 150 Paid less a 10 accounting payment: never below zero (0), 119 days old: overdue.
  ('28140000-0000-0000-0000-0000000000e5', '28140000-0000-0000-0000-00000000000a', 'P5', '28140000-0000-0000-0000-0000000000a1', 'USD', 100, 'Draft'),
  -- P6 not waiting for payment: left out.
  ('28140000-0000-0000-0000-0000000000e6', '28140000-0000-0000-0000-00000000000a', 'P6', '28140000-0000-0000-0000-0000000000a1', 'IDR', 70, 'Draft'),
  -- P7 only a cancelled accounting invoice: the browser never reads it, so no invoice at all: unknown.
  ('28140000-0000-0000-0000-0000000000e7', '28140000-0000-0000-0000-00000000000a', 'P7', '28140000-0000-0000-0000-0000000000a1', 'IDR', 70, 'Draft'),
  -- Another organisation's purchase: never seen.
  ('28140000-0000-0000-0000-0000000000f1', '28140000-0000-0000-0000-00000000000b', 'B1', '28140000-0000-0000-0000-0000000000b1', 'IDR', 9999, 'Draft');
insert into public.procurement_invoices (id, org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount, invoice_date, voided_at) values
  ('28140000-0000-0000-0000-0000000000c1', '28140000-0000-0000-0000-00000000000a', '28140000-0000-0000-0000-0000000000e1', 'Received', 1000, 'IDR', 'inclusive', 0, '2026-11-01', null),
  ('28140000-0000-0000-0000-0000000000c2', '28140000-0000-0000-0000-00000000000a', '28140000-0000-0000-0000-0000000000e2', 'Received', 500, 'IDR', 'inclusive', 0, '2026-07-01', null),
  ('28140000-0000-0000-0000-0000000000c3', '28140000-0000-0000-0000-00000000000a', '28140000-0000-0000-0000-0000000000e2', 'Received', 999, 'IDR', 'inclusive', 0, '2026-01-01', null),
  ('28140000-0000-0000-0000-0000000000c5', '28140000-0000-0000-0000-00000000000a', '28140000-0000-0000-0000-0000000000e5', 'Received', 100.10, 'USD', 'inclusive', 0, '2026-08-01', null),
  ('28140000-0000-0000-0000-0000000000c6', '28140000-0000-0000-0000-00000000000a', '28140000-0000-0000-0000-0000000000e6', 'Received', 70, 'IDR', 'inclusive', 0, '2026-01-01', null),
  ('28140000-0000-0000-0000-0000000000cf', '28140000-0000-0000-0000-00000000000b', '28140000-0000-0000-0000-0000000000f1', 'Received', 9999, 'IDR', 'inclusive', 0, '2026-01-01', null);
insert into public.payments (id, org_id, procurement_id, invoice_id, status, date, amount, currency) values
  ('28140000-0000-0000-0000-0000000000d1', '28140000-0000-0000-0000-00000000000a', '28140000-0000-0000-0000-0000000000e1', null, 'Paid', '2026-11-10', 300, 'IDR'),
  ('28140000-0000-0000-0000-0000000000d2', '28140000-0000-0000-0000-00000000000a', '28140000-0000-0000-0000-0000000000e1', null, 'Scheduled', '2026-12-10', 500, 'IDR'),
  ('28140000-0000-0000-0000-0000000000d5', '28140000-0000-0000-0000-00000000000a', '28140000-0000-0000-0000-0000000000e5', null, 'Paid', '2026-09-10', 150, 'USD');
insert into public.erp_purchase_documents (id, org_id, erp_doctype, erp_name, currency, grand_total, outstanding_amount, erp_docstatus, erp_modified) values
  ('28140000-0000-0000-0000-000000000901', '28140000-0000-0000-0000-00000000000a', 'Purchase Invoice', 'PINV-P4', 'USD', 800, 250.55, 1, '2026-11-01'),
  ('28140000-0000-0000-0000-000000000902', '28140000-0000-0000-0000-00000000000a', 'Payment Entry', 'PE-P5', 'USD', 10, null, 1, '2026-11-01'),
  ('28140000-0000-0000-0000-000000000903', '28140000-0000-0000-0000-00000000000a', 'Purchase Invoice', 'PINV-P7', 'IDR', 70, 70, 2, '2026-11-01');
insert into public.procurement_erp_links (org_id, procurement_id, erp_purchase_document_id) values
  ('28140000-0000-0000-0000-00000000000a', '28140000-0000-0000-0000-0000000000e4', '28140000-0000-0000-0000-000000000901'),
  ('28140000-0000-0000-0000-00000000000a', '28140000-0000-0000-0000-0000000000e5', '28140000-0000-0000-0000-000000000902'),
  ('28140000-0000-0000-0000-00000000000a', '28140000-0000-0000-0000-0000000000e7', '28140000-0000-0000-0000-000000000903');
-- The state under test, whatever the triggers derived on the way (a voided bill, then each purchase's status).
alter table public.procurement_invoices disable trigger user;
update public.procurement_invoices set voided_at = now(), erp_cancelled_at = now(), void_reason = 'test void' where id = '28140000-0000-0000-0000-0000000000c3';
alter table public.procurement_invoices enable trigger user;
alter table public.procurements disable trigger user;
update public.procurements set status = case when title = 'P6' then 'Ordered' else 'Vendor Invoiced' end::public.procurement_status
 where id::text like '28140000-%';
alter table public.procurements enable trigger user;

create temp table expected (currency text, invoice_count int, unknown_count int, known_count int, known_total numeric,
  not_due_count int, not_due_total numeric, overdue_known_count int, overdue_total numeric, overdue_count int, oldest_days int);
insert into expected values
  ('EUR', 1, 1, 0, 0, 0, 0, 0, 0, 0, null),
  ('IDR', 4, 2, 2, 1200, 1, 700, 1, 500, 1, 150),
  ('USD', 2, 0, 2, 250.55, 1, 250.55, 1, 0, 1, 119);
grant select on expected to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"28140000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select oldest_days from public.get_supplier_payables_totals('2026-11-28') where currency = 'EUR'), null::int,
  '2814 a currency whose waiting purchases carry no invoice date has no oldest age, not 0 days');
select results_eq($$ select * from public.get_supplier_payables_totals('2026-11-28') $$,
  $$ select * from expected order by currency $$, '2814 Finance: totals equal the browser rule, currency by currency');
-- The row-by-row sum the browser makes, from the rows Finance may read, equals the function's known total.
select is((select sum(known_total) from public.get_supplier_payables_totals('2026-11-28') where currency = 'IDR'),
  (select sum(greatest(i.amount - coalesce((select sum(y.amount) from public.payments y where y.procurement_id = p.id and y.status = 'Paid'), 0), 0))
     from public.procurements p join public.procurement_invoices i on i.procurement_id = p.id and i.voided_at is null
    where p.status = 'Vendor Invoiced' and p.currency = 'IDR'),
  '2814 Finance: IDR known total equals the row-by-row sum of readable rows');
select is((select count(*)::int from public.get_supplier_payables_totals('2026-11-28')), 3, '2814 another organisation''s purchases are never counted');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"28140000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq($$ select * from public.get_supplier_payables_totals('2026-11-28') $$,
  $$ select * from expected order by currency $$, '2814 Executive: the same totals');
reset role;

-- An Engineer reads only their own requests and none of their supplier bills: P1 alone, its balance unknown, exactly as
-- their purchase list's embeds return it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"28140000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.procurements where status = 'Vendor Invoiced'), 1, '2814 Engineer reads one purchase waiting for payment');
select is((select count(*)::int from public.procurement_invoices_masked), 0, '2814 Engineer reads none of the supplier bills');
select results_eq($$ select currency, invoice_count, unknown_count, known_total from public.get_supplier_payables_totals('2026-11-28') $$,
  $$ values ('IDR'::text, 1, 1, 0::numeric) $$, '2814 Engineer: totals cover only the rows they may read');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"28140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select results_eq($$ select currency, invoice_count, unknown_count, known_total from public.get_supplier_payables_totals('2026-11-28') $$,
  $$ values ('IDR'::text, 1, 0, 9999::numeric) $$, '2814 the other organisation sees only its own');
reset role;

select is((select prosecdef from pg_proc where oid = 'public.get_supplier_payables_totals(date)'::regprocedure), false, '2814 security invoker: each role keeps its own row and price visibility');
select ok(not has_function_privilege('anon', 'public.get_supplier_payables_totals(date)', 'execute'), '2814 anon cannot call it');
select ok(has_function_privilege('authenticated', 'public.get_supplier_payables_totals(date)', 'execute'), '2814 signed-in members can call it');

select * from finish();
rollback;
