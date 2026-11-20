-- 1125_boq_quantity_versions.test.sql — #2578 quantity versions + the direct-edit guard. AC-QCR-019, 020, 021.
-- Spec docs/specs/quantity-change-requests.spec.md (FR-QCR-017..019).
begin;
create extension if not exists pgtap;
select plan(14);

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
-- an item with progress, a claim and acceptance: f1
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

-- ── AC-QCR-021 baseline versions ────────────────────────────────────────────────────────────────────
select is((select count(*)::int from boq_quantity_versions where boq_item_id = '25780000-0000-0000-0000-0000000000f1' and source = 'baseline' and version_no = 1
            and quantity = 1000), 1, 'AC-QCR-021 a new contract line gets exactly one baseline version equal to its quantity');
select is((select count(*)::int from boq_items b where not exists (
             select 1 from boq_quantity_versions v where v.boq_item_id = b.id and v.version_no = 1 and v.source = 'baseline')), 0,
  'AC-QCR-021 every contract line (seed and backfilled lines included) has a baseline version');
select is((select count(*)::int from boq_items b
            where (select count(*) from boq_quantity_versions v where v.boq_item_id = b.id) = 1
              and b.quantity <> (select v.quantity from boq_quantity_versions v where v.boq_item_id = b.id)), 0,
  'AC-QCR-021 an untouched line carries a baseline equal to its current quantity');

-- ── AC-QCR-019 versions are append-only for every role ─────────────────────────────────────────────
select throws_ok($$update boq_quantity_versions set quantity = 5 where boq_item_id = '25780000-0000-0000-0000-0000000000f1'$$, '42501',
  'quantity versions are append-only', 'AC-QCR-019 the table owner cannot update a version');
select throws_ok($$delete from boq_quantity_versions where boq_item_id = '25780000-0000-0000-0000-0000000000f1'$$, '42501',
  'quantity versions are append-only', 'AC-QCR-019 the table owner cannot delete a version');
select throws_ok($$truncate boq_quantity_versions$$, '42501', 'quantity versions are append-only', 'AC-QCR-019 nobody can truncate versions');
set local role service_role;
select throws_ok($$update boq_quantity_versions set quantity = 5 where boq_item_id = '25780000-0000-0000-0000-0000000000f1'$$, '42501',
  'quantity versions are append-only', 'AC-QCR-019 the service role cannot update a version');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"25780000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($$delete from boq_quantity_versions where boq_item_id = '25780000-0000-0000-0000-0000000000f1'$$, '42501', null,
  'AC-QCR-019 an Admin cannot delete a version through the API');

-- ── AC-QCR-020 the direct-edit guard ───────────────────────────────────────────────────────────────
select throws_ok($$update boq_items set quantity = 1100 where id = '25780000-0000-0000-0000-0000000000f1'$$, '42501',
  'use a quantity change request: this contract line already has progress, a claim or a confirmed acceptance',
  'AC-QCR-020 a line with a claim cannot have its quantity edited directly');
select is((select quantity from boq_items where id = '25780000-0000-0000-0000-0000000000f1'), 1000.000::numeric, 'AC-QCR-020 the refused edit changed nothing');
update boq_items set quantity = 250 where id = '25780000-0000-0000-0000-0000000000f4';
update boq_items set quantity = 260 where id = '25780000-0000-0000-0000-0000000000f4';
select is((select string_agg(version_no || ':' || source || ':' || quantity, ',' order by version_no) from boq_quantity_versions where boq_item_id = '25780000-0000-0000-0000-0000000000f4'),
  '1:baseline:200.000,2:setup_edit:250.000,3:setup_edit:260.000', 'AC-QCR-020 a fresh line appends consecutive setup_edit versions');
select lives_ok($$update boq_items set description = 'Road (edited)' where id = '25780000-0000-0000-0000-0000000000f1'$$,
  'AC-QCR-020 a non-quantity edit on a locked line is not blocked');
select throws_ok($$select set_config('pmo.qcr_amend_quantity', 'on', true); update boq_items set quantity = 1100 where id = '25780000-0000-0000-0000-0000000000f1'$$,
  '42501', null, 'AC-QCR-020 a client cannot satisfy the amend flag (the guard also needs the table owner)');
reset role;
select is((select count(*)::int from boq_quantity_versions where boq_item_id = '25780000-0000-0000-0000-0000000000f1'), 1,
  'AC-QCR-020 no version was added by the refused edits');

select * from finish();
rollback;
