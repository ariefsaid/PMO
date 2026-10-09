-- 0262_work_order_billing_fence_hardening.test.sql — OD-BILL-1 AC-BWO-002: the work-order fence holds on every path an
-- invoice command can take to the ERP — a revived failed command, an id in another spelling, a negative amount, an id
-- that belongs to a claim. Migration under test: 0262_billing_by_work_order.sql §4–§6 and §6b (claim_outbox_for_commit).
-- Every refusal asserts SQLSTATE AND message. Fixtures load with no JWT (a server load). A row inserted with no line
-- array is not checked (it rebuilds no body); patching its lines in afterwards stages a stored payload the insert fence
-- never saw, which is what a revival must re-check.
begin;
create extension if not exists pgtap;
select plan(25);

insert into organizations (id, name) values
  ('02621000-0000-0000-0000-000000000001', 'BWO H Org'),
  ('02621000-0000-0000-0000-000000000002', 'BWO H Other Org');
insert into auth.users (id, email) values
  ('02621000-0000-0000-0000-0000000000a2', 'bwo-h-fin@example.com'),
  ('02621000-0000-0000-0000-0000000000b1', 'bwo-h-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02621000-0000-0000-0000-0000000000a2', '02621000-0000-0000-0000-000000000001', 'BWO H Fin', 'bwo-h-fin@example.com', 'Finance', 'active'),
  ('02621000-0000-0000-0000-0000000000b1', '02621000-0000-0000-0000-000000000002', 'BWO H XOrg', 'bwo-h-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('02621000-0000-0000-0000-0000000000f1', '02621000-0000-0000-0000-000000000001', 'BWO H Client', 'Client'),
  ('02621000-0000-0000-0000-0000000000f9', '02621000-0000-0000-0000-000000000002', 'BWO H X Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('02621000-0000-0000-0000-0000000000c1', '02621000-0000-0000-0000-000000000001', 'BWO H Project', 'Ongoing Project', 100000, 'exclusive', 0, '02621000-0000-0000-0000-0000000000f1'),
  ('02621000-0000-0000-0000-0000000000c9', '02621000-0000-0000-0000-000000000002', 'BWO H X Project', 'Ongoing Project', 100000, 'exclusive', 0, '02621000-0000-0000-0000-0000000000f9');
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount) values
  ('02621000-0000-0000-0000-0000000000d1', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', 'H One',   'Issued', 'WO-H-1', 1000, 'exclusive', 0),
  ('02621000-0000-0000-0000-0000000000d2', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', 'H Two',   'Issued', 'WO-H-2', 1000, 'exclusive', 0),
  ('02621000-0000-0000-0000-0000000000d3', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', 'H Three', 'Issued', 'WO-H-3', 1000, 'exclusive', 0),
  ('02621000-0000-0000-0000-0000000000d4', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', 'H Four',  'Issued', 'WO-H-4', 1000, 'exclusive', 0),
  ('02621000-0000-0000-0000-0000000000d5', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', 'H Five',  'Issued', 'WO-H-5', 1000, 'exclusive', 0),
  ('02621000-0000-0000-0000-0000000000d6', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', 'H Six',   'Issued', 'WO-H-6', 1000, 'exclusive', 0),
  ('02621000-0000-0000-0000-0000000000d7', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', 'H Seven', 'Issued', 'WO-H-7', 1000, 'exclusive', 0),
  ('02621000-0000-0000-0000-0000000000d8', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', 'H Eight', 'Issued', 'WO-H-8', 1000, 'exclusive', 0);
-- Two mirrored invoices filling WO-H-8 (600 + 400).
insert into sales_invoices (id, org_id, project_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('02621000-0000-0000-0000-0000000008a1', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', '02621000-0000-0000-0000-0000000000d8', '2026-10-01', 600, 'exclusive', 0, 'USD', 'Draft'),
  ('02621000-0000-0000-0000-0000000008a2', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', '02621000-0000-0000-0000-0000000000d8', '2026-10-01', 400, 'exclusive', 0, 'USD', 'Draft');
-- Two progress claims on WO-H-3, each with evidence (the 0250 fence requires it before an invoice command).
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, dp_recovery_amount, created_by) values
  ('02621000-0000-0000-0000-0000000003e1', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', '02621000-0000-0000-0000-0000000000d3', 'progress', 'USD', 500, 0, '02621000-0000-0000-0000-0000000000a2'),
  ('02621000-0000-0000-0000-0000000003e2', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', '02621000-0000-0000-0000-0000000000d3', 'progress', 'USD', 300, 0, '02621000-0000-0000-0000-0000000000a2'),
  ('02621000-0000-0000-0000-0000000003e9', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', null, 'progress', 'USD', 10, 0, '02621000-0000-0000-0000-0000000000a2');
insert into project_documents (id, org_id, project_id, category, title, status, revision, file_path) values
  ('02621000-0000-0000-0000-0000000000a7', '02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000000c1', 'Report', 'BWO H evidence', 'Issued', 'A', 'e2e/bwo-h-evidence.pdf');
insert into progress_claim_evidence (org_id, claim_id, document_id, document_status, document_revision, attached_by) values
  ('02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000003e1', '02621000-0000-0000-0000-0000000000a7', 'Issued', 'A', '02621000-0000-0000-0000-0000000000a2'),
  ('02621000-0000-0000-0000-000000000001', '02621000-0000-0000-0000-0000000003e2', '02621000-0000-0000-0000-0000000000a7', 'Issued', 'A', '02621000-0000-0000-0000-0000000000a2');

set local request.jwt.claims = '{"role":"service_role"}';

-- ── §A a failed command revived by claim_outbox_for_commit is re-checked against its STORED payload ──────
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-000000000c11', 'bwo-h-k11', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d1","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":2,"rate":300}]}');
update external_command_outbox set state = 'failed' where pmo_record_id = '02621000-0000-0000-0000-000000000c11';
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-000000000c12', 'bwo-h-k12', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d1","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":1000}]}') $$,
  'AC-BWO-002 with the first command failed, a second reserves the whole work order');                                -- 1
select throws_ok($$ select public.claim_outbox_for_commit((select id from external_command_outbox where pmo_record_id = '02621000-0000-0000-0000-000000000c11')) $$,
  'BW001', 'this invoice would bill 600.00 against work order WO-H-1 (worth 1000.00 excl. tax, with 1000.00 already invoiced or in draft): only 0.00 is still to invoice',
  'AC-BWO-002 reviving the failed command is refused: the remainder is reserved by the command in flight');           -- 2
select is((select state from external_command_outbox where pmo_record_id = '02621000-0000-0000-0000-000000000c11'), 'failed',
  'AC-BWO-002 …and the refused revival leaves the command failed, unclaimed');                                        -- 3

-- A failed command on a work order with room revives, under that work order's billing lock.
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-000000000c21', 'bwo-h-k21', 'erpnext', 'create', 'failed',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d2","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD"}');
update external_command_outbox set payload = payload || '{"items":[{"item_code":"SVC","qty":2,"rate":300}]}'
 where pmo_record_id = '02621000-0000-0000-0000-000000000c21';
select set_config('bwo.locks', (select count(*)::text from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()), true);
select is((select state from public.claim_outbox_for_commit((select id from external_command_outbox where pmo_record_id = '02621000-0000-0000-0000-000000000c21'))),
  'committing', 'AC-BWO-002 a failed command that still fits its work order is revived');                               -- 4
select is((select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()),
  current_setting('bwo.locks')::int + 1,
  'AC-BWO-002 the revival takes its work order''s billing lock (DD-BWO-5)');                                          -- 5

-- An edit revived from failed reads its work order from the mirror row, like the insert fence.
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-0000000008a1', 'bwo-h-k81', 'erpnext', 'update', 'failed',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"externalRecordId":"SI-H-8"}');
update external_command_outbox set payload = payload || '{"items":[{"item_code":"SVC","qty":1,"rate":650}]}'
 where pmo_record_id = '02621000-0000-0000-0000-0000000008a1';
select throws_ok($$ select public.claim_outbox_for_commit((select id from external_command_outbox where pmo_record_id = '02621000-0000-0000-0000-0000000008a1')) $$,
  'BW001', 'this invoice would bill 650.00 against work order WO-H-8 (worth 1000.00 excl. tax, with 400.00 already invoiced or in draft): only 600.00 is still to invoice',
  'AC-BWO-002 a revived edit whose lines would pass the work order is refused (its work order is the mirror row''s)'); -- 6

-- ── §B a claim withdrawn after its failed attempt is never revived into an invoice (FR-PB-013) ─────────
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-0000000003e1', 'bwo-h-k31', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d3","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":500}]}'),
         ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-0000000003e2', 'bwo-h-k32', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d3","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":300}]}');
update external_command_outbox set state = 'failed'
 where pmo_record_id in ('02621000-0000-0000-0000-0000000003e1', '02621000-0000-0000-0000-0000000003e2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02621000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.withdraw_progress_claim('02621000-0000-0000-0000-0000000003e1') $$,
  'AC-BWO-002 a claim whose only invoice attempt failed may be withdrawn (FR-PB-013)');                              -- 7
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$ select public.claim_outbox_for_commit((select id from external_command_outbox where pmo_record_id = '02621000-0000-0000-0000-0000000003e1')) $$,
  '55000', 'this progress claim was withdrawn, so no invoice can be raised for it',
  'AC-BWO-002 …and its failed attempt is then refused on revival, never raised as an invoice');                       -- 8
select is((select state from public.claim_outbox_for_commit((select id from external_command_outbox where pmo_record_id = '02621000-0000-0000-0000-0000000003e2'))),
  'committing', 'AC-BWO-002 a live claim''s failed attempt still revives');                                           -- 9

-- ── §C a sales-invoice command names its record by the canonical uuid text, or it is refused ─────────────
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '0262100000000000000000000000c401', 'bwo-h-k41', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d4","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":5000}]}') $$,
  'BW001', 'a sales invoice command must name its invoice by its canonical id',
  'AC-BWO-002 a record id without hyphens is refused, not waved past the fence');                                     -- 10
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '{02621000-0000-0000-0000-00000000c402}', 'bwo-h-k42', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d4","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":5000}]}') $$,
  'BW001', 'a sales invoice command must name its invoice by its canonical id',
  'AC-BWO-002 a braced record id is refused');                                                                         -- 11
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', 'si-h-403', 'bwo-h-k43', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d4","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":5000}]}') $$,
  'BW001', 'a sales invoice command must name its invoice by its canonical id',
  'AC-BWO-002 a record id that is not a uuid at all is refused');                                                      -- 12
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-00000000c404', 'bwo-h-k44', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d4","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":900}]}');
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-00000000C4AB', 'bwo-h-k45', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d4","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":200}]}') $$,
  'BW001', 'this invoice would bill 200.00 against work order WO-H-4 (worth 1000.00 excl. tax, with 900.00 already invoiced or in draft): only 100.00 is still to invoice',
  'AC-BWO-002 an upper-case record id is measured like its lower-case form');                                         -- 13
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '0262100000000000000000000000c406', 'bwo-h-k46', 'erpnext', 'create', 'failed',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d4","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD"}');
update external_command_outbox set payload = payload || '{"items":[{"item_code":"SVC","qty":1,"rate":5000}]}'
 where pmo_record_id = '0262100000000000000000000000c406';
select throws_ok($$ select public.claim_outbox_for_commit((select id from external_command_outbox where pmo_record_id = '0262100000000000000000000000c406')) $$,
  'BW001', 'a sales invoice command must name its invoice by its canonical id',
  'AC-BWO-002 the revival runs the same check, so a non-canonical id is refused there too');                          -- 14

-- ── §D a negative amount is refused (claims are never negative; a down payment bills 0) ──────────────────
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-00000000c501', 'bwo-h-k51', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d5","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":-100}]}') $$,
  'BW001', 'an invoice cannot bill a negative amount against work order WO-H-5',
  'AC-BWO-002 an ERP command whose lines total below zero is refused');                                               -- 15
set local role authenticated;
set local request.jwt.claims = '{"sub":"02621000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02621000-0000-0000-0000-0000000005d1', '02621000-0000-0000-0000-0000000000c1', '02621000-0000-0000-0000-0000000000d5', -50, 'exclusive', 0, 'USD') $$,
  'BW001', 'an invoice cannot bill a negative amount against work order WO-H-5',
  'AC-BWO-002 a native negative invoice is refused');                                                                  -- 16
select lives_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02621000-0000-0000-0000-0000000005d2', '02621000-0000-0000-0000-0000000000c1', '02621000-0000-0000-0000-0000000000d5', 100, 'exclusive', 0, 'USD') $$,
  'AC-BWO-002 a native 100 is accepted');                                                                              -- 17
reset role;
select throws_ok($$ update sales_invoices set amount = -100 where id = '02621000-0000-0000-0000-0000000005d2' $$,
  'BW001', 'an invoice cannot bill a negative amount against work order WO-H-5',
  'AC-BWO-002 reducing an invoice below zero is refused, not waved through as a reduction');                           -- 18

-- ── §E an invoice cannot take a claim's id; another org's claim id does not exempt a command ─────────────
set local role authenticated;
select throws_ok($$ insert into sales_invoices (id, project_id, amount, tax_treatment, tax_amount, currency)
  values ('02621000-0000-0000-0000-0000000003e2', '02621000-0000-0000-0000-0000000000c1', 10, 'exclusive', 0, 'USD') $$,
  'BW001', 'this id belongs to a progress claim: its invoice is raised from the claim',
  'AC-BWO-002 a native invoice under a claim''s id is refused');                                                      -- 19
select throws_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02621000-0000-0000-0000-0000000003e9', '02621000-0000-0000-0000-0000000000c1', '02621000-0000-0000-0000-0000000000d5', 10, 'exclusive', 0, 'USD') $$,
  'BW001', 'this id belongs to a progress claim: its invoice is raised from the claim',
  'AC-BWO-002 …and so is one naming a work order under the id of a claim that names none');                        -- 19b
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
-- In flight on WO-H-6: 600 under an id that another org later uses for a claim. It still counts here.
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-00000000c601', 'bwo-h-k61', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d6","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":600}]}');
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, dp_recovery_amount, created_by) values
  ('02621000-0000-0000-0000-00000000c601', '02621000-0000-0000-0000-000000000002', '02621000-0000-0000-0000-0000000000c9', 'progress', 'USD', 1, 0, '02621000-0000-0000-0000-0000000000b1');
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-00000000c602', 'bwo-h-k62', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d6","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":600}]}') $$,
  'BW001', 'this invoice would bill 600.00 against work order WO-H-6 (worth 1000.00 excl. tax, with 600.00 already invoiced or in draft): only 400.00 is still to invoice',
  'AC-BWO-002 a command in flight still counts when another org holds a claim under its id');                          -- 20
-- Failed on WO-H-7, with the remainder then reserved; another org then holds a claim under the failed command's id.
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-00000000c701', 'bwo-h-k71', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d7","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":600}]}');
update external_command_outbox set state = 'failed' where pmo_record_id = '02621000-0000-0000-0000-00000000c701';
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02621000-0000-0000-0000-000000000001', 'revenue', '02621000-0000-0000-0000-00000000c702', 'bwo-h-k72', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true,"workOrderId":"02621000-0000-0000-0000-0000000000d7","projectId":"02621000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":1000}]}');
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, dp_recovery_amount, created_by) values
  ('02621000-0000-0000-0000-00000000c701', '02621000-0000-0000-0000-000000000002', '02621000-0000-0000-0000-0000000000c9', 'progress', 'USD', 1, 0, '02621000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.claim_outbox_for_commit((select id from external_command_outbox where pmo_record_id = '02621000-0000-0000-0000-00000000c701')) $$,
  'BW001', 'this invoice would bill 600.00 against work order WO-H-7 (worth 1000.00 excl. tax, with 1000.00 already invoiced or in draft): only 0.00 is still to invoice',
  'AC-BWO-002 another org''s claim under the same id does not exempt a command from its own work order');            -- 21

-- ── §F grants ───────────────────────────────────────────────────────────────────────────────────────────
reset request.jwt.claims;
select ok(not has_function_privilege('anon', 'public.claim_outbox_for_commit(uuid,interval)', 'execute')
          and not has_function_privilege('authenticated', 'public.claim_outbox_for_commit(uuid,interval)', 'execute')
          and has_function_privilege('service_role', 'public.claim_outbox_for_commit(uuid,interval)', 'execute'),
  'AC-BWO-002 the claim stays service-role only');                                                                     -- 22
select ok(not has_function_privilege('anon', 'public.assert_invoice_command_within_work_order(uuid,text,text,jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.assert_invoice_command_within_work_order(uuid,text,text,jsonb)', 'execute'),
  'AC-BWO-002 the shared command check is not client-executable');                                                    -- 23
select is((select p.prosecdef from pg_proc p where p.oid = 'public.claim_outbox_for_commit(uuid,interval)'::regprocedure)
          and (select p.proconfig from pg_proc p where p.oid = 'public.claim_outbox_for_commit(uuid,interval)'::regprocedure) = array['search_path=public'],
  true, 'AC-BWO-002 the claim keeps SECURITY DEFINER and its pinned search_path');                                     -- 24

select * from finish();
rollback;
