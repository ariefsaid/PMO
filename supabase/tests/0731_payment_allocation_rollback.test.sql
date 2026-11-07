-- 0731_payment_allocation_rollback.test.sql — #1415: the rollback refuses while the old model cannot represent a receipt (on account,
-- partly applied, split across invoices), runs once only 1:1 receipts remain, and then leaves every invoice's balance exactly as it
-- was and the old writers/readers back in place. The runner (0731_payment_allocation_down_runner.sql) embeds the rollback file.
begin;
create extension if not exists pgtap;
select plan(18);

create function pg_temp.act_as(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;

insert into organizations (id, name, default_currency) values ('07310000-0000-0000-0000-000000000001', 'NPA Org', 'IDR');
insert into auth.users (id, email) values ('07310000-0000-0000-0000-0000000000a1', 'npa-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07310000-0000-0000-0000-0000000000a1', '07310000-0000-0000-0000-000000000001', 'NPA Fin', 'npa-fin@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('07310000-0000-0000-0000-0000000000c9', '07310000-0000-0000-0000-000000000001', 'NPA Client', 'Client');
insert into public.sales_invoices (id, org_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency,
                                   status, pmo_native, native_lines, erp_outstanding_amount, overpaid_amount) values
  ('07310000-0000-0000-0000-0000000000e1', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"d":"I1"}]'::jsonb, 100, 0),
  ('07310000-0000-0000-0000-0000000000e2', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 100, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"d":"I2"}]'::jsonb, 100, 0);

-- Receipts recorded the old way (1:1) through the real writer, so the allocations are exactly what 0731 writes.
set local role authenticated;
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.record_native_receipt('07310000-0000-0000-0000-0000000000e1', 30, 30, 0, null, '2026-07-05') $$, 'setup: a 1:1 receipt of 30 on invoice 1');   -- 1
select lives_ok($$ select public.record_native_receipt('07310000-0000-0000-0000-0000000000e2', 100, 100, 0, null, '2026-07-05') $$, 'setup: a 1:1 receipt of 100 on invoice 2'); -- 2
reset role;
create temp table before_fig as
select si.id, public.native_invoice_settled(si.org_id, si.id) as settled, si.erp_outstanding_amount, si.overpaid_amount, si.status
  from public.sales_invoices si where si.pmo_native;

\set pa_embedded 1
\ir 0731_payment_allocation_down_runner.sql

-- 1. on account: refuses
insert into public.incoming_payments (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount, withheld_amount, currency, status, pmo_native)
  values ('07310000-0000-0000-0000-0000000000f9', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', null, '2026-07-05', 50, 50, 0, 'IDR', 'Paid', true);
select throws_ok('select pg_temp.run_pa_down()', 'P0001', 'on-account PMO receipts exist (no invoice); rollback refused - cancel them first (cancel_native_receipt)',
  'rollback refuses while a PMO receipt is on account');                                                                                    -- 3
select has_table('public', 'incoming_payment_allocations', 'a refused rollback leaves the allocation table in place');                      -- 4
delete from public.incoming_payments where id = '07310000-0000-0000-0000-0000000000f9';

-- 2. split across two invoices: refuses
insert into public.incoming_payment_allocations (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id)
  select org_id, id, '07310000-0000-0000-0000-0000000000e2', 0.01, 0.01, 0, 'IDR', gen_random_uuid()
    from public.incoming_payments where sales_invoice_id = '07310000-0000-0000-0000-0000000000e1' and pmo_native;
select throws_ok('select pg_temp.run_pa_down()', 'P0001', 'a live PMO receipt is partly applied, split or applied elsewhere; rollback refused - unapply or cancel it first',
  'rollback refuses while a receipt is split across two invoices');                                                                         -- 5
delete from public.incoming_payment_allocations where amount = 0.01;

-- 3. partly applied (unapplied in part): refuses
update public.incoming_payment_allocations set reversed_at = now() where sales_invoice_id = '07310000-0000-0000-0000-0000000000e1';
select throws_ok('select pg_temp.run_pa_down()', 'P0001', 'a live PMO receipt is partly applied, split or applied elsewhere; rollback refused - unapply or cancel it first',
  'rollback refuses while a receipt has been taken off its invoice');                                                                       -- 6
update public.incoming_payment_allocations set reversed_at = null, reversed_by = null where sales_invoice_id = '07310000-0000-0000-0000-0000000000e1';

-- 4. only 1:1 receipts remain: runs
select lives_ok('select pg_temp.run_pa_down()', 'rollback runs once only 1:1 receipts remain');                                             -- 7
select hasnt_table('public', 'incoming_payment_allocations', 'rollback drops the allocation table');                                        -- 8
select ok(to_regprocedure('public.apply_native_receipt(uuid,jsonb,uuid)') is null
          and to_regprocedure('public.unapply_native_allocation(uuid)') is null
          and to_regprocedure('public.record_native_on_account_receipt(uuid,numeric,numeric,numeric,text,date,uuid)') is null
          and to_regprocedure('public.native_receipt_allocations_backfill()') is null
          and to_regprocedure('public.ipa_consistency()') is null
          and to_regprocedure('public.incoming_payments_amount_covers_allocations()') is null,
  'rollback drops the three RPCs and the guard functions');                                                                                 -- 9
select ok(position('incoming_payment_allocations' in pg_get_functiondef('public.native_invoice_settled(uuid,uuid)'::regprocedure)) = 0
          and position('incoming_payments' in pg_get_functiondef('public.native_invoice_settled(uuid,uuid)'::regprocedure)) > 0,
  'rollback settles an invoice from its receipts again');                                                                                   -- 10
select ok(position('incoming_payment_allocations' in pg_get_functiondef('public.record_native_receipt(uuid,numeric,numeric,numeric,text,date)'::regprocedure)) = 0
          and position('incoming_payment_allocations' in pg_get_functiondef('public.cancel_native_receipt(uuid)'::regprocedure)) = 0
          and position('incoming_payment_allocations' in pg_get_functiondef('public.get_project_finances(uuid)'::regprocedure)) = 0
          and position('incoming_payment_allocations' in pg_get_functiondef('public.invoice_pair_candidates(uuid,uuid,boolean)'::regprocedure)) = 0
          and position('incoming_payment_allocations' in pg_get_functiondef('public.list_unpaired_native_invoices()'::regprocedure)) = 0,
  'rollback puts the two writers and the three readers back to their pre-0731 text');                                                       -- 11
select is((select count(*)::int from before_fig f join public.sales_invoices si on si.id = f.id
            where public.native_invoice_settled(si.org_id, si.id) is distinct from f.settled
               or si.erp_outstanding_amount is distinct from f.erp_outstanding_amount
               or si.overpaid_amount is distinct from f.overpaid_amount or si.status is distinct from f.status), 0,
  'rollback leaves every invoice''s settled figure, balance, overpaid and status exactly as they were');                                    -- 12
select throws_ok($$ insert into public.incoming_payments (org_id, customer_id, sales_invoice_id, date, amount, currency, status, pmo_native)
  values ('07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', null, '2026-07-05', 5, 'IDR', 'Paid', true) $$,
  '23514', null, 'rollback restores the old shape: a PMO receipt names its invoice again');                                                 -- 13

-- the old cancel works again and restates the invoice from the receipts
set local role authenticated;
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.cancel_native_receipt((select id from public.incoming_payments where sales_invoice_id = '07310000-0000-0000-0000-0000000000e2' and pmo_native)) $$,
  'the restored cancel_native_receipt cancels a 1:1 receipt');                                                                              -- 14
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e2'),
  row('Unpaid', 100.00::numeric(14,2))::text, 'rollback: …and the invoice owes its whole gross again');                                    -- 15
select lives_ok($$ select public.record_native_receipt('07310000-0000-0000-0000-0000000000e2', 100, 100, 0, null, '2026-07-06') $$,
  'the restored record_native_receipt records a receipt again');                                                                            -- 16
select is((select status from public.sales_invoices where id = '07310000-0000-0000-0000-0000000000e2'), 'Paid', 'rollback: …and the invoice is Paid'); -- 17
select ok(has_function_privilege('anon', 'public.record_native_receipt(uuid,numeric,numeric,numeric,text,date)', 'EXECUTE') = false,
  'the restored writers keep anon out');                                                                                                    -- 18

select * from finish();
rollback;
