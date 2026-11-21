-- 1270_earned_billed_revenue.test.sql — #2733. AC-EBR-001..007, see docs/specs/earned-billed-revenue.spec.md.
begin;
create extension if not exists pgtap;
select plan(30);

-- ── fixtures (table owner) ───────────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency, default_timezone) values
  ('27330000-0000-0000-0000-0000000000a1', 'EBR Org A', 'USD', 'UTC'),
  ('27330000-0000-0000-0000-0000000000a2', 'EBR Org B', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('27330000-0000-0000-0000-0000000000b1', 'ebr-eng@example.com'),
  ('27330000-0000-0000-0000-0000000000b2', 'ebr-pm@example.com'),
  ('27330000-0000-0000-0000-0000000000b3', 'ebr-fin@example.com'),
  ('27330000-0000-0000-0000-0000000000b4', 'ebr-admin@example.com'),
  ('27330000-0000-0000-0000-0000000000b5', 'ebr-other-pm@example.com'),
  ('27330000-0000-0000-0000-0000000000b6', 'ebr-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27330000-0000-0000-0000-0000000000b1', '27330000-0000-0000-0000-0000000000a1', 'Eng', 'ebr-eng@example.com', 'Engineer', 'active'),
  ('27330000-0000-0000-0000-0000000000b2', '27330000-0000-0000-0000-0000000000a1', 'PM', 'ebr-pm@example.com', 'Project Manager', 'active'),
  ('27330000-0000-0000-0000-0000000000b3', '27330000-0000-0000-0000-0000000000a1', 'Fin', 'ebr-fin@example.com', 'Finance', 'active'),
  ('27330000-0000-0000-0000-0000000000b4', '27330000-0000-0000-0000-0000000000a1', 'Admin', 'ebr-admin@example.com', 'Admin', 'active'),
  ('27330000-0000-0000-0000-0000000000b5', '27330000-0000-0000-0000-0000000000a1', 'Other PM', 'ebr-other-pm@example.com', 'Project Manager', 'active'),
  ('27330000-0000-0000-0000-0000000000b6', '27330000-0000-0000-0000-0000000000a2', 'Foreign', 'ebr-foreign@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('27330000-0000-0000-0000-0000000000c1', '27330000-0000-0000-0000-0000000000a1', 'EBR Contract', 'Ongoing Project', 'USD', '27330000-0000-0000-0000-0000000000b2');
-- WO one: validated progress 100.00, a manual invoice 60.00. WO two: no validated progress, an unraised claim 90.00.
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27330000-0000-0000-0000-0000000000e1', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000c1', 'WO one', 'Issued', 10000, 'exclusive', 0),
  ('27330000-0000-0000-0000-0000000000e2', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000c1', 'WO two', 'Issued', 10000, 'exclusive', 0);
insert into cost_disciplines (id, org_id, code, name) values
  ('27330000-0000-0000-0000-0000000000d1', '27330000-0000-0000-0000-0000000000a1', 'CIV', 'Civil');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('27330000-0000-0000-0000-0000000000f1', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000c1', 'L1', 'Civil line', 'm', 1000, 10),
  ('27330000-0000-0000-0000-0000000000f2', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000c1', 'L2', 'Untagged line', 'm', 1000, 10);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('27330000-0000-0000-0000-000000000011', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000e1', '27330000-0000-0000-0000-0000000000f1', 100);
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at) values
  ('27330000-0000-0000-0000-000000000101', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000c1', '27330000-0000-0000-0000-0000000000e1', '2026-03-01', 'validated', '27330000-0000-0000-0000-0000000000b1', '27330000-0000-0000-0000-0000000000b3', now());
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id) values
  ('27330000-0000-0000-0000-000000000102', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000c1', '27330000-0000-0000-0000-0000000000e1', '2026-03-02', 'draft', '27330000-0000-0000-0000-0000000000b1');
insert into dsr_progress_lines (id, org_id, report_id, position, work_order_line_id, quantity, unit, frozen_rate, frozen_rate_source, frozen_amount, frozen_at) values
  ('27330000-0000-0000-0000-000000000201', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-000000000101', 1, '27330000-0000-0000-0000-000000000011', 10, 'm', 10, 'contract', 100.00, now()),
  ('27330000-0000-0000-0000-000000000204', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-000000000102', 1, '27330000-0000-0000-0000-000000000011', 99.9, 'm', null, null, null, null);
-- Billing: manual invoice 60.00 on WO one; a cancelled invoice 400.00 on WO two (never counts).
insert into sales_invoices (id, org_id, project_id, work_order_id, si_number, invoice_date, amount, tax_treatment, tax_amount, status) values
  ('27330000-0000-0000-0000-000000000301', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000c1', '27330000-0000-0000-0000-0000000000e1', 'EBR-1', '2026-03-05', 60.00, 'exclusive', 0, 'Unpaid'),
  ('27330000-0000-0000-0000-000000000302', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000c1', '27330000-0000-0000-0000-0000000000e2', 'EBR-2', '2026-03-06', 400.00, 'exclusive', 0, 'Cancelled');
-- Claims on WO two: live unraised claim 90.00 (70.00 civil + 20.00 untagged), a withdrawn claim 500.00, an unraised down payment 1000.00 (bills zero).
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, created_by, withdrawn_by, withdrawn_at) values
  ('27330000-0000-0000-0000-000000000401', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000c1', '27330000-0000-0000-0000-0000000000e2', 'progress', 'USD', 90.00, '27330000-0000-0000-0000-0000000000b3', null, null),
  ('27330000-0000-0000-0000-000000000402', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000c1', '27330000-0000-0000-0000-0000000000e2', 'progress', 'USD', 500.00, '27330000-0000-0000-0000-0000000000b3', '27330000-0000-0000-0000-0000000000b3', now());
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, down_payment_amount, recovery_pct, dp_item_code, created_by) values
  ('27330000-0000-0000-0000-000000000403', '27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-0000000000c1', '27330000-0000-0000-0000-0000000000e2', 'down_payment', 'USD', 1000.00, 1000.00, 10, 'DP', '27330000-0000-0000-0000-0000000000b3');
insert into progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit, quantity, rate, amount) values
  ('27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-000000000401', '27330000-0000-0000-0000-0000000000f1', 'L1', 'Civil line', 'm', 7, 10, 70.00),
  ('27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-000000000401', '27330000-0000-0000-0000-0000000000f2', 'L2', 'Untagged line', 'm', 2, 10, 20.00),
  ('27330000-0000-0000-0000-0000000000a1', '27330000-0000-0000-0000-000000000402', '27330000-0000-0000-0000-0000000000f1', 'L1', 'Civil line', 'm', 50, 10, 500.00);

-- ── AC-EBR-001: off by default → nothing returned ──────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"27330000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is((select count(*)::int from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1')), 0,
  'AC-EBR-001 setting off: the per-work-order read returns nothing');
select is((select count(*)::int from public.management_pack_earned()), 0, 'AC-EBR-001 setting off: the pack read returns nothing');
select is((select count(*)::int from public.project_discipline_revenue('27330000-0000-0000-0000-0000000000c1')), 0,
  'AC-EBR-001 setting off: the billed rows are not returned either');

-- tag the civil item, turn the setting on (Admin)
select public.set_boq_item_discipline('27330000-0000-0000-0000-0000000000f1', '27330000-0000-0000-0000-0000000000d1');
set local request.jwt.claims = '{"sub":"27330000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select public.set_org_discipline_profit_enabled(true);

-- ── AC-EBR-002: roles and organisations ────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"27330000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select * from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1')$$, '42501', null,
  'AC-EBR-002 an Engineer is refused');
select is((select count(*)::int from public.management_pack_earned()), 0, 'AC-EBR-002 an Engineer gets no pack rows');
set local request.jwt.claims = '{"sub":"27330000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($$select * from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1')$$, '42501', null,
  'AC-EBR-002 another project''s Project Manager is refused');
select is((select count(*)::int from public.management_pack_earned()), 0, 'AC-EBR-002 another project''s Project Manager gets no pack rows');
set local request.jwt.claims = '{"sub":"27330000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select throws_ok($$select * from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1')$$, 'P0002', null,
  'AC-EBR-002 another organisation reads the project as absent');
set local request.jwt.claims = '{"sub":"27330000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1')), 2,
  'AC-EBR-002 the project''s own Project Manager reads both work orders');

-- ── AC-EBR-003..007 as Finance ─────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"27330000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is((select earned from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1') where work_order_id = '27330000-0000-0000-0000-0000000000e1'),
  100.00::numeric, 'AC-EBR-003 WO one earned 100.00 (the draft report is not counted: AC-EBR-005)');
select is((select billed from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1') where work_order_id = '27330000-0000-0000-0000-0000000000e1'),
  60.00::numeric, 'AC-EBR-003 WO one billed 60.00 excl. tax');
select is((select earned_lines from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1') where work_order_id = '27330000-0000-0000-0000-0000000000e1'),
  1, 'AC-EBR-005 WO one counts one validated line: the draft report''s line is not counted');
select is((select unrated_lines from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1') where work_order_id = '27330000-0000-0000-0000-0000000000e1'),
  0, 'AC-EBR-005 WO one has no unrated line: the draft line (no rate) is not counted');

select is((select earned - billed from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1') where work_order_id = '27330000-0000-0000-0000-0000000000e1'),
  40.00::numeric, 'AC-EBR-003 the gap is 40.00');
select is((select earned from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1') where work_order_id = '27330000-0000-0000-0000-0000000000e2'),
  null::numeric, 'AC-EBR-004 no validated progress: earned is null (not available), never zero');
select is((select earned_lines from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1') where work_order_id = '27330000-0000-0000-0000-0000000000e2'),
  0, 'AC-EBR-004 and it counts no validated line');
select is((select billed from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1') where work_order_id = '27330000-0000-0000-0000-0000000000e2'),
  90.00::numeric, 'AC-EBR-005 WO two billed 90.00: the withdrawn claim, the cancelled invoice and the down payment add nothing');
select is((select count(*)::int from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1') e
            join public.work_order_billing b on b.work_order_id = e.work_order_id where e.billed <> b.invoiced + b.pending),
  0, 'AC-EBR-007 billed equals work_order_billing invoiced + pending for every work order');
select is((select earned from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1') where work_order_id = '27330000-0000-0000-0000-0000000000e1'),
  public.work_order_validated_revenue('27330000-0000-0000-0000-0000000000e1'), 'AC-EBR-007 earned equals work_order_validated_revenue');
select is((select revenue from public.project_discipline_revenue('27330000-0000-0000-0000-0000000000c1') where basis = 'billed_claims' and discipline_id = '27330000-0000-0000-0000-0000000000d1'),
  70.00::numeric, 'AC-EBR-006 billed per discipline: civil 70.00');
select is((select revenue from public.project_discipline_revenue('27330000-0000-0000-0000-0000000000c1') where basis = 'billed_claims' and discipline_id is null),
  20.00::numeric, 'AC-EBR-006 billed per discipline: untagged item 20.00');
select is((select revenue from public.project_discipline_revenue('27330000-0000-0000-0000-0000000000c1') where basis = 'billed_unitemised'),
  60.00::numeric, 'AC-EBR-006 billed work no claim line itemises is shown as not itemised');
select is((select sum(revenue) from public.project_discipline_revenue('27330000-0000-0000-0000-0000000000c1') where basis like 'billed%'),
  (select sum(invoiced + pending) from public.work_order_billing where project_id = '27330000-0000-0000-0000-0000000000c1'),
  'AC-EBR-006 the billed rows sum to the project''s billed work');
select is((select sum(revenue) from public.project_discipline_revenue('27330000-0000-0000-0000-0000000000c1') where basis = 'validated_progress'),
  100.00::numeric, 'the validated_progress rows are unchanged by the billed basis');
select is((select earned from public.management_pack_earned() where project_id = '27330000-0000-0000-0000-0000000000c1'),
  100.00::numeric, 'AC-EBR-012 the pack read returns the project''s earned revenue');
select is((select earned_lines from public.management_pack_earned() where project_id = '27330000-0000-0000-0000-0000000000c1'),
  1, 'AC-EBR-005 the pack read counts only the validated line, not the draft report''s');
select is((select unrated_lines from public.management_pack_earned() where project_id = '27330000-0000-0000-0000-0000000000c1'),
  0, 'AC-EBR-005 the pack read counts no unrated line from a draft report');
select is((select validated_lines from public.project_discipline_revenue('27330000-0000-0000-0000-0000000000c1') where basis = 'validated_progress' and discipline_id = '27330000-0000-0000-0000-0000000000d1'),
  1, 'AC-EBR-005 the discipline read counts one validated line for civil: the draft is not counted');
select is((select work_orders_without_progress from public.management_pack_earned() where project_id = '27330000-0000-0000-0000-0000000000c1'),
  1, 'AC-EBR-004 the pack read counts work orders without validated progress');

-- ── off again → nothing ────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"27330000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select public.set_org_discipline_profit_enabled(false);
select is((select count(*)::int from public.project_work_order_earned_billed('27330000-0000-0000-0000-0000000000c1')), 0,
  'AC-EBR-001 turning the setting off returns nothing again');

select * from finish();
rollback;
