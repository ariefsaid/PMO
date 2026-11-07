-- 0731_payment_allocation_unapply_cancel.test.sql — #1415 AC-NPA-007: reversing an allocation restates only its invoice
-- (Paid reopens) and returns the amount to the receipt; cancelling a receipt reverses every live allocation and restates
-- every invoice it touched; an invoice with a live allocation cannot be cancelled until it is unapplied; the direct
-- invoice-first receipt writes its own allocation and cancels through the same path. The three RPCs and the cancel take the
-- org row FOR SHARE before the ownership read and lock invoices in ascending id order (the lock order the plan documents).
-- Migration under test: 0731_payment_allocation.sql §5.
begin;
create extension if not exists pgtap;
create extension if not exists pgrowlocks;
select plan(40);

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

insert into organizations (id, name, default_currency) values ('07310000-0000-0000-0000-000000000001', 'NPA Org', 'IDR');
insert into auth.users (id, email) values
  ('07310000-0000-0000-0000-0000000000a1', 'npa-fin@example.com'),
  ('07310000-0000-0000-0000-0000000000a4', 'npa-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07310000-0000-0000-0000-0000000000a1', '07310000-0000-0000-0000-000000000001', 'NPA Fin', 'npa-fin@example.com', 'Finance', 'active'),
  ('07310000-0000-0000-0000-0000000000a4', '07310000-0000-0000-0000-000000000001', 'NPA PM', 'npa-pm@example.com', 'Project Manager', 'active');
insert into companies (id, org_id, name, type) values
  ('07310000-0000-0000-0000-0000000000c9', '07310000-0000-0000-0000-000000000001', 'NPA Client', 'Client');
insert into public.sales_invoices (id, org_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency,
                                   status, pmo_native, native_lines, erp_outstanding_amount) values
  ('07310000-0000-0000-0000-0000000000e1', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01',  60, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"d":"I1"}]'::jsonb,  60),
  ('07310000-0000-0000-0000-0000000000e2', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"d":"I2"}]'::jsonb, 100),
  ('07310000-0000-0000-0000-0000000000e3', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"d":"I3"}]'::jsonb, 100),
  ('07310000-0000-0000-0000-0000000000e4', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"d":"I4"}]'::jsonb, 100);

-- ── lock order: the org row is share-locked from the first RPC (control first) ──────────────────────────────
select ok(not exists (select 1 from pgrowlocks('public.organizations') l join public.organizations o on o.ctid = l.locked_row
                       where o.id = '07310000-0000-0000-0000-000000000001' and 'For Share' = any(l.modes)),
  'AC-NPA-007 CONTROL before any allocation RPC the org row is not share-locked');                                                       -- 1
set local role authenticated;
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 100, null, null, null, '2026-07-05',
                                                                 '07310000-0000-0000-0000-0000000000f1') $$,
  'setup: an on-account receipt of 100');                                                                                                -- 2
reset role;
select ok(exists (select 1 from pgrowlocks('public.organizations') l join public.organizations o on o.ctid = l.locked_row
                   where o.id = '07310000-0000-0000-0000-000000000001' and 'For Share' = any(l.modes)),
  'AC-NPA-007 the allocation RPC holds the org row FOR SHARE (serialises with an ERP take-over)');                                        -- 3
-- the same rule, read from the shipped bodies: org share lock BEFORE the ownership read; invoices locked in ascending id
select ok((select bool_and(position('for share' in lower(prosrc)) > 0
                           and position('for share' in lower(prosrc)) < position('domain_externally_owned' in prosrc))
             from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('apply_native_receipt','unapply_native_allocation','record_native_on_account_receipt','cancel_native_receipt')),
  'AC-NPA-007 all four bodies take the org row FOR SHARE before they read who owns revenue');                                             -- 4
select ok((select prosrc ~* 'order by[^;]*for update' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'apply_native_receipt'),
  'AC-NPA-007 apply_native_receipt locks its invoices in a fixed order (order by … for update)');                                         -- 5
select ok((select prosrc ~* 'order by[^;]*for update' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'cancel_native_receipt'),
  'AC-NPA-007 cancel_native_receipt locks the receipt''s invoices in the same fixed order');                                              -- 6

-- ── set up an applied receipt: 60 on I1, 40 on I2 ─────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":60},{"invoice_id":"07310000-0000-0000-0000-0000000000e2","amount":40}]'::jsonb,
    gen_random_uuid()) $$, 'setup: the receipt is applied 60 / 40');                                                                      -- 7
select is((select status from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e1'), 'Paid', 'setup: invoice 1 is Paid'); -- 8

-- ── unapply one allocation ─────────────────────────────────────────────────────────────────────────────────
select lives_ok($$ select public.unapply_native_allocation((select id from public.incoming_payment_allocations
    where sales_invoice_id = '07310000-0000-0000-0000-0000000000e1' and reversed_at is null)) $$,
  'AC-NPA-007 Finance unapplies the allocation on invoice 1');                                                                            -- 9
select is((select row(status, erp_outstanding_amount, overpaid_amount)::text from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e1'),
  row('Unpaid', 60.00::numeric(14,2), 0.00::numeric(14,2))::text, 'AC-NPA-007 invoice 1 reopens: Unpaid, owing 60 again');                 -- 10
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e2'),
  row('Unpaid', 60.00::numeric(14,2))::text, 'AC-NPA-007 …and invoice 2 is not touched (still owes the 60 it did)');                       -- 11
select is((select coalesce(sum(amount), 0) from public.incoming_payment_allocations
            where incoming_payment_id = '07310000-0000-0000-0000-0000000000f1' and reversed_at is null),
  40.00::numeric, 'AC-NPA-007 the receipt has 60 left to apply again (only 40 is applied)');                                              -- 12
select is((select row(reversed_by, reversed_at is not null)::text from public.incoming_payment_allocations
            where sales_invoice_id = '07310000-0000-0000-0000-0000000000e1'),
  row('07310000-0000-0000-0000-0000000000a1'::uuid, true)::text, 'AC-NPA-007 the reversal is stamped with its actor and time');           -- 13
select is(pg_temp.err($$ select public.unapply_native_allocation((select id from public.incoming_payment_allocations
    where sales_invoice_id = '07310000-0000-0000-0000-0000000000e1')) $$),
  'P0001:allocation-already-reversed', 'AC-NPA-007 an allocation is reversed once');                                                      -- 14
select is(pg_temp.err($$ select public.unapply_native_allocation(gen_random_uuid()) $$),
  'P0002:', 'AC-NPA-007 an unknown allocation id is a plain "not found"');                                                                 -- 15
select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":20}]'::jsonb, gen_random_uuid()) $$,
  'AC-NPA-007 the freed 60 can be applied again, now 20 to invoice 1');                                                                   -- 16
select is((select erp_outstanding_amount from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e1'), 40.00::numeric(14,2),
  'AC-NPA-007 …and invoice 1 owes 40');                                                                                                   -- 17

-- ── the Project Manager cannot unapply ─────────────────────────────────────────────────────────────────────
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a4');
select is(pg_temp.err($$ select public.unapply_native_allocation((select id from public.incoming_payment_allocations where reversed_at is null limit 1)) $$),
  '42501:', 'AC-NPA-004 a Project Manager cannot unapply');                                                                                -- 18
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a1');

-- ── cancel the receipt: every live allocation is reversed, every invoice restated ──────────────────────────
select lives_ok($$ select public.cancel_native_receipt('07310000-0000-0000-0000-0000000000f1') $$,
  'AC-NPA-007 Finance cancels the partly applied receipt');                                                                               -- 19
select is((select count(*)::int from public.incoming_payment_allocations
            where incoming_payment_id = '07310000-0000-0000-0000-0000000000f1' and reversed_at is null), 0,
  'AC-NPA-007 every live allocation of the cancelled receipt is reversed');                                                               -- 20
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e1'),
  row('Unpaid', 60.00::numeric(14,2))::text, 'AC-NPA-007 invoice 1 owes its whole 60 again');                                              -- 21
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e2'),
  row('Unpaid', 100.00::numeric(14,2))::text, 'AC-NPA-007 invoice 2 owes its whole 100 again');                                           -- 22
select is((select cancelled_at is not null from public.incoming_payments where id = '07310000-0000-0000-0000-0000000000f1'), true,
  'AC-NPA-007 the receipt is cancelled');                                                                                                 -- 23
select is(pg_temp.err($$ select public.cancel_native_receipt('07310000-0000-0000-0000-0000000000f1') $$),
  'P0001:receipt-already-cancelled', 'AC-NPA-007 a receipt is cancelled once');                                                           -- 24
select is(pg_temp.err($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":5}]'::jsonb, gen_random_uuid()) $$),
  'P0001:receipt-not-applicable', 'AC-NPA-007 a cancelled receipt takes no more');                                                        -- 25
select is(pg_temp.err($$ select public.unapply_native_allocation((select id from public.incoming_payment_allocations
    where incoming_payment_id = '07310000-0000-0000-0000-0000000000f1' limit 1)) $$),
  'P0001:allocation-already-reversed', 'AC-NPA-007 an allocation of a cancelled receipt is already reversed');                            -- 26

-- ── an invoice with a live allocation cannot be cancelled until it is unapplied ────────────────────────────
select lives_ok($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 30, null, null, null, '2026-07-05',
                                                                 '07310000-0000-0000-0000-0000000000f2') $$, 'setup: a second on-account receipt of 30'); -- 27
select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f2',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e3","amount":30}]'::jsonb, gen_random_uuid()) $$, 'setup: 30 applied to invoice 3'); -- 28
select is(pg_temp.err($$ select public.transition_native_sales_invoice('07310000-0000-0000-0000-0000000000e3', 'Cancelled') $$),
  'P0001:invoice-has-receipts', 'AC-NPA-007 an invoice with a live allocation cannot be cancelled');                                       -- 29
select lives_ok($$ select public.unapply_native_allocation((select id from public.incoming_payment_allocations
    where sales_invoice_id = '07310000-0000-0000-0000-0000000000e3' and reversed_at is null)) $$, 'AC-NPA-007 …unapply it');                -- 30
select lives_ok($$ select public.transition_native_sales_invoice('07310000-0000-0000-0000-0000000000e3', 'Cancelled') $$,
  'AC-NPA-007 …and then the invoice can be cancelled');                                                                                   -- 31

-- ── the direct invoice-first receipt writes its own allocation and cancels through the same path ───────────
select lives_ok($$ select public.record_native_receipt('07310000-0000-0000-0000-0000000000e4', 100, 100, 0, null, '2026-07-05') $$,
  'AC-NPA-007 Finance records a receipt straight from invoice 4');                                                                        -- 32
select is((select row(count(*), min(amount), min(cash_amount), bool_and(request_id = incoming_payment_id))::text
             from public.incoming_payment_allocations a
            where a.sales_invoice_id = '07310000-0000-0000-0000-0000000000e4' and a.reversed_at is null),
  row(1::bigint, 100.00::numeric(14,2), 100.00::numeric(14,2), true)::text,
  'AC-NPA-007 …which writes one allocation for the whole amount, keyed on the receipt''s own id');                                         -- 33
select is((select status from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e4'), 'Paid', 'AC-NPA-007 …and invoice 4 is Paid'); -- 34
select lives_ok($$ select public.cancel_native_receipt((select id from public.incoming_payments
    where sales_invoice_id = '07310000-0000-0000-0000-0000000000e4' and cancelled_at is null)) $$, 'AC-NPA-007 cancelling it works');       -- 35
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e4'),
  row('Unpaid', 100.00::numeric(14,2))::text, 'AC-NPA-007 …the allocation is reversed and invoice 4 owes 100 again');                       -- 36
reset role;

-- ── audit ──────────────────────────────────────────────────────────────────────────────────────────────────
select cmp_ok((select count(*)::int from public.audit_events where action = 'incoming_payment.unapply'
                  and actor_id = '07310000-0000-0000-0000-0000000000a1'), '>=', 2,
  'AC-NPA-007 every unapply is on the audit trail with its actor');                                                                       -- 37
select is((select (detail->>'allocations_reversed')::int from public.audit_events
            where action = 'incoming_payment.cancel' and entity_id = '07310000-0000-0000-0000-0000000000f1'),
  2, 'AC-NPA-007 the cancel audit says how many live allocations it reversed (invoice 2''s 40 and invoice 1''s 20)');                                                           -- 38
select is((select count(*)::int from public.audit_events where action = 'incoming_payment.apply'
            and entity_id = '07310000-0000-0000-0000-0000000000f1'), 2, 'AC-NPA-002 the two applies of receipt 1 were audited');            -- 39
select is((select count(*)::int from public.incoming_payment_allocations where org_id = '07310000-0000-0000-0000-000000000001'
              and reversed_at is not null and reversed_by is null), 0,
  'AC-NPA-007 every reversal made through an RPC names its actor');                                                                       -- 40

select * from finish();
rollback;
