-- 0275_native_revenue_rollback_guard.test.sql — #784 NFR-NAR-004: 0275's rollback refuses to run while a
-- PMO-native invoice or receipt exists, and its precondition passes when none does. The rollback is a psql
-- script, not a migration the test runner applies, so this file runs the GUARD the script opens with — the
-- same DO block, kept verbatim in step with supabase/migrations/rollback/0275_native_revenue_down.sql —
-- against a native invoice and against a native receipt. The script itself is exercised end-to-end (refuses
-- with a native row present; runs clean on an empty native set) by the Task-16 round trip in
-- docs/plans/2026-10-07-no-erp-revenue.md.
-- Migration under test: 0275_native_revenue.sql §1 (the pmo_native markers the guard reads).
begin;
create extension if not exists pgtap;
select plan(3);

-- 1. The empty native set passes the guard — the rollback may run.
select lives_ok($$
  do $rollback_precondition$
  begin
    if exists (select 1 from public.sales_invoices where pmo_native)
       or exists (select 1 from public.incoming_payments where pmo_native) then
      raise exception
        'rollback precondition unmet: PMO-native invoices or receipts exist — approve, cancel or reverse them (0275) before dropping the native revenue columns'
        using errcode = '55006';  -- object_in_use
    end if;
  end
  $rollback_precondition$;
$$, 'NFR-NAR-004 with no PMO-native row the rollback precondition passes');                                        -- 1

-- Seed fixtures for the two raising arms: a PMO-native invoice, then a PMO-native receipt.
insert into organizations (id, name) values ('02700000-0000-0000-0000-000000000001', 'NAR Org');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into public.sales_invoices (id, org_id, project_id, customer_id, amount, currency, tax_treatment, tax_amount,
                                   status, pmo_native, native_lines) values
  ('02700000-0000-0000-0000-0000000000e1', '02700000-0000-0000-0000-000000000001', null,
   '02700000-0000-0000-0000-0000000000c1', 100, 'IDR', 'exclusive', 0, 'Draft', true, '[]'::jsonb);

select throws_ok($$
  do $rollback_precondition$
  begin
    if exists (select 1 from public.sales_invoices where pmo_native)
       or exists (select 1 from public.incoming_payments where pmo_native) then
      raise exception
        'rollback precondition unmet: PMO-native invoices or receipts exist — approve, cancel or reverse them (0275) before dropping the native revenue columns'
        using errcode = '55006';  -- object_in_use
    end if;
  end
  $rollback_precondition$;
$$, '55006',
  'rollback precondition unmet: PMO-native invoices or receipts exist — approve, cancel or reverse them (0275) before dropping the native revenue columns',
  'NFR-NAR-004 the rollback refuses to run while a PMO-native invoice exists');                                    -- 2

delete from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000e1';
insert into public.sales_invoices (id, org_id, project_id, customer_id, si_number, amount, currency, tax_treatment,
                                   tax_amount, status, erp_docstatus) values
  ('02700000-0000-0000-0000-0000000000e2', '02700000-0000-0000-0000-000000000001', null,
   '02700000-0000-0000-0000-0000000000c1', 'SI-RB-1', 100, 'IDR', 'exclusive', 0, 'Unpaid', 1);
insert into public.incoming_payments (id, org_id, customer_id, sales_invoice_id, date, amount, currency, status, pmo_native) values
  ('02700000-0000-0000-0000-0000000000f1', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1',
   '02700000-0000-0000-0000-0000000000e2', '2026-07-02', 100, 'IDR', 'Paid', true);

select throws_ok($$
  do $rollback_precondition$
  begin
    if exists (select 1 from public.sales_invoices where pmo_native)
       or exists (select 1 from public.incoming_payments where pmo_native) then
      raise exception
        'rollback precondition unmet: PMO-native invoices or receipts exist — approve, cancel or reverse them (0275) before dropping the native revenue columns'
        using errcode = '55006';  -- object_in_use
    end if;
  end
  $rollback_precondition$;
$$, '55006',
  'rollback precondition unmet: PMO-native invoices or receipts exist — approve, cancel or reverse them (0275) before dropping the native revenue columns',
  'NFR-NAR-004 the rollback refuses to run while a PMO-native receipt exists');                                    -- 3

select * from finish();
rollback;
