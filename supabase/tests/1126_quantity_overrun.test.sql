-- 1126_quantity_overrun.test.sql — #2578 over-contract detection and the told-once notice. AC-QCR-001, 002, 003, 028, 029.
-- Spec docs/specs/quantity-change-requests.spec.md (FR-QCR-001..003). Hand calculation: C 1000, assessed 1040, accepted 980, claimed 900.
begin;
create extension if not exists pgtap;
select plan(30);

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
-- the hand calculation's progress sources for f1: assessed 1040, confirmed acceptance 980 (two work orders), claimed 900
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, status, prepared_by) values
  ('25780000-0000-0000-0000-000000000a01', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1',
   '25780000-0000-0000-0000-0000000000e1', '2026-01-10', 'Draft', '25780000-0000-0000-0000-0000000000b1');
insert into work_order_acceptance_lines values ('25780000-0000-0000-0000-000000000a01', '25780000-0000-0000-0000-0000000000f1', 580);
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, created_by) values
  ('25780000-0000-0000-0000-000000000c01', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1',
   '25780000-0000-0000-0000-0000000000e1', 'progress', 'USD', 1000, '25780000-0000-0000-0000-0000000000b2');
insert into progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit, quantity, rate, amount) values
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-000000000c01', '25780000-0000-0000-0000-0000000000f1',
   'EXC', 'Excavation', 'm3', 900, 50000, 45000000);
-- 980 confirmed on the work order (the spec's fixture figure): the confirmation is a write that can move P
update work_order_acceptance_lines set quantity = 980 where acceptance_id = '25780000-0000-0000-0000-000000000a01';
update work_order_acceptances set status = 'Confirmed', confirmed_by = '25780000-0000-0000-0000-0000000000b2', confirmed_at = now(), confirm_basis = 'standard'
 where id = '25780000-0000-0000-0000-000000000a01';
create temp table figs (k text primary key, v numeric) on commit drop;
grant all on figs to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';

-- ── AC-QCR-001: P is the greatest source and names it ──────────────────────────────────────────────
select is((select progress_quantity from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f1'),
  980.000::numeric, 'AC-QCR-001 with acceptance 980 and claim 900, P is 980 from the acceptance source');
select is((select progress_source from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f1'),
  'acceptance', 'AC-QCR-001 the source that set P is named');
select is((select over_progress from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f1'),
  false, 'AC-QCR-001 P below C is not over');

-- the PM-or-Finance assessment writer (shipped): quantities done to date 1040 for the line
select lives_ok($$select record_progress_assessment('25780000-0000-0000-0000-0000000000c1', '2026-02-01',
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","quantity_to_date":1040}]'::jsonb)$$, 'the assessment of 1040 is recorded');
select is((select progress_quantity from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f1'),
  1040.000::numeric, 'AC-QCR-001 P is 1040 from the assessment source');
select is((select progress_source from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f1'),
  'assessment', 'AC-QCR-001 the assessment is named as the source');
select is((select over_progress from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f1'),
  true, 'AC-QCR-001 the item is over by 40');
select is((select count(*)::int from qcr_over_contract('25780000-0000-0000-0000-0000000000c1', true)), 1, 'AC-QCR-001 the over-only filter lists exactly the over line');

-- ── AC-QCR-003: told once, cleared when back under, told again on the next crossing ───────────────
reset role;
select is((select count(*)::int from notifications where owner_id = '25780000-0000-0000-0000-0000000000b1' and title = 'Contract quantity exceeded'), 1,
  'AC-QCR-003 the project manager is notified once when the item first goes over');
select is((select count(*)::int from quantity_overrun_notices where boq_item_id = '25780000-0000-0000-0000-0000000000f1' and kind = 'progress'
            and figure = 1040 and contract_quantity = 1000), 1, 'AC-QCR-003 the told-once row holds the figure and C');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($$select record_progress_assessment('25780000-0000-0000-0000-0000000000c1', '2026-02-01',
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","quantity_to_date":1045}]'::jsonb)$$, 'the assessment is recorded again, still over');
reset role;
select is((select count(*)::int from notifications where owner_id = '25780000-0000-0000-0000-0000000000b1' and title = 'Contract quantity exceeded'), 1,
  'AC-QCR-003 recording again while still over adds no second notification');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($$select record_progress_assessment('25780000-0000-0000-0000-0000000000c1', '2026-02-01',
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","quantity_to_date":1000}]'::jsonb)$$, 'the assessment falls back to exactly C');
select is((select over_progress from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f1'),
  false, 'AC-QCR-001 P exactly equal to C is not over (strictly greater)');
reset role;
select is((select count(*)::int from quantity_overrun_notices where boq_item_id = '25780000-0000-0000-0000-0000000000f1' and kind = 'progress'), 0,
  'AC-QCR-003 the told-once row is cleared when the item returns to not-over');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($$select record_progress_assessment('25780000-0000-0000-0000-0000000000c1', '2026-02-01',
  '[{"boq_item_id":"25780000-0000-0000-0000-0000000000f1","quantity_to_date":1050}]'::jsonb)$$, 'the assessment crosses C again');
reset role;
select is((select count(*)::int from notifications where owner_id = '25780000-0000-0000-0000-0000000000b1' and title = 'Contract quantity exceeded'), 2,
  'AC-QCR-003 crossing C again after returning under adds a new notification');

-- ── AC-QCR-002: the forecast source ─────────────────────────────────────────────────────────────────
-- f3 (C 500, no progress): E = 600 makes it over with trigger kind forecast
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select throws_ok($$select record_quantity_forecast('25780000-0000-0000-0000-0000000000f3', 600, 'expected')$$, '42501', null,
  'AC-QCR-002 an Engineer cannot record a forecast');
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($$select record_quantity_forecast('25780000-0000-0000-0000-0000000000f3', 600, 'expected')$$, 'AC-QCR-002 Finance records the forecast');
select is((select over_forecast from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f3'),
  true, 'AC-QCR-002 E above C with P at or below C is over with kind forecast');
select is((select over_progress from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f3'),
  false, 'AC-QCR-002 the progress flag is not set by a forecast');
select throws_ok($$update quantity_forecasts set quantity = 1$$, '42501', null, 'AC-QCR-002 a forecast cannot be updated through the API');
reset role;
select throws_ok($$delete from quantity_forecasts$$, '42501', 'forecast quantities are append-only', 'AC-QCR-002 forecasts are append-only');
select is((select count(*)::int from quantity_overrun_notices where boq_item_id = '25780000-0000-0000-0000-0000000000f3' and kind = 'forecast'), 1,
  'AC-QCR-003 the forecast crossing is also told once');

-- ── AC-QCR-029: a lump-sum line cannot be over-contract and has no forecast ─────────────────────────
insert into project_progress_entries (id, org_id, project_id, month, pct_complete) values
  ('25780000-0000-0000-0000-000000000d09', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', '2025-12-01', 10);
insert into progress_assessment_quantities (org_id, entry_id, boq_item_id, quantity_to_date) values
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-000000000d09', '25780000-0000-0000-0000-0000000000f2', 5);
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select over_progress or over_forecast from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f2'),
  false, 'AC-QCR-029 a lump-sum line is never over-contract, whatever was assessed');
select throws_ok($$select record_quantity_forecast('25780000-0000-0000-0000-0000000000f2', 2, 'x')$$, '23514', 'a lump-sum line is fixed at one, so it has no forecast quantity',
  'AC-QCR-029 a lump-sum line takes no forecast');

-- ── AC-QCR-028: only validated, current daily reports count ─────────────────────────────────────────
reset role;
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at, validated_by, validated_at, superseded_at, archived_at) values
  ('25780000-0000-0000-0000-000000000e01', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', '25780000-0000-0000-0000-0000000000e1', '2026-03-01', 'draft', '25780000-0000-0000-0000-0000000000b6', null, null, null, null, null),
  ('25780000-0000-0000-0000-000000000e02', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', '25780000-0000-0000-0000-0000000000e1', '2026-03-02', 'submitted', '25780000-0000-0000-0000-0000000000b6', now(), null, null, null, null),
  ('25780000-0000-0000-0000-000000000e03', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', '25780000-0000-0000-0000-0000000000e1', '2026-03-03', 'returned', '25780000-0000-0000-0000-0000000000b6', now(), null, null, null, null),
  ('25780000-0000-0000-0000-000000000e04', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', '25780000-0000-0000-0000-0000000000e1', '2026-03-04', 'validated', '25780000-0000-0000-0000-0000000000b6', now(), '25780000-0000-0000-0000-0000000000b1', now(), now(), null),
  ('25780000-0000-0000-0000-000000000e05', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', '25780000-0000-0000-0000-0000000000e1', '2026-03-05', 'validated', '25780000-0000-0000-0000-0000000000b6', now(), '25780000-0000-0000-0000-0000000000b1', now(), null, now());
insert into dsr_progress_lines (org_id, report_id, position, work_order_line_id, quantity, unit)
  select '25780000-0000-0000-0000-0000000000a1', r.id, 1, '25780000-0000-0000-0000-000000000013', 100, 'm'
    from daily_site_reports r where r.id::text like '25780000-0000-0000-0000-000000000e0%';
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select over_progress from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f3'),
  false, 'AC-QCR-028 draft, submitted, returned, superseded and archived daily reports do not count toward P');
reset role;
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at, validated_by, validated_at) values
  ('25780000-0000-0000-0000-000000000e06', '25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-0000000000c1', '25780000-0000-0000-0000-0000000000e1', '2026-03-06', 'submitted', '25780000-0000-0000-0000-0000000000b6', now(), null, null);
insert into dsr_progress_lines (org_id, report_id, position, work_order_line_id, quantity, unit) values
  ('25780000-0000-0000-0000-0000000000a1', '25780000-0000-0000-0000-000000000e06', 1, '25780000-0000-0000-0000-000000000013', 520, 'm');
-- validating it is the write that can move P (the shipped validate RPC updates the report status)
update daily_site_reports set status = 'validated', validated_by = '25780000-0000-0000-0000-0000000000b1', validated_at = now() where id = '25780000-0000-0000-0000-000000000e06';
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select progress_source from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f3'),
  'daily_report', 'AC-QCR-028 a validated daily report sets P and is named as the source');
select is((select progress_quantity from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f3'),
  520.000::numeric, 'AC-QCR-028 only the validated report (520) counts');
select is((select over_progress from qcr_over_contract('25780000-0000-0000-0000-0000000000c1') where boq_item_id = '25780000-0000-0000-0000-0000000000f3'),
  true, 'AC-QCR-028 P above C through a validated daily report makes the line over-contract');
select * from finish();
rollback;
