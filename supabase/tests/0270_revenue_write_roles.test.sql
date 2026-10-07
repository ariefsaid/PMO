-- 0270_revenue_write_roles.test.sql — #784 AC-NAR-007 (owner ruling, DD-NAR-15): writes to sales_invoices and
-- incoming_payments are Admin and Finance only, by every path a member has — direct insert, update and delete (the
-- table policies), and the PMO revenue RPCs. The service-role ERP mirror writer is unaffected.
-- Update and delete are proven through the POLICY layer: the test grants the column/table privilege inside its own
-- transaction (rolled back), then shows which roles the policy admits.
begin;
create extension if not exists pgtap;
select plan(25);

insert into organizations (id, name) values ('02700000-0000-0000-0000-000000000001', 'NAR Org');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02700000-0000-0000-0000-0000000000a3', 'nar-admin@example.com'),
  ('02700000-0000-0000-0000-0000000000a4', 'nar-pm@example.com'),
  ('02700000-0000-0000-0000-0000000000a6', 'nar-exec@example.com'),
  ('02700000-0000-0000-0000-0000000000a7', 'nar-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a3', '02700000-0000-0000-0000-000000000001', 'NAR Admin', 'nar-admin@example.com', 'Admin', 'active'),
  ('02700000-0000-0000-0000-0000000000a4', '02700000-0000-0000-0000-000000000001', 'NAR PM', 'nar-pm@example.com', 'Project Manager', 'active'),
  ('02700000-0000-0000-0000-0000000000a6', '02700000-0000-0000-0000-000000000001', 'NAR Exec', 'nar-exec@example.com', 'Executive', 'active'),
  ('02700000-0000-0000-0000-0000000000a7', '02700000-0000-0000-0000-000000000001', 'NAR Eng', 'nar-eng@example.com', 'Engineer', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1');
insert into public.sales_invoices (id, org_id, project_id, customer_id, reference_number, amount, tax_treatment, tax_amount, currency, status) values
  ('02700000-0000-0000-0000-0000000000f5', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 'SEED', 100, 'exclusive', 0, 'IDR', 'Draft'),
  ('02700000-0000-0000-0000-0000000000f7', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 'DELETE-ME', 100, 'exclusive', 0, 'IDR', 'Draft');
insert into public.incoming_payments (id, org_id, customer_id, reference_number, date, amount) values
  ('02700000-0000-0000-0000-0000000000f6', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', 'SEED', '2026-10-07', 10);

-- ── INSERT (the narrow column-limited body) ────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ insert into public.sales_invoices (org_id, project_id, customer_id, amount, tax_treatment, tax_amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 10, 'exclusive', 0) $$,
  'AC-NAR-007 an Admin may insert a sales invoice');                                                                 -- 1
select lives_ok($$ insert into public.incoming_payments (org_id, customer_id, date, amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', '2026-10-07', 10) $$,
  'AC-NAR-007 an Admin may insert a customer receipt');                                                              -- 2
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ insert into public.sales_invoices (org_id, project_id, customer_id, amount, tax_treatment, tax_amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 10, 'exclusive', 0) $$,
  'AC-NAR-007 a Finance member may insert a sales invoice');                                                         -- 3
select lives_ok($$ insert into public.incoming_payments (org_id, customer_id, date, amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', '2026-10-07', 10) $$,
  'AC-NAR-007 a Finance member may insert a customer receipt');                                                      -- 4
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ insert into public.sales_invoices (org_id, project_id, customer_id, amount, tax_treatment, tax_amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 10, 'exclusive', 0) $$,
  '42501', 'new row violates row-level security policy for table "sales_invoices"', 'AC-NAR-007 an Executive cannot insert a sales invoice'); -- 5
select throws_ok($$ insert into public.incoming_payments (org_id, customer_id, date, amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', '2026-10-07', 10) $$,
  '42501', 'new row violates row-level security policy for table "incoming_payments"', 'AC-NAR-007 an Executive cannot insert a customer receipt'); -- 6
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ insert into public.sales_invoices (org_id, project_id, customer_id, amount, tax_treatment, tax_amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 10, 'exclusive', 0) $$,
  '42501', 'new row violates row-level security policy for table "sales_invoices"', 'AC-NAR-007 a Project Manager cannot insert a sales invoice'); -- 7
select throws_ok($$ insert into public.incoming_payments (org_id, customer_id, date, amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', '2026-10-07', 10) $$,
  '42501', 'new row violates row-level security policy for table "incoming_payments"', 'AC-NAR-007 a Project Manager cannot insert a customer receipt'); -- 8
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($$ insert into public.sales_invoices (org_id, project_id, customer_id, amount, tax_treatment, tax_amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 10, 'exclusive', 0) $$,
  '42501', 'new row violates row-level security policy for table "sales_invoices"', 'AC-NAR-007 an Engineer cannot insert a sales invoice'); -- 9
select throws_ok($$ insert into public.incoming_payments (org_id, customer_id, date, amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', '2026-10-07', 10) $$,
  '42501', 'new row violates row-level security policy for table "incoming_payments"', 'AC-NAR-007 an Engineer cannot insert a customer receipt'); -- 10

-- ── UPDATE (policy layer, privilege granted inside this transaction only) ─────────────────────────
reset role;
grant update (reference_number) on public.sales_invoices to authenticated;
grant update (reference_number) on public.incoming_payments to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
update public.sales_invoices set reference_number = 'BY-EXEC' where id = '02700000-0000-0000-0000-0000000000f5';
update public.incoming_payments set reference_number = 'BY-EXEC' where id = '02700000-0000-0000-0000-0000000000f6';
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
update public.sales_invoices set reference_number = 'BY-PM' where id = '02700000-0000-0000-0000-0000000000f5';
update public.incoming_payments set reference_number = 'BY-PM' where id = '02700000-0000-0000-0000-0000000000f6';
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a7","role":"authenticated"}';
update public.sales_invoices set reference_number = 'BY-ENG' where id = '02700000-0000-0000-0000-0000000000f5';
update public.incoming_payments set reference_number = 'BY-ENG' where id = '02700000-0000-0000-0000-0000000000f6';
reset role;
select is((select reference_number from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f5'), 'SEED',
  'AC-NAR-007 Executive, Project Manager and Engineer updates leave a sales invoice untouched');                    -- 11
select is((select reference_number from public.incoming_payments where id = '02700000-0000-0000-0000-0000000000f6'), 'SEED',
  'AC-NAR-007 Executive, Project Manager and Engineer updates leave a customer receipt untouched');                 -- 12
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update public.sales_invoices set reference_number = 'BY-FIN' where id = '02700000-0000-0000-0000-0000000000f5';
update public.incoming_payments set reference_number = 'BY-FIN' where id = '02700000-0000-0000-0000-0000000000f6';
reset role;
select is((select reference_number from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f5'), 'BY-FIN',
  'AC-NAR-007 a Finance member''s update of a sales invoice is admitted by the policy');                           -- 13
select is((select reference_number from public.incoming_payments where id = '02700000-0000-0000-0000-0000000000f6'), 'BY-FIN',
  'AC-NAR-007 a Finance member''s update of a customer receipt is admitted by the policy');                        -- 14
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
update public.sales_invoices set reference_number = 'BY-ADMIN' where id = '02700000-0000-0000-0000-0000000000f5';
update public.incoming_payments set reference_number = 'BY-ADMIN' where id = '02700000-0000-0000-0000-0000000000f6';
reset role;
select is((select reference_number from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f5'), 'BY-ADMIN',
  'AC-NAR-007 an Admin''s update of a sales invoice is admitted by the policy');                                   -- 15
select is((select reference_number from public.incoming_payments where id = '02700000-0000-0000-0000-0000000000f6'), 'BY-ADMIN',
  'AC-NAR-007 an Admin''s update of a customer receipt is admitted by the policy');                                -- 16
revoke update (reference_number) on public.sales_invoices from authenticated;
revoke update (reference_number) on public.incoming_payments from authenticated;

-- ── DELETE (policy layer, privilege granted inside this transaction only) ─────────────────────────
grant delete on public.sales_invoices to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
delete from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7';
reset role;
select is((select count(*)::int from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7'), 1,
  'AC-NAR-007 a Project Manager''s delete of a sales invoice removes nothing');                                    -- 17
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
delete from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7';
reset role;
select is((select count(*)::int from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7'), 1,
  'AC-NAR-007 an Executive''s delete of a sales invoice removes nothing');                                         -- 18
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
delete from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7';
reset role;
select is((select count(*)::int from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7'), 0,
  'AC-NAR-007 a Finance member''s delete is admitted by the policy');                                              -- 19
revoke delete on public.sales_invoices from authenticated;

-- ── the PMO revenue RPCs carry the same rule in their bodies ──────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-NAR-007 an Executive cannot raise a PMO invoice'); -- 20
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-NAR-007 an Engineer cannot raise a PMO invoice'); -- 21
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Role check","qty":1,"rate":100}]'::jsonb) $$,
  'AC-NAR-007 a Finance member raises a PMO invoice');                                                               -- 22
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Role check"}]'), 'Cancelled') $$,
  '42501', 'only Finance or an Admin can approve or cancel a customer invoice', 'AC-NAR-007 an Executive cannot cancel a PMO invoice'); -- 23
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Role check"}]'), 'Cancelled') $$,
  'AC-NAR-007 an Admin cancels a PMO invoice');                                                                      -- 24

-- ── the service-role ERP mirror writer is unaffected ─────────────────────────────────────────────
reset role;
set local role service_role;
select lives_ok($$ insert into public.sales_invoices (org_id, customer_id, si_number, invoice_date, amount, erp_outstanding_amount, status, erp_docstatus, tax_treatment, tax_amount)
  values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', 'SI-MIRROR-NAR', '2026-10-07', 250, 250, 'Unpaid', 1, 'inclusive', 0) $$,
  'AC-NAR-007 CONTROL the service-role ERP mirror writer still lands a full mirror row');                           -- 25

select * from finish();
rollback;
