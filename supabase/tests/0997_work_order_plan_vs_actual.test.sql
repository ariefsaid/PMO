-- 0997_work_order_plan_vs_actual.test.sql — #2519 (docs/specs/work-order-plan-vs-actual.spec.md).
-- Migrations under test: 0997_work_order_plan_lines.sql, 0998_project_shared_cost_splits.sql, 0999_work_order_cost_amounts.sql.
-- AC-WPVA-001 plan figures: Engineer refused, Finance saves with one audit row · AC-WPVA-002 another org, another project,
-- an archived discipline, a cancelled work order are refused · AC-WPVA-003 a work order's actuals come from its source rows ·
-- AC-WPVA-004 direct cost per work order and the shared pool · AC-WPVA-006 a split not summing to 100 is refused ·
-- AC-WPVA-009 a role that cannot read the money is refused (the screens show "restricted") · AC-WPVA-012 the project
-- total is every counted line once, unchanged by attribution · AC-WPVA-015 a Project Manager cannot set a split.
-- Every denial asserts the errcode AND the message.
begin;
create extension if not exists pgtap;
select plan(77);

-- ── Fixtures: org A (several roles), org B (another tenant). Written as the table owner. ─────────────────
insert into organizations (id, name, default_currency) values
  ('25190000-0000-0000-0000-00000000000a', 'WPVA Org',       'IDR'),
  ('25190000-0000-0000-0000-00000000000b', 'WPVA Other Org', 'IDR');
insert into auth.users (id, email) values
  ('25190000-0000-0000-0000-0000000000a1', 'wpva-admin@example.com'),
  ('25190000-0000-0000-0000-0000000000a2', 'wpva-fin@example.com'),
  ('25190000-0000-0000-0000-0000000000a3', 'wpva-pm@example.com'),
  ('25190000-0000-0000-0000-0000000000a4', 'wpva-eng@example.com'),
  ('25190000-0000-0000-0000-0000000000b1', 'wpva-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25190000-0000-0000-0000-0000000000a1', '25190000-0000-0000-0000-00000000000a', 'WPVA Admin', 'wpva-admin@example.com', 'Admin', 'active'),
  ('25190000-0000-0000-0000-0000000000a2', '25190000-0000-0000-0000-00000000000a', 'WPVA Fin',   'wpva-fin@example.com',   'Finance', 'active'),
  ('25190000-0000-0000-0000-0000000000a3', '25190000-0000-0000-0000-00000000000a', 'WPVA PM',    'wpva-pm@example.com',    'Project Manager', 'active'),
  ('25190000-0000-0000-0000-0000000000a4', '25190000-0000-0000-0000-00000000000a', 'WPVA Eng',   'wpva-eng@example.com',   'Engineer', 'active'),
  ('25190000-0000-0000-0000-0000000000b1', '25190000-0000-0000-0000-00000000000b', 'WPVA XOrg',  'wpva-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('25190000-0000-0000-0000-0000000000d1', '25190000-0000-0000-0000-00000000000a', 'WPVA Site',       'Ongoing Project', '25190000-0000-0000-0000-0000000000a3', 'IDR'),
  ('25190000-0000-0000-0000-0000000000d2', '25190000-0000-0000-0000-00000000000a', 'WPVA Site Two',   'Ongoing Project', '25190000-0000-0000-0000-0000000000a3', 'IDR'),
  ('25190000-0000-0000-0000-0000000000d9', '25190000-0000-0000-0000-00000000000b', 'WPVA Other Site', 'Ongoing Project', null, 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('25190000-0000-0000-0000-000000000401', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-0000000000d1', 'WO-A', 'WPVA WO A', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('25190000-0000-0000-0000-000000000402', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-0000000000d1', 'WO-B', 'WPVA WO B', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('25190000-0000-0000-0000-000000000404', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-0000000000d2', 'WO-C', 'WPVA WO two', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('25190000-0000-0000-0000-000000000409', '25190000-0000-0000-0000-00000000000b', '25190000-0000-0000-0000-0000000000d9', 'WO-X', 'WPVA WO other', 'Issued', 10000, 'exclusive', 0, 'IDR');

-- Source rows are written with triggers off: this file proves the read and the plan/split rules, not each record's
-- create path. Attribution goes through set_cost_attribution below (with its triggers on).
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, cancelled_at, currency) values
  ('25190000-0000-0000-0000-000000000403', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-0000000000d1', 'WO-Z', 'WPVA WO cancelled', 'Cancelled', 0, 'exclusive', 0, now(), 'IDR');
insert into cost_disciplines (id, org_id, code, name, archived_at) values
  ('25190000-0000-0000-0000-000000000501', '25190000-0000-0000-0000-00000000000a', 'CIV', 'Civil', null),
  ('25190000-0000-0000-0000-000000000502', '25190000-0000-0000-0000-00000000000a', 'OLD', 'Retired', now()),
  ('25190000-0000-0000-0000-000000000503', '25190000-0000-0000-0000-00000000000a', 'ELE', 'Electrical', null);
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, currency) values
  ('25190000-0000-0000-0000-000000000601', '25190000-0000-0000-0000-00000000000a', 'WPVA services A', '25190000-0000-0000-0000-0000000000d1',
   '25190000-0000-0000-0000-0000000000a4', 'Ordered', 600, 600, 'IDR'),
  ('25190000-0000-0000-0000-000000000602', '25190000-0000-0000-0000-00000000000a', 'WPVA services B', '25190000-0000-0000-0000-0000000000d1',
   '25190000-0000-0000-0000-0000000000a4', 'Ordered', 400, 400, 'IDR'),
  ('25190000-0000-0000-0000-000000000603', '25190000-0000-0000-0000-00000000000a', 'WPVA site office', '25190000-0000-0000-0000-0000000000d1',
   '25190000-0000-0000-0000-0000000000a4', 'Ordered', 100, 100, 'IDR'),
  ('25190000-0000-0000-0000-000000000604', '25190000-0000-0000-0000-00000000000a', 'WPVA stocked cable', '25190000-0000-0000-0000-0000000000d1',
   '25190000-0000-0000-0000-0000000000a4', 'Ordered', 999, 999, 'IDR');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency,
                                  voided_at, erp_cancelled_at, void_reason) values
  ('25190000-0000-0000-0000-000000000624', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000602', 'VI-B9', '2026-11-16',
   'Received', 7777, 'exclusive', 0, 'IDR', '2026-11-17T00:00:00Z', '2026-11-17T00:00:00Z', 'duplicate');
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('25190000-0000-0000-0000-000000000611', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000601', 'PO-WPVA-1', 'Issued', '2026-11-16', 600, 'IDR');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency, voided_at) values
  -- A: 500 + 100 = 600 (the second inclusive of 11 tax: 111 - 11 = 100)
  ('25190000-0000-0000-0000-000000000621', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000601', 'VI-A1', '2026-11-16', 'Received', 500, 'exclusive', 55, 'IDR', null),
  ('25190000-0000-0000-0000-000000000622', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000601', 'VI-A2', '2026-11-16', 'Received', 111, 'inclusive', 11, 'IDR', null),
  -- B: 400; a voided bill never counts
  ('25190000-0000-0000-0000-000000000623', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000602', 'VI-B1', '2026-11-16', 'Received', 400, 'exclusive', 0, 'IDR', null),
  -- shared: 70 (no work order); the stock issue below adds 30 more shared
  ('25190000-0000-0000-0000-000000000625', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000603', 'VI-S1', '2026-11-16', 'Received', 70, 'exclusive', 0, 'IDR', null),
  -- a bill of goods received into stock: counted when issued, never as the bill
  ('25190000-0000-0000-0000-000000000626', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000604', 'VI-ST', '2026-11-16', 'Received', 999, 'exclusive', 0, 'IDR', null);
-- Paid amounts make the project basis 600 + 400 + 100 before attribution.
update public.procurements set budget_category = 'Materials'
 where id in ('25190000-0000-0000-0000-000000000601', '25190000-0000-0000-0000-000000000602', '25190000-0000-0000-0000-000000000603');
insert into public.payments (id, org_id, procurement_id, invoice_id, status, amount, currency) values
 ('25190000-0000-0000-0000-000000000641', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000601', '25190000-0000-0000-0000-000000000621', 'Paid', 555, 'IDR'),
 ('25190000-0000-0000-0000-000000000642', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000601', '25190000-0000-0000-0000-000000000622', 'Paid', 111, 'IDR'),
 ('25190000-0000-0000-0000-000000000643', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000602', '25190000-0000-0000-0000-000000000623', 'Paid', 400, 'IDR'),
 ('25190000-0000-0000-0000-000000000644', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000603', null, 'Paid', 100, 'IDR');
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('25190000-0000-0000-0000-000000000701', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-0000000000a4', '2026-11-16', 'Approved');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('25190000-0000-0000-0000-000000000711', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000701', '25190000-0000-0000-0000-0000000000d1', '2026-11-16', 8);
insert into stock_units (id, org_id, code, name) values ('25190000-0000-0000-0000-000000000851', '25190000-0000-0000-0000-00000000000a', 'm', 'metre');
insert into stock_items (id, org_id, code, name, unit_id) values
  ('25190000-0000-0000-0000-000000000852', '25190000-0000-0000-0000-00000000000a', 'CBL', 'Cable', '25190000-0000-0000-0000-000000000851');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('25190000-0000-0000-0000-000000000801', '25190000-0000-0000-0000-00000000000a', 'WPVA-C', 'Central', 'central', null);
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, procurement_id, occurred_on, created_by, posted_by, posted_at) values
  ('25190000-0000-0000-0000-000000000810', '25190000-0000-0000-0000-00000000000a', 'SR-WPVA-1', 'receive', 'Posted', '25190000-0000-0000-0000-000000000801', null,
   '25190000-0000-0000-0000-000000000604', '2026-11-16', '25190000-0000-0000-0000-0000000000a4', '25190000-0000-0000-0000-0000000000a4', now()),
  ('25190000-0000-0000-0000-000000000811', '25190000-0000-0000-0000-00000000000a', 'SI-WPVA-1', 'issue', 'Posted', '25190000-0000-0000-0000-000000000801',
   '25190000-0000-0000-0000-0000000000d1', null, '2026-11-16', '25190000-0000-0000-0000-0000000000a4', '25190000-0000-0000-0000-0000000000a4', now());
insert into stock_document_lines (id, org_id, document_id, line_no, item_id, quantity, direction) values
  ('25190000-0000-0000-0000-000000000821', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000811', 1, '25190000-0000-0000-0000-000000000852', 3, 'out');
insert into stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, kind, qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by) values
  ('25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000811', '25190000-0000-0000-0000-000000000821',
   '25190000-0000-0000-0000-000000000852', '25190000-0000-0000-0000-000000000801', '25190000-0000-0000-0000-0000000000d1', 'issue', -3, -30, 0, 0,
   '2026-11-16', '25190000-0000-0000-0000-0000000000a4');
insert into equipment_assets (id, org_id, code, name) values
  ('25190000-0000-0000-0000-000000000901', '25190000-0000-0000-0000-00000000000a', 'WPVA-EX', 'WPVA excavator');
insert into equipment_usage_entries (id, org_id, asset_id, project_id, work_date, quantity, unit, status, author_id) values
  ('25190000-0000-0000-0000-000000000911', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000901',
   '25190000-0000-0000-0000-0000000000d1', '2026-11-16', 6, 'hours', 'Draft', '25190000-0000-0000-0000-0000000000a4');
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create temp table wpva_snap (label text primary key, v numeric);
grant all on wpva_snap to authenticated;

-- ── AC-WPVA-012 (before): the project's counted total, before any work order is named ─────────────────
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
insert into wpva_snap select 'total_before', sum(amount::numeric)
  from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1') where reason in ('counted', 'unassigned', 'split-when-custom');
select is((select v from wpva_snap where label = 'total_before'),
  (select (public.get_project_finances('25190000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric),
  'AC-WPVA-012 the work-order cost read equals the existing project actuals basis');
select is((select v from wpva_snap where label = 'total_before'), 1100.00::numeric,
  'AC-WPVA-012 the project total counts paid purchases 600 + 400 + 100 once');

-- Attribute: A's bills and PO to WO-A (Civil / Electrical), B's bill to WO-B; the site-office bill and the issue stay shared.
select is(public.set_cost_attribution('vendor_bill', array['25190000-0000-0000-0000-000000000621']::uuid[],
  '25190000-0000-0000-0000-000000000401', '25190000-0000-0000-0000-000000000501'), 1, 'fixture: VI-A1 names WO-A / Civil');
select is(public.set_cost_attribution('vendor_bill', array['25190000-0000-0000-0000-000000000622']::uuid[],
  '25190000-0000-0000-0000-000000000401', '25190000-0000-0000-0000-000000000503'), 1, 'fixture: VI-A2 names WO-A / Electrical');
select is(public.set_cost_attribution('purchase_order', array['25190000-0000-0000-0000-000000000611']::uuid[],
  '25190000-0000-0000-0000-000000000401', null), 1, 'fixture: the PO names WO-A');
select is(public.set_cost_attribution('vendor_bill', array['25190000-0000-0000-0000-000000000623', '25190000-0000-0000-0000-000000000626']::uuid[],
  '25190000-0000-0000-0000-000000000402', null), 2, 'fixture: VI-B1 and the stocked bill name WO-B');
select is(public.set_cost_attribution('timesheet_entry', array['25190000-0000-0000-0000-000000000711']::uuid[],
  '25190000-0000-0000-0000-000000000401', null), 1, 'fixture: the timesheet line names WO-A');

-- ── AC-WPVA-003 / 004 / 012: the read ─────────────────────────────────────────────────────────────────
create temp table wpva_rows as select * from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1');
select is((select sum(amount::numeric) from wpva_rows where reason in ('counted', 'unassigned', 'split-when-custom')), (select v from wpva_snap where label = 'total_before'),
  'AC-WPVA-012 naming work orders does not change the project total (every counted line still appears exactly once)');
select is((select sum(amount::numeric) from wpva_rows where reason = 'counted' and work_order_id = '25190000-0000-0000-0000-000000000401'), 600.00::numeric,
  'AC-WPVA-004 WO-A direct cost is 600 (an exclusive bill 500 + an inclusive bill 111 less its 11 tax)');
select is((select sum(amount::numeric) from wpva_rows where reason = 'counted' and work_order_id = '25190000-0000-0000-0000-000000000402'), 400.00::numeric,
  'AC-WPVA-004 WO-B direct cost is 400 (its stocked bill is not summed)');
select is((select sum(amount::numeric) from wpva_rows where reason in ('counted', 'unassigned', 'split-when-custom') and work_order_id is null), 100.00::numeric,
  'AC-WPVA-004 the unlinked site-office payment remains unassigned');
select is((select reference from wpva_rows where source = 'purchase_balance' and record_id = '25190000-0000-0000-0000-000000000603'),
  'WPVA site office', 'the unassigned payment retains its purchase reference');
select is((select sum(amount::numeric) from wpva_rows where reason = 'counted' and work_order_id is not null)
          + (select sum(amount::numeric) from wpva_rows where reason in ('counted', 'unassigned', 'split-when-custom') and work_order_id is null), 1100.00::numeric,
  'AC-WPVA-012 project total = the work orders'' direct cost + the unassigned cost');
select is((select array_agg(amount::numeric order by amount::numeric) from wpva_rows
            where work_order_id = '25190000-0000-0000-0000-000000000401' and discipline_id is not null), array[100.00, 500.00]::numeric[],
  'AC-WPVA-003 WO-A''s discipline groups (Electrical 100, Civil 500) sum to its total');
select is((select reason from wpva_rows where record_id = '25190000-0000-0000-0000-000000000611'), 'commitment',
  'the PO is listed as a commitment, never summed beside its bill');
select is((select reason from wpva_rows where record_id = '25190000-0000-0000-0000-000000000626'), 'stocked',
  'a bill of goods received into stock is listed as stocked, not summed (its issue carries the cost)');
select is((select count(*)::int from wpva_rows where record_id = '25190000-0000-0000-0000-000000000624'), 0,
  'a voided bill is not in the read');
select ok((select reason = 'outside-basis' and amount is null from wpva_rows where record_id = '25190000-0000-0000-0000-000000000811'),
  'a stock issue is listed but excluded from the paid-purchase basis');
select ok((select reason = 'no-rate' and amount is null and quantity = 8 and person_id = '25190000-0000-0000-0000-0000000000a4'
             from wpva_rows where record_id = '25190000-0000-0000-0000-000000000711'),
  'timesheet hours carry hours and the person, no money (no labour rate in PMO)');
select ok((select reason = 'not-posted' and amount is null and quantity = 6 and quantity_unit = 'hours'
             from wpva_rows where record_id = '25190000-0000-0000-0000-000000000911'),
  'equipment usage not yet approved carries its hours and no money');
select is((select count(*)::int from public.work_order_cost_lines l where l.project_id = '25190000-0000-0000-0000-0000000000d1'
            and l.record_id <> '25190000-0000-0000-0000-000000000624'
            and not exists (select 1 from wpva_rows r where r.source = l.source and r.record_id = l.record_id)), 0,
  'the read retains every record from the #2517 seam except voided bills');
select is((select count(*)::int from wpva_rows r where exists (select 1 from public.work_order_cost_lines l
            where l.project_id = '25190000-0000-0000-0000-0000000000d1' and l.source = r.source and l.record_id = r.record_id)),
          (select count(*)::int from public.work_order_cost_lines l where l.project_id = '25190000-0000-0000-0000-0000000000d1'
            and l.record_id <> '25190000-0000-0000-0000-000000000624'),
  'each #2517 source record appears exactly once');

-- ── AC-WPVA-009: a role that cannot read the money is refused; another org's project reads as absent ───────────
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a4');
select throws_ok($$ select * from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1') $$, '42501', 'not authorized',
  'AC-WPVA-009 an Engineer cannot read work-order money (the screens show it as restricted)');
select pg_temp.act_as('25190000-0000-0000-0000-0000000000b1');
select throws_ok($$ select * from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1') $$, 'P0002', 'project not found',
  'AC-WPVA-009 another org''s Admin reads another org''s project as absent');
reset role;
select is((select count(*)::int from information_schema.routine_privileges
            where routine_name = 'work_order_cost_amounts' and grantee in ('anon', 'PUBLIC')), 0, 'anon cannot execute the money read');

-- ── AC-WPVA-001 / 002: plan figures ───────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a4');
select throws_ok($$ insert into public.work_order_plan_lines (project_id, work_order_id, kind, value)
                    values ('25190000-0000-0000-0000-0000000000d1', '25190000-0000-0000-0000-000000000401', 'direct_budget', 500) $$,
  '42501', 'new row violates row-level security policy for table "work_order_plan_lines"', 'AC-WPVA-001 an Engineer cannot write a plan figure');
select is((select count(*)::int from public.work_order_plan_lines), 0, 'AC-WPVA-001 an Engineer reads no plan figures');

select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
select lives_ok($$ insert into public.work_order_plan_lines (project_id, work_order_id, kind, value, note)
                   values ('25190000-0000-0000-0000-0000000000d1', '25190000-0000-0000-0000-000000000401', 'direct_budget', 550, 'tender') $$,
  'AC-WPVA-001 Finance writes a plan figure');
select is((select org_id from public.work_order_plan_lines where work_order_id = '25190000-0000-0000-0000-000000000401'),
  '25190000-0000-0000-0000-00000000000a'::uuid, 'the plan figure''s org is stamped by the database');
reset role;
select is((select count(*)::int from public.audit_events where action = 'work_order_plan.insert'
            and entity_id = '25190000-0000-0000-0000-000000000401' and (detail->'after'->>'value')::numeric = 550), 1,
  'AC-WPVA-001 the save wrote one audit row carrying the figure');
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
update public.work_order_plan_lines set value = 600 where work_order_id = '25190000-0000-0000-0000-000000000401';
reset role;
select is((select count(*)::int from public.audit_events where action = 'work_order_plan.update'
            and entity_id = '25190000-0000-0000-0000-000000000401' and (detail->'before'->>'value')::numeric = 550
            and (detail->'after'->>'value')::numeric = 600), 1, 'AC-WPVA-001 an edit writes an audit row with before and after');
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');

select throws_ok($$ insert into public.work_order_plan_lines (project_id, work_order_id, kind, value)
                    values ('25190000-0000-0000-0000-0000000000d9', '25190000-0000-0000-0000-000000000409', 'direct_budget', 1) $$,
  '23514', 'WPVA_PLAN_WO: the work order belongs to another project', 'AC-WPVA-002 a work order of another org is refused');
select throws_ok($$ insert into public.work_order_plan_lines (project_id, work_order_id, kind, value)
                    values ('25190000-0000-0000-0000-0000000000d2', '25190000-0000-0000-0000-000000000401', 'crew_hours', 1) $$,
  '23514', 'WPVA_PLAN_WO: the work order belongs to another project', 'AC-WPVA-002 a work order of another project is refused');
select throws_ok($$ insert into public.work_order_plan_lines (project_id, work_order_id, discipline_id, kind, value)
                    values ('25190000-0000-0000-0000-0000000000d1', '25190000-0000-0000-0000-000000000401', '25190000-0000-0000-0000-000000000502', 'crew_hours', 1) $$,
  '23514', 'WPVA_PLAN_DISCIPLINE: the discipline is not on this organisation''s list', 'AC-WPVA-002 an archived discipline is refused');
select throws_ok($$ insert into public.work_order_plan_lines (project_id, work_order_id, kind, value)
                    values ('25190000-0000-0000-0000-0000000000d1', '25190000-0000-0000-0000-000000000403', 'crew_hours', 1) $$,
  '23514', 'WPVA_PLAN_CANCELLED: a cancelled work order''s plan is frozen', 'FR-WPVA-003 a cancelled work order''s plan is frozen');
select throws_ok($$ insert into public.work_order_plan_lines (project_id, work_order_id, kind, value)
                    values ('25190000-0000-0000-0000-0000000000d1', '25190000-0000-0000-0000-000000000402', 'direct_budget', -1) $$,
  '23514', null, 'FR-WPVA-002 a negative plan figure is refused');
select throws_ok($$ insert into public.work_order_plan_lines (project_id, work_order_id, kind, value)
                    values ('25190000-0000-0000-0000-0000000000d1', '25190000-0000-0000-0000-000000000401', 'direct_budget', 1) $$,
  '23505', null, 'one figure per work order, discipline and kind');

-- ── AC-WPVA-006 / 015: the custom split ────────────────────────────────────────────────────────────────
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.set_shared_cost_split('25190000-0000-0000-0000-0000000000d1',
                    '[{"work_order_id":"25190000-0000-0000-0000-000000000401","percent":"50"},{"work_order_id":"25190000-0000-0000-0000-000000000402","percent":"50"}]') $$,
  '42501', 'WPVA_SPLIT_ROLE: only Admin, Executive or Finance set a shared-cost split', 'AC-WPVA-015 a Project Manager cannot set a split');
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.set_shared_cost_split('25190000-0000-0000-0000-0000000000d1',
                    '[{"work_order_id":"25190000-0000-0000-0000-000000000401","percent":"50"},{"work_order_id":"25190000-0000-0000-0000-000000000402","percent":"49.9999"}]') $$,
  '23514', 'WPVA_SPLIT_SUM: the percentages add up to 99.9999, not 100', 'AC-WPVA-006 a split not summing to 100 is refused');
select throws_ok($$ select public.set_shared_cost_split('25190000-0000-0000-0000-0000000000d1',
                    '[{"work_order_id":"25190000-0000-0000-0000-000000000401","percent":"100"}]') $$,
  '23514', 'WPVA_SPLIT_WORK_ORDERS: the split names every live work order of this project, and only those', 'a split missing a live work order is refused');
select throws_ok($$ select public.set_shared_cost_split('25190000-0000-0000-0000-0000000000d1',
                    '[{"work_order_id":"25190000-0000-0000-0000-000000000401","percent":"50.00001"},{"work_order_id":"25190000-0000-0000-0000-000000000402","percent":"49.99999"}]') $$,
  '22023', 'WPVA_SPLIT_PERCENT: each percentage is 0 to 100 with up to 4 decimals', 'a percentage with 5 decimals is refused');
select is(public.set_shared_cost_split('25190000-0000-0000-0000-0000000000d1',
            '[{"work_order_id":"25190000-0000-0000-0000-000000000401","percent":"33.3333"},{"work_order_id":"25190000-0000-0000-0000-000000000402","percent":"66.6667"}]'),
  2, 'Finance saves a split that sums to exactly 100');
select is((select sum(percent) from public.project_shared_cost_splits where project_id = '25190000-0000-0000-0000-0000000000d1'), 100.0000::numeric,
  'the saved split sums to 100');
select pg_temp.act_as('25190000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.clear_shared_cost_split('25190000-0000-0000-0000-0000000000d1') $$, 'P0002', 'project not found',
  'another org cannot clear the split');
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a1');
select is(public.clear_shared_cost_split('25190000-0000-0000-0000-0000000000d1'), 2, 'an Admin clears the split (back to the default)');
reset role;
select is((select count(*)::int from public.audit_events where entity_id = '25190000-0000-0000-0000-0000000000d1'
            and action in ('shared_cost_split.set', 'shared_cost_split.clear')), 2, 'FR-WPVA-022 each split change is audited');
select is((select count(*)::int from information_schema.role_table_grants
            where table_name = 'project_shared_cost_splits' and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0,
  'the split is written only through its RPCs');

select set_eq($$ select privilege_type::text from information_schema.role_table_grants
                 where table_schema = 'public' and table_name = 'work_order_plan_lines' and grantee = 'authenticated' $$,
              $$ values ('SELECT'::text), ('DELETE'::text) $$,
  'plan-line table grants expose select and delete; inserts and updates use column grants');
select is((select count(distinct cmd)::int from pg_policies
            where schemaname = 'public' and tablename = 'work_order_plan_lines'
              and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')), 4,
  'plan-line RLS has separate policies for all four operations');
select ok(not has_function_privilege('anon', 'public.set_shared_cost_split(uuid,jsonb)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.clear_shared_cost_split(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.set_work_order_plan(uuid,uuid,jsonb)', 'EXECUTE'),
  'anonymous callers cannot execute either split writer');

-- A plan form is a single transaction even when one figure is invalid.
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.set_work_order_plan('25190000-0000-0000-0000-0000000000d1',
 '25190000-0000-0000-0000-000000000401', '[{"kind":"crew_hours","value":"1"}]') $$,
 '42501', 'not authorized', 'an Engineer cannot save a plan form');
select pg_temp.act_as('25190000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.set_work_order_plan('25190000-0000-0000-0000-0000000000d1',
 '25190000-0000-0000-0000-000000000401', '[{"kind":"crew_hours","value":"1"}]') $$,
 'P0002', 'work order not found', 'another organisation cannot save a plan form');
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.set_work_order_plan('25190000-0000-0000-0000-0000000000d1',
 '25190000-0000-0000-0000-000000000401',
 '[{"kind":"direct_budget","value":"500"},{"kind":"crew_hours","value":"10"}]') $$,
 'a plan form saves all its figures');
select throws_ok($$ select public.set_work_order_plan('25190000-0000-0000-0000-0000000000d1',
 '25190000-0000-0000-0000-000000000401',
 '[{"kind":"direct_budget","value":"700"},{"kind":"crew_hours","value":"-1"}]') $$,
 '23514', null, 'an invalid figure rejects the entire plan form');
select is((select value from public.work_order_plan_lines where work_order_id = '25190000-0000-0000-0000-000000000401'
 and kind = 'direct_budget' and discipline_id is null), 500::numeric,
 'a rejected plan form leaves the earlier figure unchanged');
select lives_ok($$ select public.set_work_order_plan('25190000-0000-0000-0000-0000000000d1',
 '25190000-0000-0000-0000-000000000401', '[{"kind":"direct_budget","value":"99999999999999.99"}]') $$,
 'the plan form accepts a large exact amount');
select is((select value::text from public.work_order_plan_lines where work_order_id = '25190000-0000-0000-0000-000000000401'
 and kind = 'direct_budget' and discipline_id is null), '99999999999999.99',
 'the plan form preserves every cent of a large amount');
reset role;

-- Two bills of one purchase, paid in different proportions and assigned to different work orders.
set local session_replication_role = replica;
delete from public.payments where id in ('25190000-0000-0000-0000-000000000641', '25190000-0000-0000-0000-000000000642', '25190000-0000-0000-0000-000000000643', '25190000-0000-0000-0000-000000000644');
update public.procurements set budget_category = 'Materials' where id = '25190000-0000-0000-0000-000000000601';
update public.procurement_invoices set work_order_id = '25190000-0000-0000-0000-000000000402'
 where id = '25190000-0000-0000-0000-000000000622';
insert into public.payments (id, org_id, procurement_id, invoice_id, status, amount, currency) values
 ('25190000-0000-0000-0000-000000000631', '25190000-0000-0000-0000-00000000000a',
  '25190000-0000-0000-0000-000000000601', '25190000-0000-0000-0000-000000000621', 'Paid', 277.50, 'IDR'),
 ('25190000-0000-0000-0000-000000000632', '25190000-0000-0000-0000-00000000000a',
  '25190000-0000-0000-0000-000000000601', '25190000-0000-0000-0000-000000000622', 'Paid', 111, 'IDR');
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
select is((select sum(amount::numeric) from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1') where reason in ('counted', 'unassigned', 'split-when-custom')),
  (select (public.get_project_finances('25190000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric),
  'AC-WPVA-012 paid cost equals project actuals, not unpaid bills or stock issues');
select is((select sum(amount::numeric) from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
 where reason = 'counted' and work_order_id = '25190000-0000-0000-0000-000000000401'), 250::numeric,
 'AC-WPVA-012 the partially paid first bill follows its work order');
select is((select sum(amount::numeric) from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
 where reason = 'counted' and work_order_id = '25190000-0000-0000-0000-000000000402'), 100::numeric,
 'AC-WPVA-012 the second bill on the same purchase follows its own work order');
reset role;

-- A missing bill amount does not hide a project actual that the paid-purchase basis can determine.
set local session_replication_role = replica;
insert into public.projects (id, org_id, name, status, currency, pmo_project_number)
values ('25190000-0000-0000-0000-0000000000d3', '25190000-0000-0000-0000-00000000000a', 'Unresolved bill project', 'Ongoing Project', 'IDR', 'WPVA-UNKNOWN');
insert into public.work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency)
values ('25190000-0000-0000-0000-000000000405', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-0000000000d3',
 'WO-U', 'Unknown direct cost', 'Issued', 100, 'exclusive', 0, 'IDR');
insert into public.procurements (id, org_id, title, project_id, status, total_value, currency, budget_category)
values ('25190000-0000-0000-0000-000000000606', '25190000-0000-0000-0000-00000000000a', 'Unresolved purchase',
 '25190000-0000-0000-0000-0000000000d3', 'Ordered', 20, 'IDR', 'Materials');
insert into public.procurement_invoices (id, org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount, work_order_id)
values ('25190000-0000-0000-0000-000000000628', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000606',
 'Received', null, 'IDR', 'exclusive', 0, '25190000-0000-0000-0000-000000000405');
insert into public.payments (id, org_id, procurement_id, invoice_id, status, amount, currency)
values ('25190000-0000-0000-0000-000000000634', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000606',
 '25190000-0000-0000-0000-000000000628', 'Paid', 20, 'IDR');
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
select ok((select reason = 'unresolved-direct' and amount is null from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d3')
            where record_id = '25190000-0000-0000-0000-000000000628'),
  'a bill without an amount leaves the work-order cost unknown');
select is((select sum(amount::numeric) from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d3')
            where reason in ('counted', 'unassigned', 'split-when-custom')),
          (select (public.get_project_finances('25190000-0000-0000-0000-0000000000d3')->'actuals'->>'total')::numeric),
  'AC-WPVA-012 the known paid total remains visible as unassigned');
reset role;

-- A paid bill in another currency remains visible separately and never becomes project-currency cost.
set local session_replication_role = replica;
insert into public.procurements (id, org_id, title, project_id, status, total_value, currency, budget_category)
values ('25190000-0000-0000-0000-000000000605', '25190000-0000-0000-0000-00000000000a', 'Foreign purchase',
 '25190000-0000-0000-0000-0000000000d2', 'Ordered', 25, 'USD', 'Materials');
insert into public.procurement_invoices (id, org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount, work_order_id)
values ('25190000-0000-0000-0000-000000000627', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000605',
 'Received', 25, 'USD', 'exclusive', 0, '25190000-0000-0000-0000-000000000404');
insert into public.payments (id, org_id, procurement_id, invoice_id, status, amount, currency)
values ('25190000-0000-0000-0000-000000000633', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000605',
 '25190000-0000-0000-0000-000000000627', 'Paid', 25, 'USD');
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
select ok((select currency = 'USD' and amount::numeric = 25 from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d2')
            where source = 'vendor_bill' and record_id = '25190000-0000-0000-0000-000000000627'),
  'AC-WPVA-010 a foreign-currency paid bill is shown in its own currency');
select ok((select amount is null from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d2')
            where source = 'project_actuals' and currency = 'IDR'),
  'AC-WPVA-010 the project-currency total remains unknown');
reset role;

-- Equipment is priced once per asset-month, then assigned to its usage entries without losing the cent.
set local session_replication_role = replica;
insert into public.equipment_costing_settings (org_id, asset_id, setting_key, version, basis, work_rate, rate_unit, charge_category, effective_from)
values ('25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000901',
        '25190000-0000-0000-0000-000000000902', 1, 'hire_rate', 0.01, 'hours', 'Equipment', '2026-01-01');
update public.equipment_usage_entries set status = 'Approved', quantity = 0.5,
       work_order_id = '25190000-0000-0000-0000-000000000401', approved_at = now()
 where id = '25190000-0000-0000-0000-000000000911';
insert into public.equipment_usage_entries (id, org_id, asset_id, project_id, work_date, quantity, unit, kind, status,
 author_id, approver_id, approved_at, work_order_id) values
 ('25190000-0000-0000-0000-000000000912', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000901',
  '25190000-0000-0000-0000-0000000000d1', '2026-11-17', 0.5, 'hours', 'work', 'Approved',
  '25190000-0000-0000-0000-0000000000a4', '25190000-0000-0000-0000-0000000000a1', now(),
  '25190000-0000-0000-0000-000000000402'),
 ('25190000-0000-0000-0000-000000000913', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000901',
  '25190000-0000-0000-0000-0000000000d1', '2026-11-17', 1, 'hours', 'standby', 'Approved',
  '25190000-0000-0000-0000-0000000000a4', '25190000-0000-0000-0000-0000000000a1', now(),
  '25190000-0000-0000-0000-000000000402');
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
select is((select sum(amount::numeric) from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
            where source = 'equipment_usage' and reason = 'counted'), 0.01::numeric,
  'AC-WPVA-012 equipment allocations equal the asset-month charge');
select is((select amount::numeric from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
            where source = 'equipment_usage' and record_id = '25190000-0000-0000-0000-000000000911'), 0.01::numeric,
  'the first equipment entry retains its rounded cent');
select is((select amount::numeric from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
            where source = 'equipment_usage' and record_id = '25190000-0000-0000-0000-000000000913'), 0::numeric,
  'zero-rate usage never receives a negative rounding remainder');
select is((select sum(amount::numeric) from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
            where work_order_id = '25190000-0000-0000-0000-000000000401' and reason = 'counted'), 250.01::numeric,
  'AC-WPVA-003 paid bills and equipment charges sum to the work-order cost');
select is((select array[sum(amount::numeric) filter (where source = 'vendor_bill'),
                         sum(amount::numeric) filter (where source = 'equipment_usage')]
             from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
            where work_order_id = '25190000-0000-0000-0000-000000000401' and reason = 'counted'), array[250, 0.01]::numeric[],
  'AC-WPVA-003 the reachable source amounts are the bill and equipment charge');
select is((select sum(amount::numeric) from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
            where reason in ('counted', 'unassigned', 'split-when-custom')),
          (select (public.get_project_finances('25190000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric),
  'AC-WPVA-012 purchase and equipment amounts equal the project actual');
reset role;

-- An ERP ledger project uses the ledger actual, not the PMO purchase records above.
set local session_replication_role = replica;
insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
values ('25190000-0000-0000-0000-00000000000a', 'erpnext', 'https://erp.example.test', 'test-ref', 'active',
        '25190000-0000-0000-0000-0000000000a1', now());
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target)
values ('25190000-0000-0000-0000-00000000000a', 'Materials', 'WPVA-MATERIALS', true);
insert into public.erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at)
values ('25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-0000000000d1', 'WPVA-MATERIALS',
        'FY-2026', 125, now(), '25190000-0000-0000-0000-0000000000e1', now());
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
select is((select sum(amount::numeric) from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
            where reason in ('counted', 'unassigned', 'split-when-custom')),
          (select (public.get_project_finances('25190000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric),
  'AC-WPVA-012 ERP cost equals the project actuals ledger basis');
select is((select amount::numeric from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
            where source = 'project_actuals' and reason = 'split-when-custom'), 125::numeric,
  'unlinked ERP actuals stay separate for an explicit custom split');
reset role;

-- Project and contract work revenue includes other billing, which remains visible as a separate component.
set local session_replication_role = replica;
insert into public.sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount, currency, status, billing_kind) values
 ('25190000-0000-0000-0000-000000000a11', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-0000000000d1',
  '2026-11-18', 30, 'exclusive', 0, 'IDR', 'Submitted', 'other'),
 ('25190000-0000-0000-0000-000000000a12', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-0000000000d1',
  '2026-11-18', 170, 'exclusive', 0, 'IDR', 'Submitted', 'contract');
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
select is((select amount::numeric from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
            where source = 'other_revenue' and currency = 'IDR'), 30::numeric,
  'other billed work is stated separately, without contract-billing invoices');
select is((select (x->>'work_revenue')::numeric from jsonb_array_elements(public.get_project_finances('25190000-0000-0000-0000-0000000000d1')->'invoices') x
            where x->>'currency' = 'IDR'), 200::numeric,
  'project work revenue still includes both contract and other billing');
reset role;

-- Mutation check: a wrong project total must be distinguishable from the authoritative read.
do $$
declare original text; mutant text;
begin
  select pg_get_functiondef('public.work_order_cost_amounts(uuid)'::regprocedure) into original;
  mutant := replace(original, 'v_actual := (v_fin->>''total'')::numeric;',
                    'v_actual := (v_fin->>''total'')::numeric + 1;');
  if mutant = original then raise exception 'mutation did not apply'; end if;
  execute mutant;
end $$;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a2');
select isnt((select sum(amount::numeric) from public.work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1')
              where reason in ('counted', 'unassigned', 'split-when-custom')),
            (select (public.get_project_finances('25190000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric),
  'AC-WPVA-012 mutation: changing the cost total breaks equality with project actuals');
reset role;

-- Security mutation: remove the form role gate and its table-policy defenses inside this rollback-only test.
-- The earlier Engineer-denial assertion must distinguish the live controls from this deliberately broken pair.
do $$
declare original text; mutant text;
begin
  select pg_get_functiondef('public.set_work_order_plan(uuid,uuid,jsonb)'::regprocedure) into original;
  mutant := replace(original,
    $guard$if not public.is_active_member() or public.auth_role() is null
     or public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager') then$guard$,
    'if false then');
  if mutant = original then raise exception 'security mutation did not apply'; end if;
  execute mutant;
end $$;
alter policy work_order_plan_lines_select on public.work_order_plan_lines using (true);
alter policy work_order_plan_lines_insert on public.work_order_plan_lines with check (true);
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a4');
select lives_ok($$ select public.set_work_order_plan('25190000-0000-0000-0000-0000000000d1',
 '25190000-0000-0000-0000-000000000401', '[{"kind":"equipment_hours","value":"1"}]') $$,
 'security mutation: an Engineer can write only after both role and RLS checks are broken');
reset role;

-- Mutation check of the separation of duties on the split RPC (rolled back with this test).
do $$
declare original text; mutant text;
begin
  select pg_get_functiondef('public.set_shared_cost_split(uuid,jsonb)'::regprocedure) into original;
  mutant := replace(original,
    $guard$if public.auth_role() is null or public.auth_role() not in ('Admin', 'Executive', 'Finance') then$guard$,
    'if false then');
  if mutant = original then raise exception 'split role mutation did not apply'; end if;
  execute mutant;
end $$;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.set_shared_cost_split('25190000-0000-0000-0000-0000000000d1',
 '[{"work_order_id":"25190000-0000-0000-0000-000000000401","percent":"50"},{"work_order_id":"25190000-0000-0000-0000-000000000402","percent":"50"}]') $$,
 'AC-WPVA-015 mutation: the Project Manager can set a split when the role gate is removed');
reset role;

select * from finish();
rollback;
