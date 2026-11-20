-- #2584 S3/S4 (money path): approve -> bill through the shipped capture, the payable net of backcharges, refusal without half-writes,
-- the void hook, the work-order cost read and the acceptance bridge (AC-SPC-010, 011, 013, 014, 016; FR-SPC-010, 014..017).
-- Migrations under test: 1137 and 1138.
begin;
create extension if not exists pgtap;
select plan(39);

-- ── shared fixture (the hand-calculation month, spec "Definitions"): org A (multi-member), org B (another tenant). ──
-- PO quantity 100 and rate 12.00 on every item; vendor V1's crew works work order W1 in March 2026.
insert into organizations (id, name, default_currency) values
  ('25840000-0000-0000-0000-00000000000a', 'SPC Org',       'IDR'),
  ('25840000-0000-0000-0000-00000000000b', 'SPC Other Org', 'IDR');
insert into auth.users (id, email) values
  ('25840000-0000-0000-0000-0000000000a1', 'spc-admin@example.com'),
  ('25840000-0000-0000-0000-0000000000a2', 'spc-fin1@example.com'),
  ('25840000-0000-0000-0000-0000000000a3', 'spc-fin2@example.com'),
  ('25840000-0000-0000-0000-0000000000a4', 'spc-pm@example.com'),
  ('25840000-0000-0000-0000-0000000000a5', 'spc-eng@example.com'),
  ('25840000-0000-0000-0000-0000000000a6', 'spc-exec@example.com'),
  ('25840000-0000-0000-0000-0000000000a7', 'spc-pm2@example.com'),
  ('25840000-0000-0000-0000-0000000000b1', 'spc-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25840000-0000-0000-0000-0000000000a1', '25840000-0000-0000-0000-00000000000a', 'SPC Admin', 'spc-admin@example.com', 'Admin', 'active'),
  ('25840000-0000-0000-0000-0000000000a2', '25840000-0000-0000-0000-00000000000a', 'SPC Fin1',  'spc-fin1@example.com',  'Finance', 'active'),
  ('25840000-0000-0000-0000-0000000000a3', '25840000-0000-0000-0000-00000000000a', 'SPC Fin2',  'spc-fin2@example.com',  'Finance', 'active'),
  ('25840000-0000-0000-0000-0000000000a4', '25840000-0000-0000-0000-00000000000a', 'SPC PM',    'spc-pm@example.com',    'Project Manager', 'active'),
  ('25840000-0000-0000-0000-0000000000a5', '25840000-0000-0000-0000-00000000000a', 'SPC Eng',   'spc-eng@example.com',   'Engineer', 'active'),
  ('25840000-0000-0000-0000-0000000000a6', '25840000-0000-0000-0000-00000000000a', 'SPC Exec',  'spc-exec@example.com',  'Executive', 'active'),
  ('25840000-0000-0000-0000-0000000000a7', '25840000-0000-0000-0000-00000000000a', 'SPC PM2',   'spc-pm2@example.com',   'Project Manager', 'active'),
  ('25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-00000000000b', 'SPC XOrg',  'spc-xorg@example.com',  'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25840000-0000-0000-0000-0000000000d1', '25840000-0000-0000-0000-00000000000a', 'SPC Site',  'Ongoing Project', '25840000-0000-0000-0000-0000000000a4'),
  ('25840000-0000-0000-0000-0000000000d2', '25840000-0000-0000-0000-00000000000a', 'SPC Other', 'Ongoing Project', '25840000-0000-0000-0000-0000000000a7');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25840000-0000-0000-0000-0000000000e1', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'A', 'Item A', 'm3', 100, 12),
  ('25840000-0000-0000-0000-0000000000e2', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'B', 'Item B', 'm3', 100, 12),
  ('25840000-0000-0000-0000-0000000000e3', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'C', 'Item C', 'm3', 100, 12),
  ('25840000-0000-0000-0000-0000000000e4', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'D', 'Item D', 'm3', 100, 12);
insert into companies (id, org_id, name, type) values
  ('25840000-0000-0000-0000-0000000000c1', '25840000-0000-0000-0000-00000000000a', 'SPC Vendor One', 'Vendor'),
  ('25840000-0000-0000-0000-0000000000c2', '25840000-0000-0000-0000-00000000000a', 'SPC Vendor Two', 'Vendor');
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'SPC WO', 0, 'exclusive', 0);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('25840000-0000-0000-0000-000000000701', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-0000000000e1', 100),
  ('25840000-0000-0000-0000-000000000702', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-0000000000e2', 100),
  ('25840000-0000-0000-0000-000000000703', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-0000000000e3', 100),
  ('25840000-0000-0000-0000-000000000704', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-0000000000e4', 100);
insert into crews (id, org_id, code, name, kind, vendor_company_id) values
  ('25840000-0000-0000-0000-000000000801', '25840000-0000-0000-0000-00000000000a', 'V1-A', 'Vendor One crew', 'vendor', '25840000-0000-0000-0000-0000000000c1'),
  ('25840000-0000-0000-0000-000000000802', '25840000-0000-0000-0000-00000000000a', 'OWN-A', 'Own crew', 'own', null),
  ('25840000-0000-0000-0000-000000000803', '25840000-0000-0000-0000-00000000000a', 'V2-A', 'Vendor Two crew', 'vendor', '25840000-0000-0000-0000-0000000000c2');
insert into procurements (id, org_id, title, project_id, vendor_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('25840000-0000-0000-0000-0000000000f1', '25840000-0000-0000-0000-00000000000a', 'SPC subcontract', '25840000-0000-0000-0000-0000000000d1',
   '25840000-0000-0000-0000-0000000000c1', '25840000-0000-0000-0000-0000000000a4', 'Ordered', 4800, 4800,
   '25840000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency, work_order_id) values
  ('25840000-0000-0000-0000-000000000101', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000f1', 'PO-SPC-1', 'Issued', current_date, 'IDR',
   '25840000-0000-0000-0000-0000000000b1');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('25840000-0000-0000-0000-000000000101', 1, '25840000-0000-0000-0000-0000000000e1', 100, 12, 'm3'),
  ('25840000-0000-0000-0000-000000000101', 1, '25840000-0000-0000-0000-0000000000e2', 100, 12, 'm3'),
  ('25840000-0000-0000-0000-000000000101', 1, '25840000-0000-0000-0000-0000000000e3', 100, 12, 'm3'),
  ('25840000-0000-0000-0000-000000000101', 1, '25840000-0000-0000-0000-0000000000e4', 100, 12, 'm3');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('25840000-0000-0000-0000-000000000101', '25840000-0000-0000-0000-0000000000f1', 1, 'Issued', 4800, '25840000-0000-0000-0000-0000000000a4', 'standard');
insert into project_documents (id, org_id, project_id, category, title, status, file_path) values
  ('25840000-0000-0000-0000-000000000201', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'Acceptance', 'BA 1', 'Issued',
   '25840000-0000-0000-0000-00000000000a/25840000-0000-0000-0000-0000000000d1/25840000-0000-0000-0000-000000000201/ba1.pdf');

-- Daily reports (validated unless noted). One report per work order and day; the lines carry the crew (OD-SPC-1).
create or replace function pg_temp.report(p_id text, p_date date, p_status text, p_superseded boolean default false) returns void language sql as $$
  insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at, validated_by, validated_at, superseded_at)
  values (('25840000-0000-0000-0000-000000000' || p_id)::uuid, '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1',
          '25840000-0000-0000-0000-0000000000b1', p_date, p_status, '25840000-0000-0000-0000-0000000000a5', now(),
          case when p_status = 'validated' then '25840000-0000-0000-0000-0000000000a4'::uuid end,
          case when p_status = 'validated' then now() end,
          case when p_superseded then now() end)
$$;
create or replace function pg_temp.pline(p_report text, p_pos int, p_wol text, p_qty numeric, p_crew text) returns void language sql as $$
  insert into dsr_progress_lines (org_id, report_id, position, work_order_line_id, quantity, unit, crew_id)
  values ('25840000-0000-0000-0000-00000000000a', ('25840000-0000-0000-0000-000000000' || p_report)::uuid, p_pos,
          ('25840000-0000-0000-0000-000000000' || p_wol)::uuid, p_qty, 'm3',
          case when p_crew is null then null else ('25840000-0000-0000-0000-000000000' || p_crew)::uuid end)
$$;
select pg_temp.report('901', '2026-03-03', 'validated');   select pg_temp.pline('901', 1, '701', 15.000, '801');
select pg_temp.report('902', '2026-03-09', 'validated');   select pg_temp.pline('902', 1, '701', 25.000, '801'); select pg_temp.pline('902', 2, '701', 4.000, '802');
select pg_temp.report('903', '2026-03-10', 'validated');   select pg_temp.pline('903', 1, '702', 12.500, '801'); select pg_temp.pline('903', 2, '703', 3.333, '801'); select pg_temp.pline('903', 3, '704', 6.000, '801');
select pg_temp.report('904', '2026-03-11', 'submitted');   select pg_temp.pline('904', 1, '701', 2.000, '801');
select pg_temp.report('905', '2026-03-12', 'validated', true); select pg_temp.pline('905', 1, '701', 7.000, '801');
select pg_temp.report('906', '2026-02-27', 'validated');   select pg_temp.pline('906', 1, '701', 9.000, '801');  -- outside the period

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.as_super() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;
create or replace function pg_temp.u(p_k text) returns uuid language sql as $$ select ('25840000-0000-0000-0000-0000000000' || p_k)::uuid $$;
-- a confirmed signed acceptance for the given cumulative quantities (appended as superuser, as the shipped tests do)
create or replace function pg_temp.accept(p_a numeric, p_b numeric, p_c numeric) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into subcontract_acceptances (id, org_id, project_id, po_id, acceptance_date, status, prepared_by, confirmed_by, confirmed_at, confirm_basis, document_id)
  values (v, '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', '25840000-0000-0000-0000-000000000101', current_date,
          'Confirmed', '25840000-0000-0000-0000-0000000000a4', '25840000-0000-0000-0000-0000000000a2', clock_timestamp(), 'standard',
          '25840000-0000-0000-0000-000000000201');
  insert into subcontract_acceptance_lines values (v, '25840000-0000-0000-0000-0000000000e1', p_a), (v, '25840000-0000-0000-0000-0000000000e2', p_b),
                                                  (v, '25840000-0000-0000-0000-0000000000e3', p_c);
  return v;
end $$;

create or replace function pg_temp.po() returns uuid language sql as $$ select '25840000-0000-0000-0000-000000000101'::uuid $$;
create or replace function pg_temp.cid(k text) returns uuid language sql as $$ select current_setting('spc.' || k)::uuid $$;
select pg_temp.report('911', '2026-04-05', 'validated'); select pg_temp.pline('911', 1, '701', 1.000, '801');
select pg_temp.report('912', '2026-05-05', 'validated'); select pg_temp.pline('912', 1, '701', 2.000, '801');
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e1'), 'm3', 10.00, 'IDR', '2026-03-01');
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e2'), 'm3',  8.40, 'IDR', '2026-03-01');
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e3'), 'm3',  9.99, 'IDR', '2026-03-01');
-- March, prepared and submitted by the PM, approved by Finance 1.
select pg_temp.act_as(pg_temp.u('a4'));
select set_config('spc.mar', prepare_subcontract_certificate(pg_temp.po(), '2026-03-01')::text, true);
select set_config('spc.bc', record_subcontract_backcharge(pg_temp.u('c1'), pg_temp.u('d1'), pg_temp.u('b1'), 38.30, 'IDR', 'rework')::text, true);
select set_certificate_backcharge(pg_temp.cid('mar'), pg_temp.cid('bc'), true);
select set_certificate_deselection(pg_temp.cid('mar'), '2026-03-10', '25840000-0000-0000-0000-000000000704', '25840000-0000-0000-0000-000000000801', true, 'no rate agreed');
select submit_subcontract_certificate(pg_temp.cid('mar'));
reset role; select pg_temp.accept(40, 12.5, 3.333);
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select approve_subcontract_certificate(pg_temp.cid('mar'));

-- Who may bill (FR-SPC-019): Finance and Admin only.
select pg_temp.act_as(pg_temp.u('a4'));
select throws_ok($$ select bill_subcontract_certificate(pg_temp.cid('mar'), current_date) $$, '42501', 'only Finance and Admin bill a certificate', 'AC-SPC-017 a Project Manager cannot bill');
select pg_temp.act_as(pg_temp.u('a3'));
-- A connected-ERP organisation with backcharges is refused until the ERP route carries the deduction.
savepoint erp1;
reset role;
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status)
  values ('25840000-0000-0000-0000-00000000000a', 'erpnext', 'https://erp.example.com', 'spc-test-ref', 'active');
set local role authenticated; select pg_temp.act_as(pg_temp.u('a3'));
select throws_ok($$ select bill_subcontract_certificate(pg_temp.cid('mar'), current_date) $$, '42501', null,
  'FR-SPC-015 an organisation connected to an ERP is refused for a certificate with backcharges (OD-SPC-5)');
reset role; rollback to savepoint erp1;
set local role authenticated; select pg_temp.act_as(pg_temp.u('a3'));

-- AC-SPC-013 the cap refuses the bill: another bill already holds 30 of A's 40 verified. Nothing half-written.
select set_config('spc.blk', (capture_subcontract_vendor_invoice(p_procurement_id => '25840000-0000-0000-0000-0000000000f1', p_status => 'Received',
  p_invoice_date => current_date, p_amount => 300.00, p_tax_treatment => 'exclusive', p_tax_amount => 0,
  p_lines => jsonb_build_array(jsonb_build_object('boq_item_id', pg_temp.u('e1'), 'quantity', 30, 'rate', 10.00)))).id::text, true);
select is((bill_subcontract_certificate(pg_temp.cid('mar'), current_date))->>'status', 'refused',
  'AC-SPC-013 bill capture refused by the cap reports a refusal, it does not raise half-way');
select is((select status from subcontract_certificates where id = pg_temp.cid('mar')), 'approved', 'AC-SPC-013 the certificate stays approved');
select ok((select bill_refusal from subcontract_certificates where id = pg_temp.cid('mar')) like 'line % cannot be billed: verified 40%', 'AC-SPC-013 and shows the refusal reason');
select is((select count(*)::int from procurement_invoices where certificate_id = pg_temp.cid('mar') or id in (select invoice_id from subcontract_certificates)), 0, 'AC-SPC-013 no invoice was written for the certificate');
select is((select count(*)::int from procurement_invoice_lines), 1, 'AC-SPC-013 and no bill line beyond the blocking bill''s own');
select is((select count(*)::int from procurement_invoices where procurement_id = '25840000-0000-0000-0000-0000000000f1'), 1, 'AC-SPC-013 no second invoice exists on the purchase');
-- clear the blocker (void it: author a3, voider a2)
select pg_temp.act_as(pg_temp.u('a2'));
select void_subcontract_bill(current_setting('spc.blk')::uuid, 'mistyped');
select pg_temp.act_as(pg_temp.u('a3'));

-- AC-SPC-010 bill: exactly one invoice, lines at the snapshot rates, the certificate's work order, the invoice id stored.
select is((bill_subcontract_certificate(pg_temp.cid('mar'), current_date))->>'status', 'billed', 'AC-SPC-010 an approved certificate is billed');
select set_config('spc.inv', (select invoice_id::text from subcontract_certificates where id = pg_temp.cid('mar')), true);
select is((select count(*)::int from procurement_invoices where certificate_id = pg_temp.cid('mar')), 1, 'AC-SPC-010 exactly one invoice exists for the certificate');
select is((select jsonb_agg(jsonb_build_array(b.item_code, l.quantity, l.rate, l.amount) order by b.item_code)::text
             from procurement_invoice_lines l join boq_items b on b.id = l.boq_item_id where l.invoice_id = current_setting('spc.inv')::uuid),
  '[["A", 40.000, 10.00, 400.00], ["B", 12.500, 8.40, 105.00], ["C", 3.333, 9.99, 33.30]]', 'AC-SPC-010 its lines equal the snapshot at the snapshot rates');
select is((select work_order_id from procurement_invoices where id = current_setting('spc.inv')::uuid), pg_temp.u('b1'), 'AC-SPC-010 the bill''s work order is the certificate''s (set through set_cost_attribution)');
select is((select amount from procurement_invoices where id = current_setting('spc.inv')::uuid), 538.30, 'AC-SPC-010 the bill''s pre-tax amount is the gross 538.30 (it equals its lines)');
select is((select deduction_amount from procurement_invoices where id = current_setting('spc.inv')::uuid), 38.30, 'AC-SPC-015 the backcharge is the bill''s own deduction field, not part of the amount');
select is((select status || ':' || (invoice_id = current_setting('spc.inv')::uuid)::text from subcontract_certificates where id = pg_temp.cid('mar')), 'billed:true', 'AC-SPC-010 the invoice id is stored and the certificate is billed');
select throws_ok($$ select bill_subcontract_certificate(pg_temp.cid('mar'), current_date) $$, '23505', null, 'AC-SPC-010 a second bill call is refused');
select is((select count(*)::int from procurement_invoices where certificate_id = pg_temp.cid('mar')), 1, 'AC-SPC-010 and creates no second invoice');
select throws_ok($$ update procurement_invoices set deduction_amount = 0 where id = current_setting('spc.inv')::uuid $$, '42501', null, 'FR-SPC-015 the deduction on a bill is fixed once set');
select throws_ok($$ select cancel_subcontract_certificate(pg_temp.cid('mar'), 'oops') $$, '23514', null, 'FR-SPC-017 a billed certificate cannot be cancelled (void the bill first)');

-- AC-SPC-011 payable is gross less the backcharge (500.00) and a payment above it is refused.
select throws_ok($$ select create_payment('25840000-0000-0000-0000-0000000000f1', current_setting('spc.inv')::uuid, 'PAY-1', 'Scheduled', current_date, 538.30) $$,
  '23514', null, 'AC-SPC-011 a payment of the gross 538.30 is refused: the payable is 500.00');

-- A payment for a voided bill on the purchase (non-ERP voided bill) is ignored by the payable ceiling:
reset role;
alter table payments disable trigger payments_zz_voided_bill;
insert into payments (id, org_id, procurement_id, invoice_id, currency, amount, status)
values ('25840000-0000-0000-0000-0000000000e9', '25840000-0000-0000-0000-00000000000a',
        '25840000-0000-0000-0000-0000000000f1', current_setting('spc.blk')::uuid, 'USD', 200.00, 'Scheduled');
alter table payments enable trigger payments_zz_voided_bill;
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));

select lives_ok($$ select create_payment('25840000-0000-0000-0000-0000000000f1', current_setting('spc.inv')::uuid, 'PAY-1', 'Scheduled', current_date, 500.00) $$,
  'AC-SPC-011 a payment of the payable 500.00 is accepted');
select throws_ok($$ select create_payment('25840000-0000-0000-0000-0000000000f1', current_setting('spc.inv')::uuid, 'PAY-2', 'Scheduled', current_date, 0.01) $$,
  '23514', null, 'AC-SPC-011 and one cent more is refused');
reset role;
delete from payments where id = '25840000-0000-0000-0000-0000000000e9';
-- AC-SPC-016 the work-order cost read: paid, the bill's cost is the net figure.
reset role;
update payments set status = 'Paid' where procurement_id = '25840000-0000-0000-0000-0000000000f1';
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select is((select amount from work_order_cost_amounts(pg_temp.u('d1')) where source = 'vendor_bill' and record_id = current_setting('spc.inv')::uuid),
  '500.00', 'AC-SPC-016 the billed certificate shows on its work order with the net-based cost 500.00');
select is((select work_order_id from work_order_cost_amounts(pg_temp.u('d1')) where source = 'vendor_bill' and record_id = current_setting('spc.inv')::uuid),
  pg_temp.u('b1'), 'AC-SPC-016 and on work order W1');
select is((select jsonb_agg(jsonb_build_array(period_start, status, gross, backcharge_total, net))::text from work_order_certified_cost(pg_temp.u('b1'))),
  '[["2026-03-01", "billed", 538.30, 38.30, 500.00]]', 'FR-SPC-018 the work order shows its certified cost by period');

-- AC-SPC-014 void: April, billed then voided by the shipped void; the certificate returns to approved by the hook.
select pg_temp.act_as(pg_temp.u('a4'));
select set_config('spc.apr', prepare_subcontract_certificate(pg_temp.po(), '2026-04-01')::text, true);
select submit_subcontract_certificate(pg_temp.cid('apr'));
reset role; select pg_temp.accept(41, 12.5, 3.333);
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select approve_subcontract_certificate(pg_temp.cid('apr'));
select pg_temp.act_as(pg_temp.u('a3'));
select bill_subcontract_certificate(pg_temp.cid('apr'), current_date);
select set_config('spc.inv2', (select invoice_id::text from subcontract_certificates where id = pg_temp.cid('apr')), true);
select is((select billed from subcontract_po_position(pg_temp.po()) where item_code = 'A'), 41.000, 'AC-SPC-014 setup: the PO position shows 41 of A billed');
select pg_temp.act_as(pg_temp.u('a2'));
select lives_ok($$ select void_subcontract_bill(current_setting('spc.inv2')::uuid, 'wrong period') $$, 'AC-SPC-014 the shipped void voids the certificate''s bill');
select is((select status || ':' || coalesce(invoice_id::text, 'none') from subcontract_certificates where id = pg_temp.cid('apr')), 'approved:none',
  'AC-SPC-014 the certificate returns to approved (the after-update hook on the bill)');
select is((select billed from subcontract_po_position(pg_temp.po()) where item_code = 'A'), 40.000, 'AC-SPC-014 the PO position''s billed quantity drops by the voided bill');
select lives_ok($$ select cancel_subcontract_certificate(pg_temp.cid('apr'), 'redo') $$, 'AC-SPC-014 the returned certificate can be cancelled');
select is((select count(*)::int from subcontract_certificate_claims where certificate_id = pg_temp.cid('apr')), 0, 'AC-SPC-014 its measured work is released');
select pg_temp.act_as(pg_temp.u('a4'));
select set_config('spc.apr2', prepare_subcontract_certificate(pg_temp.po(), '2026-04-01')::text, true);
select is((select jsonb_array_length(subcontract_certificate_view(pg_temp.cid('apr2'))->'derived'->'lines')), 1, 'AC-SPC-014 and the same work can be certified again');
select submit_subcontract_certificate(pg_temp.cid('apr2'));
select pg_temp.act_as(pg_temp.u('a2'));
select approve_subcontract_certificate(pg_temp.cid('apr2'));
select pg_temp.act_as(pg_temp.u('a3'));
select bill_subcontract_certificate(pg_temp.cid('apr2'), current_date);
select set_config('spc.inv3', (select invoice_id::text from subcontract_certificates where id = pg_temp.cid('apr2')), true);
-- a certificate problem can never block a void: break the certificate update, the void still succeeds.
reset role;
alter table subcontract_certificates add constraint spc_test_break check (status <> 'approved') not valid;
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select lives_ok($$ select void_subcontract_bill(current_setting('spc.inv3')::uuid, 'wrong period again') $$, 'AC-SPC-014 a failing certificate hook never blocks the void');
select is((select voided_at is not null from procurement_invoices where id = current_setting('spc.inv3')::uuid), true, 'AC-SPC-014 the bill is voided');
reset role;
alter table subcontract_certificates drop constraint spc_test_break;

-- FR-SPC-010 the acceptance bridge: May (A 2.000), prepared by the PM, makes a DRAFT acceptance for verified + measured.
set local role authenticated; select pg_temp.act_as(pg_temp.u('a4'));
select set_config('spc.may', prepare_subcontract_certificate(pg_temp.po(), '2026-05-01')::text, true);
select set_config('spc.acc', prepare_certificate_acceptance(pg_temp.cid('may'))::text, true);
select is((select status from subcontract_acceptances where id = pg_temp.cid('acc')), 'Draft', 'FR-SPC-010 the bridge prepares a draft acceptance; confirming it stays the shipped process');
select is((select quantity from subcontract_acceptance_lines where acceptance_id = pg_temp.cid('acc') and boq_item_id = pg_temp.u('e1')), 43.000,
  'FR-SPC-010 its cumulative verified is the latest confirmed 41 plus the certificate''s measured 2.000');
select is((select acceptance_id from subcontract_certificates where id = pg_temp.cid('may')), pg_temp.cid('acc'), 'FR-SPC-010 the certificate remembers it');
select pg_temp.act_as(pg_temp.u('a5'));
select throws_ok($$ select prepare_certificate_acceptance(pg_temp.cid('may')) $$, 'P0002', null, 'AC-SPC-017 an Engineer cannot prepare it');
reset role;
select is((select count(*)::int from audit_events where action = 'subcontract_certificate.bill'), 3, 'FR-SPC-021 each bill (March, April, April again) is audited');

select * from finish();
rollback;
