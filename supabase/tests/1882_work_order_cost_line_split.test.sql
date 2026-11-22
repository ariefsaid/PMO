-- 1882_work_order_cost_line_split.test.sql — cost follows the purchase line (docs/specs/wo-per-purchase-line.spec.md).
-- Migrations under test: 1880, 1881_procurement_line_cost_parts.sql, 1882_work_order_cost_line_split.sql.
-- AC-WPL-004 a paid bill splits across lines by line value; a line's OWN work order wins, a line with none takes the record-level
-- default (bill, PO, receipt, request); the parts sum to the cost exactly (odd split: largest remainder) ·
-- AC-WPL-005 a line's own work order wins over the bill's · AC-WPL-006 a purchase whose lines name nothing returns the rows it
-- returned before, and naming lines never changes the project total · AC-WPL-007 the paid amount not on a bill splits the same
-- way; lines of no value never divide by zero · AC-WPL-008 the document lists (work_order_cost_lines) keep each record under its
-- own work order (they carry no money, so splitting them would double-count a record's amount).
--
-- MUTATION CHECKS (money rule; each must turn this file RED, then be restored):
--   1. In 1882's bill_amounts, replace the `whole_cents + case when ... then 1 else 0 end` allocation by `whole_cents` alone
--      (drop the largest-remainder step)            -> the 'parts sum exactly' and 'odd split' tests go red.
--   2. In 1881's procurement_line_parts, change `coalesce(l.own, p_default_wo)` to `coalesce(p_default_wo, l.own)` (the record-level
--      value beats the line's own)                   -> the 'own work order wins over the bill' test goes red.
--   3. In 1881, drop the `t.total > 0` guard of the lined branch   -> the 'lines of no value' test errors / goes red.
--   4. In 1882, make bill_amounts read bill_base directly (no split)  -> every split test goes red.
begin;
create extension if not exists pgtap;
select plan(22);

insert into organizations (id, name, default_currency) values ('18820000-0000-0000-0000-00000000000a', 'WPL Split Org', 'IDR');
insert into auth.users (id, email) values ('18820000-0000-0000-0000-0000000000a3', 'wpl-split-pm@example.com'), ('18820000-0000-0000-0000-0000000000a4', 'wpl-split-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18820000-0000-0000-0000-0000000000a3', '18820000-0000-0000-0000-00000000000a', 'WPL PM', 'wpl-split-pm@example.com', 'Project Manager', 'active'),
  ('18820000-0000-0000-0000-0000000000a4', '18820000-0000-0000-0000-00000000000a', 'WPL Eng', 'wpl-split-eng@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values ('18820000-0000-0000-0000-0000000000d1', '18820000-0000-0000-0000-00000000000a', 'WPL Split Site', 'Ongoing Project', '18820000-0000-0000-0000-0000000000a3', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('18820000-0000-0000-0000-000000000401', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-0000000000d1', 'WO-1', 'WPL WO one',   'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('18820000-0000-0000-0000-000000000402', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-0000000000d1', 'WO-2', 'WPL WO two',   'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('18820000-0000-0000-0000-000000000403', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-0000000000d1', 'WO-3', 'WPL WO three', 'Issued', 10000, 'exclusive', 0, 'IDR');
set local session_replication_role = replica;
insert into cost_disciplines (id, org_id, code, name, archived_at) values ('18820000-0000-0000-0000-000000000501', '18820000-0000-0000-0000-00000000000a', 'CIV', 'Civil', null);
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, currency) values
  ('18820000-0000-0000-0000-000000000601', '18820000-0000-0000-0000-00000000000a', 'WPL split two lines', '18820000-0000-0000-0000-0000000000d1', '18820000-0000-0000-0000-0000000000a4', 'Ordered', 0, 0, 'IDR'),
  ('18820000-0000-0000-0000-000000000602', '18820000-0000-0000-0000-00000000000a', 'WPL odd split', '18820000-0000-0000-0000-0000000000d1', '18820000-0000-0000-0000-0000000000a4', 'Ordered', 0, 0, 'IDR'),
  ('18820000-0000-0000-0000-000000000603', '18820000-0000-0000-0000-00000000000a', 'WPL bill on a work order', '18820000-0000-0000-0000-0000000000d1', '18820000-0000-0000-0000-0000000000a4', 'Ordered', 0, 0, 'IDR'),
  ('18820000-0000-0000-0000-000000000604', '18820000-0000-0000-0000-00000000000a', 'WPL paid without a bill', '18820000-0000-0000-0000-0000000000d1', '18820000-0000-0000-0000-0000000000a4', 'Ordered', 0, 0, 'IDR'),
  ('18820000-0000-0000-0000-000000000605', '18820000-0000-0000-0000-00000000000a', 'WPL lines name nothing', '18820000-0000-0000-0000-0000000000d1', '18820000-0000-0000-0000-0000000000a4', 'Ordered', 0, 0, 'IDR'),
  ('18820000-0000-0000-0000-000000000606', '18820000-0000-0000-0000-00000000000a', 'WPL lines of no value', '18820000-0000-0000-0000-0000000000d1', '18820000-0000-0000-0000-0000000000a4', 'Ordered', 0, 0, 'IDR');
update public.procurements set budget_category = 'Materials' where org_id = '18820000-0000-0000-0000-00000000000a';
insert into purchase_requests (id, org_id, procurement_id, pr_number, status, date, currency) values
  ('18820000-0000-0000-0000-000000000611', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000601', 'PR-WPL-1', 'Approved', '2026-11-16', 'IDR');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency, voided_at) values
  ('18820000-0000-0000-0000-000000000621', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000601', 'VI-1', '2026-11-16', 'Received', 1000, 'exclusive', 0, 'IDR', null),
  ('18820000-0000-0000-0000-000000000622', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000602', 'VI-2', '2026-11-16', 'Received', 100, 'exclusive', 0, 'IDR', null),
  ('18820000-0000-0000-0000-000000000623', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000603', 'VI-3', '2026-11-16', 'Received', 1000, 'exclusive', 0, 'IDR', null),
  ('18820000-0000-0000-0000-000000000625', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000605', 'VI-5', '2026-11-16', 'Received', 250, 'exclusive', 0, 'IDR', null),
  ('18820000-0000-0000-0000-000000000626', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000606', 'VI-6', '2026-11-16', 'Received', 70, 'exclusive', 0, 'IDR', null);
insert into public.payments (id, org_id, procurement_id, invoice_id, status, amount, currency) values
  ('18820000-0000-0000-0000-000000000641', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000601', '18820000-0000-0000-0000-000000000621', 'Paid', 1000, 'IDR'),
  ('18820000-0000-0000-0000-000000000642', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000602', '18820000-0000-0000-0000-000000000622', 'Paid', 100, 'IDR'),
  ('18820000-0000-0000-0000-000000000643', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000603', '18820000-0000-0000-0000-000000000623', 'Paid', 1000, 'IDR'),
  ('18820000-0000-0000-0000-000000000644', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000604', null, 'Paid', 500, 'IDR'),
  ('18820000-0000-0000-0000-000000000645', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000605', '18820000-0000-0000-0000-000000000625', 'Paid', 250, 'IDR'),
  ('18820000-0000-0000-0000-000000000646', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000606', '18820000-0000-0000-0000-000000000626', 'Paid', 70, 'IDR');
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('18820000-0000-0000-0000-0000000006a1', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000601', 'L1', 1, 600),
  ('18820000-0000-0000-0000-0000000006a2', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000601', 'L2', 1, 400),
  ('18820000-0000-0000-0000-0000000006a3', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000602', 'L3', 1, 100),
  ('18820000-0000-0000-0000-0000000006a4', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000602', 'L4', 1, 100),
  ('18820000-0000-0000-0000-0000000006a5', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000602', 'L5', 1, 100),
  ('18820000-0000-0000-0000-0000000006a6', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000603', 'L6', 1, 600),
  ('18820000-0000-0000-0000-0000000006a7', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000603', 'L7', 1, 400),
  ('18820000-0000-0000-0000-0000000006a8', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000604', 'L8', 1, 300),
  ('18820000-0000-0000-0000-0000000006a9', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000604', 'L9', 1, 200),
  ('18820000-0000-0000-0000-0000000006b0', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000605', 'L10', 1, 400),
  ('18820000-0000-0000-0000-0000000006b1', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000605', 'L11', 1, 100),
  ('18820000-0000-0000-0000-0000000006b2', '18820000-0000-0000-0000-00000000000a', '18820000-0000-0000-0000-000000000606', 'L12', 1, 0);
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('18820000-0000-0000-0000-0000000000a3');

-- Record-level attribution as shipped today: the request record of purchase 1 on WO-2 (Civil), purchase 3's bill on WO-3,
-- purchase 5's bill on WO-1.
select is(public.set_cost_attribution('purchase_request', array['18820000-0000-0000-0000-000000000611']::uuid[], '18820000-0000-0000-0000-000000000402', '18820000-0000-0000-0000-000000000501'), 1, 'fixture: the request record names WO-2 / Civil');
select is(public.set_cost_attribution('vendor_bill', array['18820000-0000-0000-0000-000000000623']::uuid[], '18820000-0000-0000-0000-000000000403', null), 1, 'fixture: the bill of purchase 3 names WO-3');
select is(public.set_cost_attribution('vendor_bill', array['18820000-0000-0000-0000-000000000625']::uuid[], '18820000-0000-0000-0000-000000000401', null), 1, 'fixture: the bill of purchase 5 names WO-1');

-- BEFORE: no line names a work order. Rows are exactly today's record-level chain.
create temp table wpl_before as select * from public.work_order_cost_amounts('18820000-0000-0000-0000-0000000000d1');
grant all on wpl_before to authenticated;
select is((select jsonb_agg(jsonb_build_array(work_order_id, amount::numeric)) from wpl_before where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000621'),
  jsonb_build_array(jsonb_build_array('18820000-0000-0000-0000-000000000402'::uuid, 1000.00)),
  'AC-WPL-006 no line names a work order: bill 1 is one row on the request record''s work order, as today');
select is((select jsonb_agg(jsonb_build_array(work_order_id, amount::numeric)) from wpl_before where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000623'),
  jsonb_build_array(jsonb_build_array('18820000-0000-0000-0000-000000000403'::uuid, 1000.00)),
  'AC-WPL-006 and bill 3 is one row on its own work order, as today');
select is((select count(*)::int from wpl_before where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000622'), 1,
  'AC-WPL-006 an unattributed bill with unnamed lines stays one row');
select is((select sum(amount::numeric) from wpl_before where reason in ('counted', 'unassigned', 'split-when-custom')),
  (select (public.get_project_finances('18820000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric), 'fixture: the before-total is the project actuals');

-- Name the lines (every write through the rule trigger).
select is(public.set_cost_attribution('procurement_item', array['18820000-0000-0000-0000-0000000006a1', '18820000-0000-0000-0000-0000000006a6', '18820000-0000-0000-0000-0000000006a3']::uuid[], '18820000-0000-0000-0000-000000000401', null), 3, 'fixture: lines L1, L6, L3 name WO-1');
select is(public.set_cost_attribution('procurement_item', array['18820000-0000-0000-0000-0000000006a4', '18820000-0000-0000-0000-0000000006a8', '18820000-0000-0000-0000-0000000006b2']::uuid[], '18820000-0000-0000-0000-000000000402', null), 3, 'fixture: lines L4, L8, L12 name WO-2');

create temp table wpl_rows as select * from public.work_order_cost_amounts('18820000-0000-0000-0000-0000000000d1');
grant all on wpl_rows to authenticated;

-- AC-WPL-004 purchase 1: L1 600 (own WO-1) + L2 400 (none -> the request record's WO-2)
select is((select jsonb_object_agg(work_order_id, amount::numeric) from wpl_rows where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000621' and reason = 'counted'),
  jsonb_build_object('18820000-0000-0000-0000-000000000401'::text, 600.00, '18820000-0000-0000-0000-000000000402'::text, 400.00),
  'AC-WPL-004 the 1,000 bill splits 600 to the line''s own work order and 400 to the request''s');
select is((select sum(amount::numeric) from wpl_rows where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000621'), 1000.00::numeric,
  'AC-WPL-004 the parts sum to the bill exactly');
select is((select discipline_id from wpl_rows where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000621' and work_order_id = '18820000-0000-0000-0000-000000000402'), '18820000-0000-0000-0000-000000000501'::uuid,
  'AC-WPL-004 the defaulted part keeps the record-level discipline');
select is((select discipline_id from wpl_rows where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000621' and work_order_id = '18820000-0000-0000-0000-000000000401'), null::uuid,
  'AC-WPL-004 a line''s own work order carries no discipline');
-- odd split: three equal lines, 100.00 -> 33.34 / 33.33 / 33.33 (largest remainder, ties by work order, none last)
select is((select sum(amount::numeric) from wpl_rows where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000622'), 100.00::numeric,
  'AC-WPL-004 an odd three-way split still sums to exactly 100.00');
select is((select array_agg(amount::numeric order by work_order_id nulls last) from wpl_rows where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000622'),
  array[33.34, 33.33, 33.33]::numeric[], 'AC-WPL-004 the odd cent goes by largest remainder, ties by work order');
select is((select reason from wpl_rows where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000622' and work_order_id is null), 'unassigned',
  'AC-WPL-004 the defaulted part with no record-level work order is reported unassigned');
-- AC-WPL-005 the bill is on WO-3; L6 (600) is on WO-1 and wins; L7 (none) takes the bill's WO-3
select is((select jsonb_object_agg(work_order_id, amount::numeric) from wpl_rows where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000623' and reason = 'counted'),
  jsonb_build_object('18820000-0000-0000-0000-000000000401'::text, 600.00, '18820000-0000-0000-0000-000000000403'::text, 400.00),
  'AC-WPL-005 a line''s own work order wins over the bill''s; a line with none takes the bill''s');
-- AC-WPL-007 paid without a bill: 500 = L8 300 (WO-2) + L9 200 (none, no record-level work order)
select is((select jsonb_agg(jsonb_build_array(work_order_id, amount::numeric, reason) order by work_order_id nulls last) from wpl_rows where source = 'purchase_balance' and record_id = '18820000-0000-0000-0000-000000000604'),
  jsonb_build_array(jsonb_build_array('18820000-0000-0000-0000-000000000402'::uuid, 300.00, 'counted'), jsonb_build_array(null, 200.00, 'unassigned')),
  'AC-WPL-007 the paid amount not on a bill splits by line value the same way');
-- AC-WPL-006 no line of purchase 5 names a work order: still one row on the bill's work order
select is((select jsonb_agg(jsonb_build_array(work_order_id, amount::numeric)) from wpl_rows where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000625'),
  jsonb_build_array(jsonb_build_array('18820000-0000-0000-0000-000000000401'::uuid, 250.00)), 'AC-WPL-006 a purchase whose lines name nothing is unchanged after other lines were named');
-- AC-WPL-007 lines of no value: L12 names WO-2 but the lines total 0 -> the bill is one row, no division by zero
select is((select jsonb_agg(jsonb_build_array(work_order_id, amount::numeric, reason)) from wpl_rows where source = 'vendor_bill' and record_id = '18820000-0000-0000-0000-000000000626'),
  jsonb_build_array(jsonb_build_array(null, 70.00, 'unassigned')), 'AC-WPL-007 lines of no value never divide: the bill stays one unassigned row');
-- AC-WPL-006 naming lines never changes the project total
select is((select sum(amount::numeric) from wpl_rows where reason in ('counted', 'unassigned', 'split-when-custom')),
  (select sum(amount::numeric) from wpl_before where reason in ('counted', 'unassigned', 'split-when-custom')),
  'AC-WPL-006 the project total is the same before and after the lines name work orders');
-- AC-WPL-008 the document list keeps the request record under its own work order, once
select is((select jsonb_agg(work_order_id) from public.work_order_cost_lines where source = 'purchase_request' and record_id = '18820000-0000-0000-0000-000000000611'), jsonb_build_array('18820000-0000-0000-0000-000000000402'::uuid),
  'AC-WPL-008 the request record is listed once, under its own work order (the money is in the amounts read)');

select * from finish();
rollback;
