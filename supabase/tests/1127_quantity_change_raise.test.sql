-- 1127_quantity_change_raise.test.sql — #2578 raising, the request limit, withdrawal, editing and the files.
-- AC-QCR-004, 005, 006, 008, 009, 010, 022, 024, 029. Spec docs/specs/quantity-change-requests.spec.md (FR-QCR-004..010, 021, 023).
-- Hand calculation: C 1000, assessed 1040 (progress), forecast 1100, R 1100.
begin;
create extension if not exists pgtap;
select plan(55);

-- ── fixtures (as the table owner) ───────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency, default_timezone) values
  ('25780000-0000-0000-0000-0000000000a1', 'QCR Org A', 'USD', 'UTC'),
  ('25780000-0000-0000-0000-0000000000a2', 'QCR Org B', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('25780000-0000-0000-0000-0000000000b1', 'qcr-pm@example.com'),
  ('25780000-0000-0000-0000-0000000000b2', 'qcr-fin@example.com'),
  ('25780000-0000-0000-0000-0000000000b3', 'qcr-exec@example.com'),
  ('25780000-0000-0000-0000-0000000000b4', 'qcr-admin@example.com'),
  ('25780000-0000-0000-0000-0000000000b5', 'qcr-fin2@example.com'),
  ('25780000-0000-0000-0000-0000000000b6', 'qcr-eng@example.com'),
  ('25780000-0000-0000-0000-0000000000b7', 'qcr-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25780000-0000-0000-0000-0000000000b1', '25780000-0000-0000-0000-0000000000a1', 'QCR PM', 'qcr-pm@example.com', 'Project Manager', 'active'),
  ('25780000-0000-0000-0000-0000000000b2', '25780000-0000-0000-0000-0000000000a1', 'QCR Finance', 'qcr-fin@example.com', 'Finance', 'active'),
  ('25780000-0000-0000-0000-0000000000b3', '25780000-0000-0000-0000-0000000000a1', 'QCR Exec', 'qcr-exec@example.com', 'Executive', 'active'),
  ('25780000-0000-0000-0000-0000000000b4', '25780000-0000-0000-0000-0000000000a1', 'QCR Admin', 'qcr-admin@example.com', 'Admin', 'active'),
  ('25780000-0000-0000-0000-0000000000b5', '25780000-0000-0000-0000-0000000000a1', 'QCR Finance Two', 'qcr-fin2@example.com', 'Finance', 'active'),
  ('25780000-0000-0000-0000-0000000000b6', '25780000-0000-0000-0000-0000000000a1', 'QCR Engineer', 'qcr-eng@example.com', 'Engineer', 'active'),
  ('25780000-0000-0000-0000-0000000000b7', '25780000-0000-0000-0000-0000000000a2', 'QCR Foreign', 'qcr-foreign@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('25780000-0000-0000-0000-0000000000c1', '25780000-0000-0000-0000-0000000000a1', 'QCR Contract', 'Ongoing Project', 'USD', '25780000-0000-0000-0000-0000000000b1');
-- e1 Issued (the request is raised from it); e2 Draft (its value can still rise); e3 Closed
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25780000-0000-0000-0000-0000000000e1', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', 'WO issued', 'Issued', 100000, 'exclusive', 0),
  ('25780000-0000-0000-0000-0000000000e2', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', 'WO draft', 'Draft', 100000, 'exclusive', 0),
  ('25780000-0000-0000-0000-0000000000e3', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', 'WO closed', 'Closed', 100000, 'exclusive', 0);
-- f1 Excavation (hand calculation: C 1000, rate 50000); f2 lump sum; f3 not over; f4 over but on no work order; f5 on the Draft WO
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, earning_basis) values
  ('25780000-0000-0000-0000-0000000000f1', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', 'EXC', 'Excavation', 'm3', 1000, 50000, 'unit_rate'),
  ('25780000-0000-0000-0000-0000000000f2', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', 'LUMP', 'Mobilisation', 'ls', 1, 9000, 'lump_sum'),
  ('25780000-0000-0000-0000-0000000000f3', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', 'PIPE', 'Pipe', 'm', 500, 100, 'unit_rate'),
  ('25780000-0000-0000-0000-0000000000f4', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', 'ROAD', 'Road', 'm', 200, 100, 'unit_rate'),
  ('25780000-0000-0000-0000-0000000000f5', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', 'WALL', 'Wall', 'm2', 100, 100, 'unit_rate');
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('25780000-0000-0000-0000-000000000011', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000e1', '25780000-0000-0000-0000-0000000000f1', 600),
  ('25780000-0000-0000-0000-000000000012', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000e1', '25780000-0000-0000-0000-0000000000f2', 1),
  ('25780000-0000-0000-0000-000000000013', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000e1', '25780000-0000-0000-0000-0000000000f3', 400),
  ('25780000-0000-0000-0000-000000000015', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000e2', '25780000-0000-0000-0000-0000000000f5', 100);
-- f6 is allocated and NOT over; f4 is allocated to e1 and over by assessment (250 > 200); f3 is over by forecast (600 > 500)
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, earning_basis) values
  ('25780000-0000-0000-0000-0000000000f6', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', 'DUCT', 'Duct', 'm', 300, 10, 'unit_rate');
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000e1', '25780000-0000-0000-0000-0000000000f4', 100),
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000e1', '25780000-0000-0000-0000-0000000000f6', 50);
insert into project_progress_entries (id, org_id, project_id, month, pct_complete) values
  ('25780000-0000-0000-0000-000000000d01', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', '2026-02-01', 50);
insert into progress_assessment_quantities (org_id, entry_id, boq_item_id, quantity_to_date) values
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-000000000d01', '25780000-0000-0000-0000-0000000000f1', 1040),
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-000000000d01', '25780000-0000-0000-0000-0000000000f4', 250);
insert into quantity_forecasts (org_id, boq_item_id, quantity) values
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000f3', 600),
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000f1', 1100);
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- ── AC-QCR-005 / 029: refusals, each with its own reason ────────────────────────────────────────────
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","requested_quantity":1000,"reason":"more"}]'::jsonb)$$, '23514',
  'the requested quantity for EXC (1000) must be above the contract quantity (1000.000)', 'AC-QCR-005 R equal to C is refused');
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","requested_quantity":1030,"reason":"more"}]'::jsonb)$$, '23514',
  'the requested quantity for EXC (1030) cannot be below the progress figure (1040.000)', 'AC-QCR-005 R below the trigger figure is refused');
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","requested_quantity":1100.0001,"reason":"more"}]'::jsonb)$$, '23514',
  'the requested quantity for EXC must be positive with at most 3 decimals', 'AC-QCR-005 more than 3 decimals is refused');
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f6","requested_quantity":400,"reason":"more"}]'::jsonb)$$, '23514',
  'DUCT is not over its contract quantity, so it cannot be raised', 'AC-QCR-005 an item that is not over-contract is refused');
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f5","requested_quantity":400,"reason":"more"}]'::jsonb)$$, '23514',
  'WALL is not allocated to this work order', 'AC-QCR-005 an item that is not on the work order is refused');
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f2","requested_quantity":2,"reason":"more"}]'::jsonb)$$, '23514',
  'LUMP is a lump-sum line: its quantity is fixed at one, so a value change is not a quantity change', 'AC-QCR-029 a lump-sum line is refused with the lump-sum rule');
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null, '[]'::jsonb)$$, '23502',
  'a change request needs at least one line', 'AC-QCR-005 a request with no lines is refused');
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e3', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","requested_quantity":1100,"reason":"more"}]'::jsonb)$$, 'P0001',
  'a Closed work order cannot take a quantity change request', 'AC-QCR-010 a Closed work order takes no request');
select is((select count(*)::int from quantity_change_requests), 0, 'AC-QCR-005 no refused request left a row');

-- ── AC-QCR-004 raise, AC-QCR-009 idempotent ─────────────────────────────────────────────────────────
insert into ids select 'r1', qcr_raise('25780000-0000-0000-0000-0000000000e1', '25780000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","requested_quantity":1100,"reason":"Rock found below the design level"}]'::jsonb, 'First request');
select is((select status from quantity_change_requests where id = (select v from ids where k = 'r1')), 'draft', 'AC-QCR-004 the request is a draft');
select is((select trigger_kind || ':' || trigger_figure || ':' || base_quantity || ':' || base_version_no || ':' || requested_quantity from quantity_change_request_lines
            where request_id = (select v from ids where k = 'r1')), 'progress:1040.000:1000.000:1:1100.000',
  'AC-QCR-004 the line stores the trigger snapshot (progress, 1,040, C 1,000, version 1) and R 1,100');
select is((select author_id from quantity_change_requests where id = (select v from ids where k = 'r1')), '25780000-0000-0000-0000-0000000000b1'::uuid,
  'AC-QCR-004 the author is the caller, never a client-supplied value');
select is((select editor_ids from quantity_change_requests where id = (select v from ids where k = 'r1')), array['25780000-0000-0000-0000-0000000000b1']::uuid[],
  'AC-QCR-011 the author starts the editor set');
select is((select org_id from quantity_change_requests where id = (select v from ids where k = 'r1')), '25780000-0000-0000-0000-0000000000a1'::uuid,
  'AC-QCR-024 the organisation is stamped by the server');
select is(qcr_raise('25780000-0000-0000-0000-0000000000e1', '25780000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","requested_quantity":1100,"reason":"retry"}]'::jsonb), (select v from ids where k = 'r1'),
  'AC-QCR-009 the same client_request_id returns the same request');
select is((select count(*)::int from quantity_change_requests), 1, 'AC-QCR-009 a retry creates no second request');
select is((select request_count from qcr_work_order_budget('25780000-0000-0000-0000-0000000000e1')), 1, 'AC-QCR-009 the count rises by one, not two');
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","requested_quantity":1200,"reason":"again"}]'::jsonb)$$, '23505',
  'EXC already has an open quantity change request', 'AC-QCR-010 a contract line with an open request takes no second one');

-- ── AC-QCR-006 the limit (Admin sets it; AC-QCR-022) ────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
update organizations set quantity_change_limit = 3 where id = '25780000-0000-0000-0000-0000000000a1';
reset role;
select is((select quantity_change_limit from organizations where id = '25780000-0000-0000-0000-0000000000a1'), null::int,
  'AC-QCR-022 a non-Admin changing the limit changes nothing');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b4","role":"authenticated"}';
update organizations set quantity_change_limit = 2 where id = '25780000-0000-0000-0000-0000000000a1';
select is((select quantity_change_limit from organizations where id = '25780000-0000-0000-0000-0000000000a1'), 2, 'AC-QCR-022 the Admin sets the limit');
select is((select request_limit from qcr_work_order_budget('25780000-0000-0000-0000-0000000000e1')), 2, 'AC-QCR-021 the limit is shown beside the count');
reset role;
select is((select detail::text from audit_events where action = 'org.quantity_change_limit.change' and entity_id = '25780000-0000-0000-0000-0000000000a1'),
  '{"to": 2, "from": null}', 'AC-QCR-022 the audit row holds the before and after');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
insert into ids select 'r2', qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f3","requested_quantity":650,"reason":"Added length"}]'::jsonb);
select is((select trigger_kind from quantity_change_request_lines where request_id = (select v from ids where k = 'r2')), 'forecast',
  'AC-QCR-004 an item over by forecast alone is raised with trigger kind forecast');
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f4","requested_quantity":260,"reason":"more"}]'::jsonb)$$, 'P0001',
  'this work order already has 2 quantity change requests; the limit is 2', 'AC-QCR-006 with two requests and a limit of two, a third is refused naming both');
select is((select count(*)::int from quantity_change_requests), 2, 'AC-QCR-006 the refused request left no row');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b4","role":"authenticated"}';
update organizations set quantity_change_limit = null where id = '25780000-0000-0000-0000-0000000000a1';
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
insert into ids select 'r3', qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f4","requested_quantity":260,"reason":"Extra road"}]'::jsonb);
select ok((select v from ids where k = 'r3') is not null, 'AC-QCR-006 with no limit the third request is accepted');
select is((select request_count from qcr_work_order_budget('25780000-0000-0000-0000-0000000000e1')), 3, 'AC-QCR-006 the count reads three');

-- ── AC-QCR-008 what the limit counts ────────────────────────────────────────────────────────────────
select throws_ok(format($$select qcr_withdraw(%L, '  ')$$, (select v from ids where k = 'r3')), '23502',
  'a reason is required to withdraw a request (up to 500 characters)', 'AC-QCR-008 a withdrawal needs a reason');
select lives_ok(format($$select qcr_withdraw(%L, 'Raised in error')$$, (select v from ids where k = 'r3')), 'a draft is withdrawn before submission');
select is((select withdrawn_from from quantity_change_requests where id = (select v from ids where k = 'r3')), 'draft', 'AC-QCR-008 the status it was withdrawn from is stamped');
select is((select request_count from qcr_work_order_budget('25780000-0000-0000-0000-0000000000e1')), 2, 'AC-QCR-008 a draft withdrawn before submission is not counted');
select lives_ok($$select qcr_submit((select v from ids where k = 'r2'))$$, 'r2 is submitted');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok(format($$select qcr_return(%L, 'Check the length')$$, (select v from ids where k = 'r2')), 'r2 is returned');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(format($$select qcr_withdraw(%L, 'No longer needed')$$, (select v from ids where k = 'r2')), 'a returned request is withdrawn');
select is((select request_count from qcr_work_order_budget('25780000-0000-0000-0000-0000000000e1')), 2, 'AC-QCR-008 a request withdrawn after submission is still counted');
select lives_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f4","requested_quantity":270,"reason":"Extra road, again"}]'::jsonb)$$,
  'AC-QCR-010 a withdrawn request frees its contract line for a new one');

-- ── editing, the editor set and submission ──────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($$select qcr_update_draft((select v from ids where k = 'r1'),
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","requested_quantity":1120,"reason":"Rock found; quantity revised"}]'::jsonb, null)$$,
  'a second author-role user edits the draft');
select is((select editor_ids from quantity_change_requests where id = (select v from ids where k = 'r1')),
  array['25780000-0000-0000-0000-0000000000b1','25780000-0000-0000-0000-0000000000b2']::uuid[], 'AC-QCR-011 the editor joins the editor set');
select is((select requested_quantity from quantity_change_request_lines where request_id = (select v from ids where k = 'r1')), 1120.000::numeric,
  'the edited quantity is stored');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($$select qcr_submit((select v from ids where k = 'r1'))$$, '42501',
  'only the author or an editor of this request can submit it', 'a user outside the editor set cannot submit');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select qcr_submit((select v from ids where k = 'r1'))$$, 'AC-QCR-014 the author submits');
select is((select status from quantity_change_requests where id = (select v from ids where k = 'r1')), 'pending_approval', 'the request is pending approval');
select throws_ok($$select qcr_update_draft((select v from ids where k = 'r1'), null, 'x')$$, 'P0001',
  'a pending_approval request can no longer be edited', 'AC-QCR-014 a pending request cannot be edited');
select throws_ok($$update quantity_change_request_lines set requested_quantity = 5$$, '42501', null, 'AC-QCR-014 the line table takes no direct write');
select throws_ok($$update quantity_change_requests set status = 'approved'$$, '42501', null, 'AC-QCR-023 the request table takes no direct write');
select throws_ok($$insert into quantity_change_request_events (request_id, action) values ((select v from ids where k = 'r1'), 'x')$$, '42501', null,
  'AC-QCR-023 the history takes no direct write');

-- ── files: the procurement-file shape, typed by kind and by the step that is open ────────────────────
reset role;
insert into storage.objects (bucket_id, name, owner_id) values
  ('quantity-change-files', '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r1') || '/25780000-0000-0000-0000-000000000f01/support.pdf', '25780000-0000-0000-0000-0000000000b1'),
  ('quantity-change-files', '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r1') || '/25780000-0000-0000-0000-000000000f02/letter.pdf', '25780000-0000-0000-0000-0000000000b1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(format($$insert into quantity_change_request_files (id, request_id, kind, title, file_path) values
  ('25780000-0000-0000-0000-000000000f01', %L, 'supporting', 'Survey', %L)$$, (select v from ids where k = 'r1'),
  '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r1') || '/25780000-0000-0000-0000-000000000f01/support.pdf'),
  'a supporting file can be filed while the request is pending');
select throws_ok(format($$insert into quantity_change_request_files (id, request_id, kind, file_path) values ('25780000-0000-0000-0000-000000000f02', %L, 'sent_letter', %L)$$,
  (select v from ids where k = 'r1'), '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r1') || '/25780000-0000-0000-0000-000000000f02/letter.pdf'),
  '42501', null, 'a sent-letter file cannot be filed before the request is approved');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b7","role":"authenticated"}';
select is((select count(*)::int from quantity_change_request_files), 0, 'AC-QCR-024 another organisation reads no file row');

-- ── AC-QCR-024 tenancy and roles ────────────────────────────────────────────────────────────────────
select is((select count(*)::int from quantity_change_requests) + (select count(*)::int from quantity_change_request_lines)
          + (select count(*)::int from quantity_change_request_events) + (select count(*)::int from boq_quantity_versions)
          + (select count(*)::int from quantity_forecasts) + (select count(*)::int from quantity_overrun_notices), 0,
  'AC-QCR-024 another organisation reads no row of any new table');
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","requested_quantity":1300,"reason":"x"}]'::jsonb)$$, 'P0002', 'work order not found',
  'AC-QCR-024 another organisation cannot raise on this work order');
select throws_ok($$select * from qcr_over_contract('25780000-0000-0000-0000-0000000000c1')$$, 'P0002', 'project not found',
  'AC-QCR-024 another organisation cannot read the over-contract list');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","requested_quantity":1300,"reason":"x"}]'::jsonb)$$, '42501',
  'not authorized to raise a quantity change request', 'AC-QCR-022 an Engineer cannot raise a request');
select is((select count(*)::int from quantity_change_requests), 0, 'AC-QCR-022 an Engineer reads no request');
reset role;
set local role anon;
select throws_ok($$select qcr_raise('25780000-0000-0000-0000-0000000000e1', null, '[]'::jsonb)$$, '42501', null, 'AC-QCR-024 anon cannot execute the writer');

select * from finish();
rollback;
