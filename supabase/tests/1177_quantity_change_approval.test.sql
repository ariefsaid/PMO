-- 1177_quantity_change_approval.test.sql — #2578 internal approval (server-enforced separation of duties), the client record and the decision.
-- AC-QCR-011, 012, 013, 014, 015, 016, 017, 018, 030, 024. Spec docs/specs/quantity-change-requests.spec.md (FR-QCR-010..016, 019).
-- Hand calculation: C 1000 (v1), R 1100: version 2 = 1100, allocation 600 -> 700, value change (1100-1000) x 50000 = 5,000,000.00.
begin;
create extension if not exists pgtap;
select plan(68);

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
-- f4 (C 200, rate 100) is allocated to e1 and over by assessment; f5 (C 100, rate 100) is over by assessment and sits on the DRAFT work order e2
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000e1', '25780000-0000-0000-0000-0000000000f4', 100);
insert into project_progress_entries (id, org_id, project_id, month, pct_complete) values
  ('25780000-0000-0000-0000-000000000d01', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', '2026-02-01', 50);
insert into progress_assessment_quantities (org_id, entry_id, boq_item_id, quantity_to_date) values
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-000000000d01', '25780000-0000-0000-0000-0000000000f1', 1040),
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-000000000d01', '25780000-0000-0000-0000-0000000000f4', 250),
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-000000000d01', '25780000-0000-0000-0000-0000000000f5', 120);
insert into quantity_forecasts (org_id, boq_item_id, quantity) values
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000f3', 600);
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
insert into ids select 'r1', qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","requested_quantity":1100,"reason":"Rock found below the design level"}]'::jsonb);

-- ── AC-QCR-011 the editor SET, not the last editor ──────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($$select qcr_update_draft((select v from ids where k = 'r1'), null, 'Finance reviewed')$$, 'Finance edits the draft (joins the editor set)');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok($$select qcr_update_draft((select v from ids where k = 'r1'), null, 'Executive reviewed')$$, 'the Executive edits last (now the last editor)');
select lives_ok($$select qcr_submit((select v from ids where k = 'r1'))$$, 'the last editor submits');
select is((select cardinality(editor_ids) from quantity_change_requests where id = (select v from ids where k = 'r1')), 3, 'the editor set holds all three people');

select throws_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, '42501',
  'QCR_SOD_AUTHOR: separation of duties: the person who raised, edited or submitted a request cannot approve it; ask another reviewer', 'AC-QCR-011 the submitter and last editor cannot approve');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, '42501', 'QCR_NOT_APPROVER: your role cannot approve or return quantity change requests; ask an approver, or an Admin to add your role to the reviewer list',
  'AC-QCR-011 the author (a Project Manager) holds no approve role at all');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, '42501',
  'QCR_SOD_AUTHOR: separation of duties: the person who raised, edited or submitted a request cannot approve it; ask another reviewer', 'AC-QCR-011 an EARLIER editor, replaced as last editor, still cannot approve');
select throws_ok($$select qcr_return((select v from ids where k = 'r1'), 'no')$$, '42501',
  'QCR_SOD_AUTHOR: separation of duties: the person who raised, edited or submitted a request cannot approve it; ask another reviewer', 'AC-QCR-011 an editor cannot return it either');
select is((select can_approve || ':' || reason from qcr_approval_state((select v from ids where k = 'r1'))), 'false:editor',
  'AC-QCR-027 the server tells the screen why an editor cannot approve');
-- ── AC-QCR-012 roles and tenancy ────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select throws_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, '42501', 'QCR_NOT_APPROVER: your role cannot approve or return quantity change requests; ask an approver, or an Admin to add your role to the reviewer list',
  'AC-QCR-012 a role without the approve permission is refused');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b7","role":"authenticated"}';
select throws_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, 'P0002', 'request not found',
  'AC-QCR-012 a user of another organisation cannot approve');
select is((select count(*)::int from quantity_change_requests), 0, 'AC-QCR-012 nor read it');
-- ── AC-QCR-014 return needs a reason ────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($$select qcr_return((select v from ids where k = 'r1'), '')$$, '23502', 'a reason is required to return a request (up to 500 characters)',
  'AC-QCR-014 returning without a reason is refused');
select lives_ok($$select qcr_return((select v from ids where k = 'r1'), 'Please justify the quantity')$$, 'AC-QCR-014 with a reason it is returned');
select is((select status || ':' || return_reason from quantity_change_requests where id = (select v from ids where k = 'r1')), 'returned:Please justify the quantity',
  'AC-QCR-014 the request is returned and the reason is kept');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select qcr_update_draft((select v from ids where k = 'r1'), null, 'Justified: rock')$$, 'AC-QCR-014 the author edits the returned request');
select is((select status from quantity_change_requests where id = (select v from ids where k = 'r1')), 'draft', 'a returned request reopens as a draft');
select lives_ok($$select qcr_submit((select v from ids where k = 'r1'))$$, 'the author resubmits');
-- the person who returned it (Finance 2) did not edit it: they may approve, and a different approver can too
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select is((select can_approve::text || ':' || eligible_approver_exists::text from qcr_approval_state((select v from ids where k = 'r1'))), 'true:true',
  'AC-QCR-011 an Admin outside the editor set may approve');
select lives_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, 'AC-QCR-011 a different user with the approve role approves');
select is((select status || ':' || approved_by from quantity_change_requests where id = (select v from ids where k = 'r1')),
  'approved:25780000-0000-0000-0000-0000000000b4', 'AC-QCR-011 the request is approved and names its approver');
select throws_ok($$select qcr_approve((select v from ids where k = 'r1'))$$, 'P0001', 'only a request pending approval can be approved; this one is approved',
  'a request cannot be approved twice');
select throws_ok($$select qcr_update_draft((select v from ids where k = 'r1'), null, 'x')$$, 'P0001', 'a approved request can no longer be edited', 'an approved request cannot be edited');

-- ── AC-QCR-013 no sole-user exception ───────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b4","role":"authenticated"}';
insert into ids select 'r2', qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f3","requested_quantity":650,"reason":"Added length"}]'::jsonb);
select lives_ok($$select qcr_submit((select v from ids where k = 'r2'))$$, 'the Admin authors and submits r2');
reset role;
update profiles set status = 'disabled' where id in ('25780000-0000-0000-0000-0000000000b2', '25780000-0000-0000-0000-0000000000b3', '25780000-0000-0000-0000-0000000000b5');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($$select qcr_approve((select v from ids where k = 'r2'))$$, '42501', 'QCR_SOD_AUTHOR: separation of duties: the person who raised, edited or submitted a request cannot approve it; ask another reviewer',
  'AC-QCR-013 the sole eligible user, who is also the author, cannot approve');
select is((select status from quantity_change_requests where id = (select v from ids where k = 'r2')), 'pending_approval', 'AC-QCR-013 the request stays pending approval');
select is((select eligible_approver_exists from qcr_approval_state((select v from ids where k = 'r2'))), false,
  'AC-QCR-013 the queue can say that nobody is eligible');
reset role;
update profiles set status = 'active' where id in ('25780000-0000-0000-0000-0000000000b2', '25780000-0000-0000-0000-0000000000b3', '25780000-0000-0000-0000-0000000000b5');
set local role authenticated;

-- the submitter is always inside the editor set through the functions; the rule still names the submitter, so prove it by
-- recording a submitter outside the set (as the table owner) and showing that person is refused
reset role;
update quantity_change_requests set submitted_by = '25780000-0000-0000-0000-0000000000b5' where id = (select v from ids where k = 'r2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($$select qcr_approve((select v from ids where k = 'r2'))$$, '42501', 'QCR_SOD_AUTHOR: separation of duties: the person who raised, edited or submitted a request cannot approve it; ask another reviewer',
  'AC-QCR-011 whoever submitted the request cannot approve it');

-- ── AC-QCR-015 the client record ────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select qcr_record_sent((select v from ids where k = 'r2'), current_date, 'REF-2')$$, 'P0001',
  'only an approved request can be marked as sent; this one is pending_approval', 'AC-QCR-015 a request that is not approved cannot be marked sent');
select throws_ok($$select qcr_record_sent((select v from ids where k = 'r1'), current_date, 'REF-1')$$, '23514',
  'attach the letter or form that was sent to the client', 'AC-QCR-015 an approved request without the attachment is refused');
reset role;
insert into storage.objects (bucket_id, name, owner_id) values
  ('quantity-change-files', '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r1') || '/25780000-0000-0000-0000-000000000f11/letter.pdf', '25780000-0000-0000-0000-0000000000b1'),
  ('quantity-change-files', '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r1') || '/25780000-0000-0000-0000-000000000f12/acceptance.pdf', '25780000-0000-0000-0000-0000000000b1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(format($$insert into quantity_change_request_files (id, request_id, kind, title, file_path) values
  ('25780000-0000-0000-0000-000000000f11', %L, 'sent_letter', 'Letter', %L)$$, (select v from ids where k = 'r1'),
  '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r1') || '/25780000-0000-0000-0000-000000000f11/letter.pdf'), 'the sent letter is filed');
select throws_ok($$select qcr_record_sent((select v from ids where k = 'r1'), current_date, '  ')$$, '23502', 'the client reference is required (up to 200 characters)',
  'AC-QCR-015 without the client reference it is refused');
select throws_ok($$select qcr_record_sent((select v from ids where k = 'r1'), current_date + 3, 'REF-1')$$, '23514', 'the sent date is required and cannot be in the future',
  'NFR-QCR-004 a sent date in the organisation-local future is refused');
select lives_ok($$select qcr_record_sent((select v from ids where k = 'r1'), current_date, 'REF-1')$$, 'AC-QCR-015 with both it is recorded as sent');
select is((select status || ':' || client_reference from quantity_change_requests where id = (select v from ids where k = 'r1')), 'sent_to_client:REF-1', 'AC-QCR-015 the request is sent to the client');
select throws_ok($$select qcr_withdraw((select v from ids where k = 'r1'), 'too late')$$, 'P0001', 'a sent_to_client request cannot be withdrawn', 'a sent request cannot be withdrawn');
select throws_ok($$update quantity_change_request_files set archived_at = now() where id = '25780000-0000-0000-0000-000000000f11'$$, '42501',
  'this file belongs to a step that is already recorded', 'the sent letter cannot be archived once the send is recorded');

-- ── AC-QCR-016 accepted: one transaction, version + quantity + allocation + history ─────────────────
select throws_ok($$select qcr_record_decision((select v from ids where k = 'r1'), 'accepted', current_date, 'ok')$$, '23514', 'attach the client''s acceptance',
  'AC-QCR-016 acceptance without the client''s attachment is refused');
select lives_ok(format($$insert into quantity_change_request_files (id, request_id, kind, title, file_path) values
  ('25780000-0000-0000-0000-000000000f12', %L, 'client_response', 'Client acceptance', %L)$$, (select v from ids where k = 'r1'),
  '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r1') || '/25780000-0000-0000-0000-000000000f12/acceptance.pdf'), 'the acceptance is filed');
select throws_ok($$select qcr_record_decision((select v from ids where k = 'r1'), 'accepted', current_date - 2, 'ok')$$, '23514',
  'the decision date is required, cannot be in the future and cannot precede the sent date', 'a decision date before the sent date is refused');
select lives_ok($$select qcr_record_decision((select v from ids where k = 'r1'), 'accepted', current_date, 'Client agreed 1100')$$, 'AC-QCR-016 the client acceptance is recorded');
select is((select quantity from boq_items where id = '25780000-0000-0000-0000-0000000000f1'), 1100.000::numeric, 'AC-QCR-016 the contract quantity is 1,100.000');
select is((select version_no || ':' || quantity || ':' || source from boq_quantity_versions where boq_item_id = '25780000-0000-0000-0000-0000000000f1' and version_no = 2),
  '2:1100.000:change_request', 'AC-QCR-016 version 2 = 1,100.000 from the change request');
select is((select request_id from boq_quantity_versions where boq_item_id = '25780000-0000-0000-0000-0000000000f1' and version_no = 2), (select v from ids where k = 'r1'),
  'AC-QCR-016 the version names its request');
select is((select quantity from work_order_lines where id = '25780000-0000-0000-0000-000000000011'), 700.000::numeric, 'AC-QCR-016 the allocation rose from 600 to 700');
select is((select order_value from work_orders where id = '25780000-0000-0000-0000-0000000000e1'), 100000.00::numeric,
  'AC-QCR-030 an Issued work order''s value is frozen: it is unchanged although the allocation rose');
select is((select action || ':' || actor_id from quantity_change_request_events where request_id = (select v from ids where k = 'r1') and action = 'client_accepted'),
  'client_accepted:25780000-0000-0000-0000-0000000000b1', 'AC-QCR-016 a history row names the actor');
select is((select string_agg(action, ',' order by created_at, id) from quantity_change_request_events where request_id = (select v from ids where k = 'r1')),
  'raised,edited,edited,submitted,returned,edited,submitted,approved,sent_to_client,client_accepted', 'every transition is in the history');
select is((select count(*)::int from quantity_change_request_lines where request_id = (select v from ids where k = 'r1') and is_open), 0, 'the contract line is free for a later request');
reset role;
select is((select count(*)::int from quantity_overrun_notices where boq_item_id = '25780000-0000-0000-0000-0000000000f1' and kind = 'progress'), 0,
  'the told-once row clears once the new contract quantity covers progress (1,040 < 1,100)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$update boq_items set quantity = 1500 where id = '25780000-0000-0000-0000-0000000000f1'$$, '42501', null,
  'AC-QCR-019 after acceptance the quantity still changes only through a request');

-- ── AC-QCR-017 declined changes nothing; AC-QCR-018 stale base ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
insert into ids select 'r3', qcr_raise('25780000-0000-0000-0000-0000000000e1', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f4","requested_quantity":260,"reason":"Extra road"}]'::jsonb);
select lives_ok($$select qcr_submit((select v from ids where k = 'r3'))$$, 'r3 is submitted');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($$select qcr_approve((select v from ids where k = 'r3'))$$, 'r3 is approved by Finance');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
reset role;
insert into storage.objects (bucket_id, name, owner_id) values
  ('quantity-change-files', '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r3') || '/25780000-0000-0000-0000-000000000f21/letter.pdf', '25780000-0000-0000-0000-0000000000b1');
insert into quantity_change_request_files (id, org_id, request_id, kind, file_path)
  values ('25780000-0000-0000-0000-000000000f21', '25780000-0000-0000-0000-0000000000a1', (select v from ids where k = 'r3'), 'sent_letter',
          '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r3') || '/25780000-0000-0000-0000-000000000f21/letter.pdf');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select qcr_record_sent((select v from ids where k = 'r3'), current_date, 'REF-3')$$, 'r3 is sent');
-- the contract line moves under the request (a different version appears): as the table owner, the way the accepting function would
reset role;
select set_config('pmo.qcr_amend_quantity', 'on', true);
update boq_items set quantity = 210 where id = '25780000-0000-0000-0000-0000000000f4';
select set_config('pmo.qcr_amend_quantity', '', true);
insert into boq_quantity_versions (org_id, boq_item_id, version_no, quantity, source) values
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000f4', 2, 210, 'setup_edit');
insert into storage.objects (bucket_id, name, owner_id) values
  ('quantity-change-files', '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r3') || '/25780000-0000-0000-0000-000000000f22/acceptance.pdf', '25780000-0000-0000-0000-0000000000b1');
insert into quantity_change_request_files (id, org_id, request_id, kind, file_path)
  values ('25780000-0000-0000-0000-000000000f22', '25780000-0000-0000-0000-0000000000a1', (select v from ids where k = 'r3'), 'client_response',
          '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r3') || '/25780000-0000-0000-0000-000000000f22/acceptance.pdf');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select qcr_record_decision((select v from ids where k = 'r3'), 'accepted', current_date, 'ok')$$, 'P0001',
  'stale base: the contract quantity of this line changed after the request was raised (now 210.000, was 200.000); record the request as declined and raise a new one',
  'AC-QCR-018 a decision against a moved contract quantity is refused as stale');
select is((select status from quantity_change_requests where id = (select v from ids where k = 'r3')), 'sent_to_client', 'AC-QCR-018 the refused decision left the request as it was');
select lives_ok($$select qcr_record_decision((select v from ids where k = 'r3'), 'declined', current_date, 'Client declined')$$, 'AC-QCR-017 the client decline is recorded');
select is((select status from quantity_change_requests where id = (select v from ids where k = 'r3')), 'client_declined', 'AC-QCR-017 the request is declined');
select is((select quantity from boq_items where id = '25780000-0000-0000-0000-0000000000f4'), 210.000::numeric, 'AC-QCR-017 declining changes no quantity');
select is((select count(*)::int from boq_quantity_versions where boq_item_id = '25780000-0000-0000-0000-0000000000f4' and source = 'change_request'), 0, 'AC-QCR-017 declining adds no version');
select is((select quantity from work_order_lines where work_order_id = '25780000-0000-0000-0000-0000000000e1' and boq_item_id = '25780000-0000-0000-0000-0000000000f4'), 100.000::numeric,
  'AC-QCR-017 declining changes no allocation');

-- ── AC-QCR-030 a Draft work order's value rises with the accepted quantity ───────────────────────────
insert into ids select 'r4', qcr_raise('25780000-0000-0000-0000-0000000000e2', null,
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f5","requested_quantity":200,"reason":"Longer wall"}]'::jsonb);
select lives_ok($$select qcr_submit((select v from ids where k = 'r4'))$$, 'r4 (on the Draft work order) is submitted');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok($$select qcr_approve((select v from ids where k = 'r4'))$$, 'r4 is approved by the Executive');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
reset role;
insert into storage.objects (bucket_id, name, owner_id) values
  ('quantity-change-files', '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r4') || '/25780000-0000-0000-0000-000000000f31/letter.pdf', '25780000-0000-0000-0000-0000000000b1');
insert into quantity_change_request_files (id, org_id, request_id, kind, file_path)
  values ('25780000-0000-0000-0000-000000000f31', '25780000-0000-0000-0000-0000000000a1', (select v from ids where k = 'r4'), 'sent_letter',
          '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r4') || '/25780000-0000-0000-0000-000000000f31/letter.pdf');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select qcr_record_sent((select v from ids where k = 'r4'), current_date, 'REF-4')$$, 'r4 is sent');
reset role;
insert into storage.objects (bucket_id, name, owner_id) values
  ('quantity-change-files', '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r4') || '/25780000-0000-0000-0000-000000000f32/acceptance.pdf', '25780000-0000-0000-0000-0000000000b1');
insert into quantity_change_request_files (id, org_id, request_id, kind, file_path)
  values ('25780000-0000-0000-0000-000000000f32', '25780000-0000-0000-0000-0000000000a1', (select v from ids where k = 'r4'), 'client_response',
          '25780000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'r4') || '/25780000-0000-0000-0000-000000000f32/acceptance.pdf');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select qcr_record_decision((select v from ids where k = 'r4'), 'accepted', current_date, 'ok')$$, 'r4 is accepted by the client');
select is((select order_value from work_orders where id = '25780000-0000-0000-0000-0000000000e2'), 110000.00::numeric,
  'AC-QCR-030 a Draft work order''s value rises by delta x rate (100 x 100 = 10,000): 100,000 to 110,000');
select is((select quantity from work_order_lines where work_order_id = '25780000-0000-0000-0000-0000000000e2'), 200.000::numeric, 'AC-QCR-030 and its allocation rises 100 to 200');
select ok(pg_get_functiondef('public.qcr_record_decision(uuid,text,date,text)'::regprocedure) like '%set_work_order_value(v_req.work_order_id, v_gross, v_wo.tax_treatment, v_tax,%',
  'AC-QCR-030 set_work_order_value passes the calculated v_tax rather than the stale pre-change tax amount');

select * from finish();
rollback;
