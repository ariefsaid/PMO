-- 0262_work_order_billing_refusal.test.sql — OD-BILL-1 AC-BWO-002: the database refuses invoicing past a work order.
-- Migration under test: 0262_billing_by_work_order.sql §4–§8. Every refusal asserts SQLSTATE AND message.
begin;
create extension if not exists pgtap;
select plan(31);

insert into organizations (id, name) values
  ('02620000-0000-0000-0000-000000000001', 'BWO Org'),
  ('02620000-0000-0000-0000-000000000002', 'BWO Other Org');
insert into auth.users (id, email) values
  ('02620000-0000-0000-0000-0000000000a2', 'bwo-r-fin@example.com'),
  ('02620000-0000-0000-0000-0000000000b1', 'bwo-r-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02620000-0000-0000-0000-0000000000a2', '02620000-0000-0000-0000-000000000001', 'BWO Fin', 'bwo-r-fin@example.com', 'Finance', 'active'),
  ('02620000-0000-0000-0000-0000000000b1', '02620000-0000-0000-0000-000000000002', 'BWO XOrg', 'bwo-r-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('02620000-0000-0000-0000-0000000000f1', '02620000-0000-0000-0000-000000000001', 'BWO Client', 'Client'),
  ('02620000-0000-0000-0000-0000000000f9', '02620000-0000-0000-0000-000000000002', 'BWO X Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-000000000001', 'BWO R Project', 'Ongoing Project', 10000, 'exclusive', 0, '02620000-0000-0000-0000-0000000000f1'),
  ('02620000-0000-0000-0000-0000000000c2', '02620000-0000-0000-0000-000000000001', 'BWO R Other Project', 'Ongoing Project', 10000, 'exclusive', 0, '02620000-0000-0000-0000-0000000000f1'),
  ('02620000-0000-0000-0000-0000000000c9', '02620000-0000-0000-0000-000000000002', 'BWO X Project', 'Ongoing Project', 10000, 'exclusive', 0, '02620000-0000-0000-0000-0000000000f9');
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, closed_at, cancelled_at) values
  ('02620000-0000-0000-0000-0000000000d1', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R One',       'Issued',    'WO-R-1', 1000, 'exclusive', 0, null,  null),
  ('02620000-0000-0000-0000-0000000000d2', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Draft',     'Draft',     null,     1000, 'exclusive', 0, null,  null),
  ('02620000-0000-0000-0000-0000000000d3', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Cancelled', 'Cancelled', 'WO-R-3', 1000, 'exclusive', 0, null,  now()),
  ('02620000-0000-0000-0000-0000000000d4', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Closed',    'Closed',    'WO-R-4',  500, 'exclusive', 0, now(), null),
  ('02620000-0000-0000-0000-0000000000d6', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Six',       'Issued',    'WO-R-6', 1000, 'exclusive', 0, null,  null),
  ('02620000-0000-0000-0000-0000000000d7', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Seven',     'Issued',    'WO-R-7', 1000, 'exclusive', 0, null,  null),
  ('02620000-0000-0000-0000-0000000000d8', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Eight',     'Issued',    'WO-R-8', 1000, 'exclusive', 0, null,  null),
  ('02620000-0000-0000-0000-0000000000d9', '02620000-0000-0000-0000-000000000002', '02620000-0000-0000-0000-0000000000c9', 'X Nine',      'Issued',    'WO-X-9', 1000, 'exclusive', 0, null,  null);
insert into boq_items (id, org_id, project_id, work_order_id, item_code, description, unit, quantity, rate) values
  ('02620000-0000-0000-0000-0000000000e7', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d7', 'STATION', 'Station build', 'unit', 10, 600);
-- A cancelled 300 on the Closed work order, loaded server-side (no JWT): §C revives it.
insert into sales_invoices (id, org_id, project_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('02620000-0000-0000-0000-0000000005ac', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d4', '2026-10-01', 300, 'exclusive', 0, 'USD', 'Cancelled');

-- ── §A the native path: Finance records invoices in an org whose revenue PMO owns ─────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a1', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1', 600, 'exclusive', 0, 'USD') $$,
  'AC-BWO-002 Finance invoices 600 of a 1,000 work order');                                                          -- 1
select throws_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a2', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1', 401, 'exclusive', 0, 'USD') $$,
  'BW001', 'this invoice would bill 401.00 against work order WO-R-1 (worth 1000.00 excl. tax, with 600.00 already invoiced or in draft): only 400.00 is still to invoice',
  'AC-BWO-002 an invoice that would pass the work order is refused, naming what is left');                           -- 2
select lives_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a3', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1', 400, 'exclusive', 0, 'USD') $$,
  'AC-BWO-002 exactly what is left is accepted');                                                                     -- 3
select throws_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a4', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1', 0.01, 'exclusive', 0, 'USD') $$,
  'BW001', 'this invoice would bill 0.01 against work order WO-R-1 (worth 1000.00 excl. tax, with 1000.00 already invoiced or in draft): only 0.00 is still to invoice',
  'AC-BWO-002 one cent past the value is refused');                                                                   -- 4
select throws_ok($$ insert into sales_invoices (project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d2', 10, 'exclusive', 0, 'USD') $$,
  'BW001', 'work order R Draft is Draft: only an issued or closed work order can be invoiced',
  'AC-BWO-002 a Draft work order cannot be invoiced');                                                                -- 5
select throws_ok($$ insert into sales_invoices (project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d3', 10, 'exclusive', 0, 'USD') $$,
  'BW001', 'work order WO-R-3 is Cancelled: only an issued or closed work order can be invoiced',
  'AC-BWO-002 a Cancelled work order cannot be invoiced');                                                            -- 6
select lives_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a5', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d4', 500, 'exclusive', 0, 'USD') $$,
  'AC-BWO-002 a Closed work order can still be invoiced (DD-BWO-7)');                                                -- 7
select throws_ok($$ insert into sales_invoices (project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d6', 10, 'exclusive', 0, 'EUR') $$,
  'BW001', 'this invoice is in EUR but work order WO-R-6 is in USD: a work order is invoiced in its own currency',
  'AC-BWO-002 an invoice in another currency than its work order is refused');                                       -- 8
reset role;

-- ── §B the ERP path: the outbox fence runs before any ERP write ─────────────────────────────────────
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c01', 'bwo-k1', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02620000-0000-0000-0000-0000000000d6","projectId":"02620000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":2,"rate":300}]}') $$,
  'AC-BWO-002 an ERP create of 600 against a 1,000 work order is queued');                                          -- 9
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c02', 'bwo-k2', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02620000-0000-0000-0000-0000000000d6","projectId":"02620000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":401}]}') $$,
  'BW001', 'this invoice would bill 401.00 against work order WO-R-6 (worth 1000.00 excl. tax, with 600.00 already invoiced or in draft): only 400.00 is still to invoice',
  'AC-BWO-002 a second ERP create that would pass the work order is refused before any ERP write — the first counts while in flight'); -- 10
set local role authenticated;
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ insert into sales_invoices (project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d6', 401, 'exclusive', 0, 'USD') $$,
  'BW001', 'this invoice would bill 401.00 against work order WO-R-6 (worth 1000.00 excl. tax, with 600.00 already invoiced or in draft): only 400.00 is still to invoice',
  'AC-BWO-002 a native invoice sees the in-flight ERP command too');                                                -- 11
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c03', 'bwo-k3', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02620000-0000-0000-0000-0000000000d6","projectId":"02620000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":400}]}') $$,
  'AC-BWO-002 an ERP create of exactly what is left is queued');                                                    -- 12
update external_command_outbox set state = 'failed' where pmo_record_id = '02620000-0000-0000-0000-000000000c01';
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c04', 'bwo-k4', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02620000-0000-0000-0000-0000000000d6","projectId":"02620000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":600}]}') $$,
  'AC-BWO-002 a failed command no longer counts');                                                                  -- 13
select throws_ok($$ select public.claim_outbox_for_commit((select id from external_command_outbox where pmo_record_id = '02620000-0000-0000-0000-000000000c01')) $$,
  'BW001', 'this invoice would bill 600.00 against work order WO-R-6 (worth 1000.00 excl. tax, with 1000.00 already invoiced or in draft): only 0.00 is still to invoice',
  'AC-BWO-002 …so the failed command cannot be revived once the remainder is reserved: the claim re-checks it');     -- 13b
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c05', 'bwo-k5', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02620000-0000-0000-0000-0000000000d6","projectId":"02620000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":"5"}]}') $$,
  'BW001', 'the invoice amount could not be read, so it cannot be checked against work order WO-R-6',
  'AC-BWO-002 a command whose lines cannot be read is refused, never waved through');                               -- 14
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c06', 'bwo-k6', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02620000-0000-0000-0000-0000000000d9","projectId":"02620000-0000-0000-0000-0000000000c9","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":1}]}') $$,
  'BW001', 'work order not found',
  'AC-BWO-002 another organisation''s work order is refused as not found');                                         -- 15
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c07', 'bwo-k7', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02620000-0000-0000-0000-0000000000d1","projectId":"02620000-0000-0000-0000-0000000000c2","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":1}]}') $$,
  'BW001', 'the work order must be on the same project as the invoice',
  'AC-BWO-002 another project''s work order is refused before the ERP write (its mirror would otherwise be refused after it)'); -- 16
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-0000000005a1', 'bwo-k8', 'erpnext', 'update', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"externalRecordId":"SI-1","items":[{"item_code":"SVC","qty":1,"rate":601}]}') $$,
  'BW001', 'this invoice would bill 601.00 against work order WO-R-1 (worth 1000.00 excl. tax, with 400.00 already invoiced or in draft): only 600.00 is still to invoice',
  'AC-BWO-002 an ERP edit whose rebuilt lines would pass the rest is refused (its work order is the mirror row''s)'); -- 17
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-0000000005a1', 'bwo-k9', 'erpnext', 'update', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"externalRecordId":"SI-1","received_date":"2026-10-07"}') $$,
  'AC-BWO-002 an ERP edit that rebuilds no lines moves no money and is not checked');                               -- 18

-- ── §C the mirror is never refused; user-JWT updates are ────────────────────────────────────────────
select lives_ok($$ insert into sales_invoices (id, org_id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency, status)
  values ('02620000-0000-0000-0000-0000000005b1', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d6', 5000, 'exclusive', 0, 'USD', 'Unpaid') $$,
  'AC-BWO-002 the ERP mirror writer is never refused, even past the value (the ERP document already exists, DD-VI-3a)'); -- 19
select ok((select remaining < 0 from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d6'),
  'AC-BWO-002 …and the work order then reads over-invoiced');                                                       -- 20
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ update sales_invoices set amount = 700 where id = '02620000-0000-0000-0000-0000000005a1' $$,
  'BW001', 'this invoice would bill 700.00 against work order WO-R-1 (worth 1000.00 excl. tax, with 400.00 already invoiced or in draft): only 600.00 is still to invoice',
  'AC-BWO-002 a definer-style update raising an invoice past the value under a user JWT is refused');               -- 21
select lives_ok($$ update sales_invoices set amount = 500 where id = '02620000-0000-0000-0000-0000000005a1' $$,
  'AC-BWO-002 a reduction always passes');                                                                           -- 22
select throws_ok($$ update sales_invoices set status = 'Unpaid' where id = '02620000-0000-0000-0000-0000000005ac' $$,
  'BW001', 'this invoice would bill 300.00 against work order WO-R-4 (worth 500.00 excl. tax, with 500.00 already invoiced or in draft): only 0.00 is still to invoice',
  'AC-BWO-002 reviving a cancelled invoice past the value is refused');                                             -- 23

-- ── §D claims reserve their gross when created ──────────────────────────────────────────────────────
set local role authenticated;
select lives_ok($$ do $d$ begin perform set_config('bwo.claim', public.create_progress_claim(
    '02620000-0000-0000-0000-0000000000c1', 'progress', p_work_order_id => '02620000-0000-0000-0000-0000000000d7',
    p_lines => '[{"boq_item_id":"02620000-0000-0000-0000-0000000000e7","quantity":1}]'::jsonb)::text, true); end $d$ $$,
  'AC-BWO-002 a 600 claim on a 1,000 work order is accepted');                                                       -- 24
select throws_ok($$ select public.create_progress_claim('02620000-0000-0000-0000-0000000000c1', 'progress',
    p_work_order_id => '02620000-0000-0000-0000-0000000000d7', p_lines => '[{"boq_item_id":"02620000-0000-0000-0000-0000000000e7","quantity":1}]'::jsonb) $$,
  'BW001', 'this invoice would bill 600.00 against work order WO-R-7 (worth 1000.00 excl. tax, with 600.00 already invoiced or in draft): only 400.00 is still to invoice',
  'AC-BWO-002 a claim whose gross would pass the work order is refused');                                           -- 25
reset role;
insert into project_documents (id, org_id, project_id, category, title, status, revision, file_path) values
  ('02620000-0000-0000-0000-0000000000a7', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'Report', 'BWO evidence', 'Issued', 'A', 'e2e/bwo-evidence.pdf');
insert into progress_claim_evidence (org_id, claim_id, document_id, document_status, document_revision, attached_by) values
  ('02620000-0000-0000-0000-000000000001', current_setting('bwo.claim')::uuid, '02620000-0000-0000-0000-0000000000a7', 'Issued', 'A', '02620000-0000-0000-0000-0000000000a2');
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', current_setting('bwo.claim'), 'bwo-k10', 'erpnext', 'create', 'pending',
          jsonb_build_object('erp_doc_kind', 'sales-invoice', 'vat_flag_at_resolution', true,
                             'workOrderId', '02620000-0000-0000-0000-0000000000d7',
                             'projectId', '02620000-0000-0000-0000-0000000000c1', 'currency', 'USD',
                             'items', jsonb_build_array(jsonb_build_object('item_code', 'STATION', 'qty', 1, 'rate', 999999)))) $$,
  'AC-BWO-002 a claim''s own invoice command is left to the claim, which reserved its gross when it was created');  -- 26

-- ── §E lock and grants ──────────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select set_config('bwo.locks', (select count(*)::text from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()), true);
insert into sales_invoices (id, org_id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a8', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d8', 10, 'exclusive', 0, 'USD');
select is((select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()),
  current_setting('bwo.locks')::int + 1,
  'AC-BWO-002 a billing write takes its work order''s advisory lock (DD-BWO-5)');                                   -- 27
reset request.jwt.claims;
select ok(not has_function_privilege('anon', 'public.assert_work_order_invoiceable(uuid,uuid,uuid,text,numeric,text)', 'execute')
          and not has_function_privilege('authenticated', 'public.assert_work_order_invoiceable(uuid,uuid,uuid,text,numeric,text)', 'execute'),
  'AC-BWO-002 the refusal helper is not client-executable');                                                         -- 28
select ok(not exists (select 1 from (values ('public.lock_work_order_billing(uuid)'), ('public.invoice_command_line_total(jsonb)'),
                                            ('public.assert_sales_invoice_within_work_order()'), ('public.assert_outbox_invoice_within_work_order()'),
                                            ('public.assert_invoice_command_within_work_order(uuid,text,text,jsonb)')) f(sig)
                       where has_function_privilege('anon', f.sig, 'execute') or has_function_privilege('authenticated', f.sig, 'execute')),
  'AC-BWO-002 the lock, line-total and trigger functions are not client-executable');                               -- 29
select is((select count(*)::int from pg_trigger
            where tgname in ('sales_invoices_zzzz_work_order_invoiceable', 'external_command_outbox_zz_work_order_invoice_fence')
              and not tgisinternal), 2,
  'AC-BWO-002 both fences are installed');                                                                           -- 30

select * from finish();
rollback;
