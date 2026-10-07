-- 0270_native_revenue_approve.test.sql — #784 AC-NAR-002 (a second person approves; the author never can) and
-- AC-NAR-005 (a Draft, or an Unpaid invoice with no receipt, can be cancelled). Migration under test: 0270 §3–§4.
begin;
create extension if not exists pgtap;
select plan(19);

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
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Approve me","qty":2,"rate":500000}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Null target","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Demotion","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Cancel draft","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Cancel unpaid","qty":1,"rate":100}]'::jsonb);
end $$;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
do $$ begin
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Admin own","qty":1,"rate":100}]'::jsonb);
end $$;

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]'), 'Unpaid') $$,
  '42501', 'approver must differ from author (SoD)', 'AC-NAR-002 the author cannot approve their own invoice');         -- 1
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Admin own"}]'), 'Unpaid') $$,
  '42501', 'approver must differ from author (SoD)', 'AC-NAR-002 an Admin cannot approve an invoice they raised either'); -- 2
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]'), 'Unpaid') $$,
  '42501', 'only Finance or an Admin can approve or cancel a customer invoice', 'AC-NAR-002 a Project Manager cannot approve'); -- 3
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice('02700000-0000-0000-0000-000000000000'::uuid, 'Unpaid') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-NAR-002 an offboarded Finance member cannot approve');                                                         -- 4
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select si.id from public.sales_invoices si where si.org_id = '02700000-0000-0000-0000-000000000001' limit 1), 'Unpaid') $$,
  'P0002', 'sales invoice not found', 'AC-NAR-002 another org''s member cannot reach the invoice (it is invisible, so the id resolves to nothing)'); -- 5
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]'), 'Unpaid') $$,
  'AC-NAR-002 a different Finance user approves it');                                                               -- 6
select is(
  (select row(status, pmo_number ~ '^INV-[0-9]{10}$', invoice_date is not null, approved_by_id, erp_outstanding_amount)::text
     from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]'),
  row('Unpaid', true, true, '02700000-0000-0000-0000-0000000000a2'::uuid, 1110000.00::numeric(14,2))::text,
  'AC-NAR-002 approved, it is Unpaid, numbered, dated, approved by the second person, and owes its gross');           -- 7
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]'), 'Unpaid') $$,
  'P0001', 'illegal transition Unpaid -> Unpaid', 'AC-NAR-002 an approved invoice is not approved twice');          -- 8
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Null target"}]'), null) $$,
  'P0001', 'illegal transition Draft -> <NULL>', 'AC-NAR-002 a NULL target is refused, never a fall-through');       -- 9

reset role;
set local request.jwt.claims = '{}';
update public.profiles set role = 'Project Manager' where id = '02700000-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Demotion"}]'), 'Unpaid') $$,
  '42501', 'only Finance or an Admin can approve or cancel a customer invoice',
  'AC-NAR-002 an approver demoted since is refused — the role is read at approval time, not trusted from before'); -- 10
reset role;
set local request.jwt.claims = '{}';
update public.profiles set role = 'Finance' where id = '02700000-0000-0000-0000-0000000000a2';
insert into public.sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status, pmo_native, native_lines)
  values ('02700000-0000-0000-0000-0000000000f1', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1',
          '02700000-0000-0000-0000-0000000000c1', 100, 'exclusive', 0, 'IDR', 'Draft', true,
          '[{"item_code":"SVC","description":null,"qty":1,"rate":100,"amount":100.00}]');
insert into public.sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status)
  values ('02700000-0000-0000-0000-0000000000f2', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1',
          '02700000-0000-0000-0000-0000000000c1', 100, 'exclusive', 0, 'IDR', 'Draft');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice('02700000-0000-0000-0000-0000000000f1', 'Unpaid') $$,
  '42501', 'sales invoice has no recorded author — SoD cannot be verified',
  'AC-NAR-002 a PMO invoice with no recorded author is never approvable (fail closed)');                            -- 11
select throws_ok($$ select public.transition_native_sales_invoice('02700000-0000-0000-0000-0000000000f2', 'Unpaid') $$,
  'P0001', 'this invoice belongs to the ERP: approve or cancel it there',
  'AC-NAR-002 an invoice that is not a PMO invoice is never approved by the PMO path');                             -- 12
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Cancel draft"}]'), 'Cancelled') $$,
  'AC-NAR-005 Finance cancels a PMO draft');                                                                         -- 13
select is((select status from public.sales_invoices where native_lines @> '[{"description":"Cancel draft"}]'), 'Cancelled',
  'AC-NAR-005 the cancelled draft reads Cancelled (and so stops counting against a work order, 0262)');             -- 14
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Cancel unpaid"}]'), 'Unpaid') $$,
  'AC-NAR-005 setup: a second invoice is approved');                                                                 -- 15
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Cancel unpaid"}]'), 'Cancelled') $$,
  'AC-NAR-005 an approved invoice with no receipt can be cancelled');                                               -- 16
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where native_lines @> '[{"description":"Cancel unpaid"}]'),
  row('Cancelled', 0.00::numeric(14,2))::text, 'AC-NAR-005 a cancelled invoice owes nothing');                       -- 17
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Cancel unpaid"}]'), 'Cancelled') $$,
  'P0001', 'illegal transition Cancelled -> Cancelled', 'AC-NAR-005 a cancelled invoice stays cancelled');          -- 18
reset role;
select is((select count(*)::int from public.audit_events
            where action = 'sales_invoice.transition' and actor_id = '02700000-0000-0000-0000-0000000000a2'
              and entity_id = (select id from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]')),
  1, 'AC-NAR-002 the approval is on the audit trail with its approver');                                            -- 19

select * from finish();
rollback;
