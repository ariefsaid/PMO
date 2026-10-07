-- 0275_native_revenue_approve.test.sql — #784 AC-NAR-002 (a second person approves; the author never can) and
-- AC-NAR-005 (a Draft, or an Unpaid invoice with no receipt, can be cancelled; a cancelled draft stops counting against
-- its work order). Also: another org's Finance or Admin cannot approve or cancel by a literal id; while no ERP owns
-- revenue a Draft that never reached an ERP (DD-NAR-13's direct insert) can be cancelled, never approved.
-- Migration under test: 0275 §3–§4.
begin;
create extension if not exists pgtap;
select plan(33);

insert into organizations (id, name) values
  ('02700000-0000-0000-0000-000000000001', 'NAR Org'),
  ('02700000-0000-0000-0000-000000000002', 'NAR Other Org');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02700000-0000-0000-0000-0000000000a2', 'nar-fin2@example.com'),
  ('02700000-0000-0000-0000-0000000000a3', 'nar-admin@example.com'),
  ('02700000-0000-0000-0000-0000000000a4', 'nar-pm@example.com'),
  ('02700000-0000-0000-0000-0000000000a5', 'nar-off@example.com'),
  ('02700000-0000-0000-0000-0000000000b1', 'nar-xorg@example.com'),
  ('02700000-0000-0000-0000-0000000000b2', 'nar-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-000000000001', 'NAR Fin Two', 'nar-fin2@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a3', '02700000-0000-0000-0000-000000000001', 'NAR Admin', 'nar-admin@example.com', 'Admin', 'active'),
  ('02700000-0000-0000-0000-0000000000a4', '02700000-0000-0000-0000-000000000001', 'NAR PM', 'nar-pm@example.com', 'Project Manager', 'active'),
  ('02700000-0000-0000-0000-0000000000a5', '02700000-0000-0000-0000-000000000001', 'NAR Off', 'nar-off@example.com', 'Finance', 'disabled'),
  ('02700000-0000-0000-0000-0000000000b1', '02700000-0000-0000-0000-000000000002', 'NAR XOrg', 'nar-xorg@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000b2', '02700000-0000-0000-0000-000000000002', 'NAR XAdmin', 'nar-xadmin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client'),
  ('02700000-0000-0000-0000-0000000000c9', '02700000-0000-0000-0000-000000000002', 'NAR X Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1'),
  ('02700000-0000-0000-0000-0000000000d9', '02700000-0000-0000-0000-000000000002', 'NAR X project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, null, 1, 1, false, null, '02700000-0000-0000-0000-0000000000c9');
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, currency, client_po_number) values
  ('02700000-0000-0000-0000-0000000000e1', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', 'NAR WO', 'Issued', 'WO-NAR-1', 2000000, 'exclusive', 0, 'IDR', 'PO-NAR-777');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Approve me","qty":2,"rate":500000}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Null target","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Demotion","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Cancel draft","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Cancel unpaid","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Cross approve","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Cross cancel","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"WO draft","qty":1,"rate":300000}]'::jsonb, '02700000-0000-0000-0000-0000000000e1');
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

-- ── another org's Finance or Admin, holding a LITERAL id (read here as the owner), is refused ─────────────────
create temp table nar_ids on commit drop as
  select native_lines -> 0 ->> 'description' as d, id from public.sales_invoices where pmo_native;
grant select on nar_ids to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(format('select public.transition_native_sales_invoice(%L, %L)', (select id from nar_ids where d = 'Cross approve'), 'Unpaid'),
  '42501', 'not authorized', 'AC-NAR-002 another org''s Finance member cannot approve by a literal invoice id');   -- 20
select throws_ok(format('select public.transition_native_sales_invoice(%L, %L)', (select id from nar_ids where d = 'Cross cancel'), 'Cancelled'),
  '42501', 'not authorized', 'AC-NAR-005 another org''s Finance member cannot cancel by a literal invoice id');    -- 21
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok(format('select public.transition_native_sales_invoice(%L, %L)', (select id from nar_ids where d = 'Cross approve'), 'Unpaid'),
  '42501', 'not authorized', 'AC-NAR-002 another org''s Admin cannot approve by a literal invoice id');            -- 22
select throws_ok(format('select public.transition_native_sales_invoice(%L, %L)', (select id from nar_ids where d = 'Cross cancel'), 'Cancelled'),
  '42501', 'not authorized', 'AC-NAR-005 another org''s Admin cannot cancel by a literal invoice id');             -- 23
reset role;
select is((select string_agg(status, ',' order by status) from public.sales_invoices
            where native_lines @> '[{"description":"Cross approve"}]' or native_lines @> '[{"description":"Cross cancel"}]'),
  'Draft,Draft', 'AC-NAR-002 …and both invoices are untouched');                                                  -- 24

-- ── AC-NAR-005: a cancelled draft stops counting against its work order (0262's billing view) ─────────────────
-- A Draft that never reached an ERP, inserted directly (DD-NAR-13's column-limited insert), on the same work order.
insert into public.sales_invoices (id, org_id, project_id, customer_id, work_order_id, amount, tax_treatment, tax_amount, currency, status)
  values ('02700000-0000-0000-0000-0000000000f4', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1',
          '02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-0000000000e1', 200000, 'exclusive', 0, 'IDR', 'Draft');
-- A Draft that DID reach an ERP (it carries an ERP number) — the ERP path's to cancel, never PMO's.
insert into public.sales_invoices (id, org_id, project_id, customer_id, si_number, amount, tax_treatment, tax_amount, currency, status, erp_docstatus)
  values ('02700000-0000-0000-0000-0000000000f3', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1',
          '02700000-0000-0000-0000-0000000000c1', 'SI-ERP-DRAFT', 100, 'exclusive', 0, 'IDR', 'Draft', 0);
select is((select pending from public.work_order_billing where work_order_id = '02700000-0000-0000-0000-0000000000e1'),
  500000.00::numeric, 'AC-NAR-005 setup: the PMO draft (300,000) and the direct-insert draft (200,000) both count as pending'); -- 25
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"WO draft"}]'), 'Cancelled') $$,
  'AC-NAR-005 Finance cancels the PMO draft on the work order');                                                  -- 26
select lives_ok($$ select public.transition_native_sales_invoice('02700000-0000-0000-0000-0000000000f4', 'Cancelled') $$,
  'AC-NAR-005 with no ERP owning revenue, Finance cancels a direct-insert draft that never reached an ERP (DD-NAR-13)'); -- 27
reset role;
select is((select pending from public.work_order_billing where work_order_id = '02700000-0000-0000-0000-0000000000e1'),
  0.00::numeric, 'AC-NAR-005 a cancelled draft stops counting against its work order');                          -- 28
select is((select (detail ->> 'pmo_native')::boolean from public.audit_events
            where action = 'sales_invoice.transition' and entity_id = '02700000-0000-0000-0000-0000000000f4'),
  false, 'NFR-NAR-003 the direct-insert draft''s cancellation is on the audit trail');                           -- 29
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice('02700000-0000-0000-0000-0000000000f3', 'Cancelled') $$,
  'P0001', 'this invoice belongs to the ERP: approve or cancel it there',
  'AC-NAR-005 a draft that reached an ERP is never cancelled by the PMO path');                                  -- 30
select lives_ok($$ select public.transition_native_sales_invoice('02700000-0000-0000-0000-0000000000f2', 'Cancelled') $$,
  'AC-NAR-005 …while the direct-insert draft refused approval at 12 can be cancelled');                          -- 31
reset role;
select is((select status from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f2'), 'Cancelled',
  'AC-NAR-005 …and reads Cancelled');                                                                             -- 32
-- In an org where an ERP owns revenue, the PMO path cancels no draft at all.
set local request.jwt.claims = '{}';
insert into public.sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status)
  values ('02700000-0000-0000-0000-0000000000f9', '02700000-0000-0000-0000-000000000002', '02700000-0000-0000-0000-0000000000d9',
          '02700000-0000-0000-0000-0000000000c9', 100, 'exclusive', 0, 'IDR', 'Draft');
insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('02700000-0000-0000-0000-000000000002', 'erpnext', 'revenue');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice('02700000-0000-0000-0000-0000000000f9', 'Cancelled') $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  'AC-NAR-005 while an ERP owns revenue, a direct-insert draft is cancelled in the ERP, not in PMO');            -- 33
reset role;

select * from finish();
rollback;
