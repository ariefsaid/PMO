-- 0731_payment_allocation_readers.test.sql — #1415 AC-NPA-008: the readers that used to treat a native receipt's invoice link as
-- THE link now read allocations. Project cash received (get_project_finances) gives each project exactly its allocations'
-- cash (a native receipt split over two projects' invoices, the remainder rule on the last), on-account cash belongs to no
-- project, an unapplied allocation leaves the project; invoice pairing (invoice_pair_candidates,
-- list_unpaired_native_invoices) refuses an invoice with a live allocation and offers it again once it is unapplied.
-- A direct invoice-first receipt reads exactly as it did before 0731.
-- Migration under test: 0731_payment_allocation.sql §6.
begin;
create extension if not exists pgtap;
select plan(25);

create function pg_temp.act_as(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;

insert into organizations (id, name, default_currency) values ('07310000-0000-0000-0000-000000000001', 'NPA Org', 'IDR');
insert into auth.users (id, email) values ('07310000-0000-0000-0000-0000000000a1', 'npa-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07310000-0000-0000-0000-0000000000a1', '07310000-0000-0000-0000-000000000001', 'NPA Fin', 'npa-fin@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('07310000-0000-0000-0000-0000000000c9', '07310000-0000-0000-0000-000000000001', 'NPA Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id) values
  ('07310000-0000-0000-0000-0000000000d1', '07310000-0000-0000-0000-000000000001', 'NPA Project P', 'Ongoing Project', 'IDR', 100000, 'inclusive', 0, 0, 1, 1, false, '07310000-0000-0000-0000-0000000000c9'),
  ('07310000-0000-0000-0000-0000000000d2', '07310000-0000-0000-0000-000000000001', 'NPA Project Q', 'Ongoing Project', 'IDR', 100000, 'inclusive', 0, 0, 1, 1, false, '07310000-0000-0000-0000-0000000000c9');
-- eP (project P, 60), eQ (project Q, 40), eD (project P, 30: for the direct receipt), nA / nB (pairing, no project).
insert into public.sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency,
                                   status, pmo_native, native_lines, erp_outstanding_amount, reference_number, pmo_number) values
  ('07310000-0000-0000-0000-0000000000e1', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000d1', '07310000-0000-0000-0000-0000000000c9', '2026-07-01',  60, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"d":"eP"}]'::jsonb,  60, null, 'INV-P'),
  ('07310000-0000-0000-0000-0000000000e2', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000d2', '07310000-0000-0000-0000-0000000000c9', '2026-07-01',  40, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"d":"eQ"}]'::jsonb,  40, null, 'INV-Q'),
  ('07310000-0000-0000-0000-0000000000e3', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000d1', '07310000-0000-0000-0000-0000000000c9', '2026-07-01',  30, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"d":"eD"}]'::jsonb,  30, null, 'INV-D'),
  ('07310000-0000-0000-0000-0000000000e4', '07310000-0000-0000-0000-000000000001', null, '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 500, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"d":"nA"}]'::jsonb, 500, 'REF-A', 'INV-NA'),
  ('07310000-0000-0000-0000-0000000000e5', '07310000-0000-0000-0000-000000000001', null, '07310000-0000-0000-0000-0000000000c9', '2026-07-01', 500, 'inclusive', 0, 'IDR', 'Unpaid', true, '[{"d":"nB"}]'::jsonb, 500, 'REF-B', 'INV-NB');
-- the ERP twins of nA / nB (same reference, total, tax, month, customer)
insert into public.sales_invoices (id, org_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency,
                                   status, pmo_native, erp_docstatus, si_number, erp_outstanding_amount, reference_number) values
  ('07310000-0000-0000-0000-0000000000e6', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-02', 500, 'inclusive', 0, 'IDR', 'Unpaid', false, 1, 'SI-ERP-A', 500, 'REF-A'),
  ('07310000-0000-0000-0000-0000000000e7', '07310000-0000-0000-0000-000000000001', '07310000-0000-0000-0000-0000000000c9', '2026-07-02', 500, 'inclusive', 0, 'IDR', 'Unpaid', false, 1, 'SI-ERP-B', 500, 'REF-B');

set local role authenticated;
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a1');

-- a native receipt of 100 (cash 90 + withheld 10), split 60 on project P's invoice and 40 on project Q's
select lives_ok($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 100, 90, 10, 'BP-NPA-9', '2026-07-05',
                                                                 '07310000-0000-0000-0000-0000000000f1') $$, 'setup: an on-account receipt 100 = 90 cash + 10 withheld'); -- 1
select lives_ok($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 50, null, null, null, '2026-07-05',
                                                                 '07310000-0000-0000-0000-0000000000f2') $$, 'setup: an on-account receipt of 50 that is never applied'); -- 2
select lives_ok($$ select public.record_native_receipt('07310000-0000-0000-0000-0000000000e3', 30, 30, 0, null, '2026-07-05') $$,
  'setup: a direct invoice-first receipt of 30 on project P''s other invoice');                                                              -- 3

-- before applying: nothing but the direct receipt reaches project P, nothing reaches Q
select is((public.get_project_finances('07310000-0000-0000-0000-0000000000d1') -> 'cash_received' -> 'buckets' -> 0 ->> 'amount'), '30.00',
  'AC-NPA-008 project P''s cash is the direct receipt only (an on-account receipt belongs to no project)');                                 -- 4
select is((public.get_project_finances('07310000-0000-0000-0000-0000000000d2') -> 'cash_received' ->> 'receipt_count')::int, 0,
  'AC-NPA-008 project Q has no receipt at all');                                                                                            -- 5

select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e1","amount":60},{"invoice_id":"07310000-0000-0000-0000-0000000000e2","amount":40}]'::jsonb,
    gen_random_uuid()) $$, 'setup: the 100 receipt is applied 60 to P''s invoice and 40 to Q''s');                                          -- 6
select is((public.get_project_finances('07310000-0000-0000-0000-0000000000d1') -> 'cash_received' -> 'buckets' -> 0 ->> 'amount'), '84.00',
  'AC-NPA-008 project P gets exactly its allocation''s cash: 54.00 of the 90 cash, plus the direct 30');                                     -- 7
select is((public.get_project_finances('07310000-0000-0000-0000-0000000000d2') -> 'cash_received' -> 'buckets' -> 0 ->> 'amount'), '36.00',
  'AC-NPA-008 project Q gets the remaining 36.00 of the cash (remainder rule on the last allocation)');                                       -- 8
select is((public.get_project_finances('07310000-0000-0000-0000-0000000000d1') -> 'cash_received' ->> 'state'), 'known',
  'AC-NPA-008 …and the figure is known, not incomplete');                                                                                    -- 9
select is((public.get_project_finances('07310000-0000-0000-0000-0000000000d1') -> 'cash_received' ->> 'receipt_count')::int, 2,
  'AC-NPA-008 project P reads two receipts: the split one and the direct one');                                                              -- 10
select lives_ok($$ select public.unapply_native_allocation((select id from public.incoming_payment_allocations
    where sales_invoice_id = '07310000-0000-0000-0000-0000000000e2' and reversed_at is null)) $$, 'setup: unapply Q''s 40');                  -- 11
select is((public.get_project_finances('07310000-0000-0000-0000-0000000000d2') -> 'cash_received' ->> 'receipt_count')::int, 0,
  'AC-NPA-008 unapplied, the cash leaves project Q');                                                                                        -- 12
select is((public.get_project_finances('07310000-0000-0000-0000-0000000000d1') -> 'cash_received' -> 'buckets' -> 0 ->> 'amount'), '84.00',
  'AC-NPA-008 …and project P is unchanged');                                                                                                  -- 12b
select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f1',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e2","amount":40}]'::jsonb, gen_random_uuid()) $$, 'setup: re-apply the 40 to Q');      -- 13
select is((public.get_project_finances('07310000-0000-0000-0000-0000000000d2') -> 'cash_received' -> 'buckets' -> 0 ->> 'amount'), '36.00',
  'AC-NPA-008 re-applied, Q reads 36.00 again');                                                                                             -- 14

-- ── invoice pairing: an invoice with a live allocation is not offered ──────────────────────────────────────
select lives_ok($$ select public.record_native_on_account_receipt('07310000-0000-0000-0000-0000000000c9', 200, null, null, null, '2026-07-05',
                                                                 '07310000-0000-0000-0000-0000000000f3') $$, 'setup: an on-account receipt of 200');     -- 15
select is((select count(*)::int from public.invoice_pair_candidates('07310000-0000-0000-0000-0000000000e4', null)), 1,
  'AC-NPA-008 CONTROL invoice A with nothing applied has its ERP twin as a candidate');                                                      -- 16
select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f3',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e4","amount":200}]'::jsonb, gen_random_uuid()) $$, 'setup: 200 applied to invoice A');   -- 17
select is((select count(*)::int from public.invoice_pair_candidates('07310000-0000-0000-0000-0000000000e4', null)), 0,
  'AC-NPA-008 invoice A with a live allocation is no longer offered for pairing');                                                           -- 18
select is((select count(*)::int from public.invoice_pair_candidates('07310000-0000-0000-0000-0000000000e5', null)), 1,
  'AC-NPA-008 …while invoice B, with nothing applied, still is');                                                                            -- 19
select lives_ok($$ select public.unapply_native_allocation((select id from public.incoming_payment_allocations
    where sales_invoice_id = '07310000-0000-0000-0000-0000000000e4' and reversed_at is null)) $$, 'setup: unapply invoice A');                -- 20
select is((select count(*)::int from public.invoice_pair_candidates('07310000-0000-0000-0000-0000000000e4', null)), 1,
  'AC-NPA-008 unapplied, invoice A is offered again');                                                                                       -- 21
select lives_ok($$ select public.apply_native_receipt('07310000-0000-0000-0000-0000000000f3',
    '[{"invoice_id":"07310000-0000-0000-0000-0000000000e4","amount":150}]'::jsonb, gen_random_uuid()) $$, 'setup: 150 applied to invoice A again'); -- 22
reset role;
insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('07310000-0000-0000-0000-000000000001', 'erpnext', 'revenue');
set local role authenticated;
select pg_temp.act_as('07310000-0000-0000-0000-0000000000a1');
select is((select reason from public.list_unpaired_native_invoices() where invoice_id = '07310000-0000-0000-0000-0000000000e4'), 'has-receipt',
  'AC-NPA-008 once an ERP owns revenue, the unpaired list says invoice A has a receipt applied');                                           -- 23
select is((select count(*)::int from public.list_unpaired_native_invoices() where invoice_id = '07310000-0000-0000-0000-0000000000e5'), 0,
  'AC-NPA-008 …and invoice B, which has an ERP twin and nothing applied, is not in the unpaired list');                                      -- 24

select * from finish();
rollback;
