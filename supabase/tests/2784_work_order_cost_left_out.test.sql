-- 2784_work_order_cost_left_out.test.sql — #3026: work order direct cost shows what it leaves out.
-- Migration under test: 2784_work_order_cost_left_out.sql.
-- Mutation checks:
--   mut:hide_prices — set v_show_prices := true; the price-hidden role test goes red (returns totals instead of null).
--   mut:pm_scope    — remove project_money_in_scope(v_project_id); PM of another project reads WO instead of P0002.
--   mut:unlinked_cap — drop the unlinked-payment subtraction in bill_purchase; test 4 goes red (unpaid bill total 2,000,000).
--   mut:draft_po    — drop the Draft exclusion from open_pos; test 4 goes red (purchase order count 3).
begin;
create extension if not exists pgtap;
select no_plan();

insert into organizations (id, name, default_currency, built_in_roles_enabled, hide_prices_from_requesters) values
  ('27840000-0000-0000-0000-00000000000a', 'WO Left Out Org',       'IDR', true, true),
  ('27840000-0000-0000-0000-00000000000b', 'WO Left Out Other Org', 'IDR', true, false);

insert into auth.users (id, email) values
  ('27840000-0000-0000-0000-0000000000a1', 'wo2784-admin@example.com'),
  ('27840000-0000-0000-0000-0000000000a2', 'wo2784-pcm@example.com'),
  ('27840000-0000-0000-0000-0000000000a3', 'wo2784-pm-own@example.com'),
  ('27840000-0000-0000-0000-0000000000a4', 'wo2784-pm-other@example.com'),
  ('27840000-0000-0000-0000-0000000000a5', 'wo2784-pm-hidden@example.com'),
  ('27840000-0000-0000-0000-0000000000a6', 'wo2784-eng@example.com'),
  ('27840000-0000-0000-0000-0000000000a7', 'wo2784-light@example.com'),
  ('27840000-0000-0000-0000-0000000000b1', 'wo2784-xorg@example.com');

-- profiles_built_in_role_sync sets role from the built-in role's base (PCM and Construction Manager -> Project Manager; Foreman -> Engineer).
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27840000-0000-0000-0000-0000000000a1', '27840000-0000-0000-0000-00000000000a', 'Admin',        'wo2784-admin@example.com',     'Admin',           'active', null),
  ('27840000-0000-0000-0000-0000000000a2', '27840000-0000-0000-0000-00000000000a', 'PCM',          'wo2784-pcm@example.com',       'Project Manager', 'active', 'project_control_manager'),
  ('27840000-0000-0000-0000-0000000000a3', '27840000-0000-0000-0000-00000000000a', 'PM Own',       'wo2784-pm-own@example.com',    'Project Manager', 'active', null),
  ('27840000-0000-0000-0000-0000000000a4', '27840000-0000-0000-0000-00000000000a', 'PM Other',     'wo2784-pm-other@example.com',  'Project Manager', 'active', null),
  ('27840000-0000-0000-0000-0000000000a5', '27840000-0000-0000-0000-00000000000a', 'PM Hidden',    'wo2784-pm-hidden@example.com', 'Project Manager', 'active', 'construction_manager'),
  ('27840000-0000-0000-0000-0000000000a6', '27840000-0000-0000-0000-00000000000a', 'Engineer',     'wo2784-eng@example.com',       'Engineer',        'active', null),
  ('27840000-0000-0000-0000-0000000000a7', '27840000-0000-0000-0000-00000000000a', 'Field Light',  'wo2784-light@example.com',     'Engineer',        'active', 'foreman'),
  ('27840000-0000-0000-0000-0000000000b1', '27840000-0000-0000-0000-00000000000b', 'XOrg Admin',   'wo2784-xorg@example.com',      'Admin',           'active', null);

-- Every built-in money role sees prices in the shipped catalogue, so the price-hidden money reader is made by withdrawing the
-- capability from Construction Manager inside this rolled-back test (the org hides prices from requesters).
delete from built_in_role_capabilities where role_key = 'construction_manager' and capability = 'sees_prices';

-- Project 1 managed by a3 (with a5 as deputy so a5 is in project_money_in_scope); Project 2 managed by a4.
insert into projects (id, org_id, name, status, project_manager_id, deputy_manager_id, currency) values
  ('27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-00000000000a', 'Proj 1', 'Ongoing Project', '27840000-0000-0000-0000-0000000000a3', '27840000-0000-0000-0000-0000000000a5', 'IDR'),
  ('27840000-0000-0000-0000-000000000102', '27840000-0000-0000-0000-00000000000a', 'Proj 2', 'Ongoing Project', '27840000-0000-0000-0000-0000000000a4', null, 'IDR');

insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('27840000-0000-0000-0000-000000000201', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000101', 'WO-1', 'Active WO', 'Issued', 50000000, 'exclusive', 0, 'IDR'),
  ('27840000-0000-0000-0000-000000000202', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000101', 'WO-2', 'Clean WO',  'Issued', 10000000, 'exclusive', 0, 'IDR');

set local session_replication_role = replica;

-- 1. Purchases:
--   P1: unpaid supplier bill (exclusive 1,000,000 + 110,000 tax) -> unpaid_bill = 1,000,000.00
--   P2: PO ordered (2,500,000) + GR received, no bill, no payment -> purchase_order = 2,500,000.00, goods_receipt = count 1 (null total)
--   P3: fully paid bill (500,000) -> NOT left out
insert into procurements (id, org_id, title, project_id, work_order_id, requested_by_id, status, total_value, approved_total_value, currency) values
  ('27840000-0000-0000-0000-000000000301', '27840000-0000-0000-0000-00000000000a', 'Steel unpaid', '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '27840000-0000-0000-0000-0000000000a1', 'Vendor Invoiced', 1000000, 1000000, 'IDR'),
  ('27840000-0000-0000-0000-000000000302', '27840000-0000-0000-0000-00000000000a', 'Cement PO',    '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '27840000-0000-0000-0000-0000000000a1', 'Received',        2500000, 2500000, 'IDR'),
  ('27840000-0000-0000-0000-000000000303', '27840000-0000-0000-0000-00000000000a', 'Paint paid',   '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '27840000-0000-0000-0000-0000000000a1', 'Paid',             500000,  500000, 'IDR');

insert into purchase_orders (id, org_id, procurement_id, po_number, date, status, amount, currency, work_order_id) values
  ('27840000-0000-0000-0000-000000000311', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000301', 'PO-1', '2026-11-10', 'Issued', 1000000, 'IDR', '27840000-0000-0000-0000-000000000201'),
  ('27840000-0000-0000-0000-000000000312', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000302', 'PO-2', '2026-11-11', 'Issued', 2500000, 'IDR', '27840000-0000-0000-0000-000000000201');

insert into procurement_receipts (id, org_id, procurement_id, po_id, gr_number, receipt_date, status, work_order_id) values
  ('27840000-0000-0000-0000-000000000322', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000302', '27840000-0000-0000-0000-000000000312', 'GR-2', '2026-11-12', 'Complete', '27840000-0000-0000-0000-000000000201');

insert into procurement_invoices (id, org_id, procurement_id, po_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency, work_order_id) values
  ('27840000-0000-0000-0000-000000000331', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000301', '27840000-0000-0000-0000-000000000311', 'VI-1', '2026-11-12', 'Received', 1000000, 'exclusive', 110000, 'IDR', '27840000-0000-0000-0000-000000000201'),
  ('27840000-0000-0000-0000-000000000333', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000303', null, 'VI-3', '2026-11-12', 'Paid', 500000, 'exclusive', 0, 'IDR', '27840000-0000-0000-0000-000000000201');

insert into payments (id, org_id, procurement_id, invoice_id, pay_number, date, status, amount, currency) values
  ('27840000-0000-0000-0000-000000000343', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000303', '27840000-0000-0000-0000-000000000333', 'PAY-3', '2026-11-13', 'Paid', 500000, 'IDR');

-- 2. Stock: stock issue costing is OFF (no stock_issue_cost_settings row).
--   D1: posted issue with value -750,000 -> uncounted_stock count 1, total 750000.00
--   D2: posted issue with value 0 (client-supplied / zero-cost) -> EXCLUDED
--   D3: draft issue -> EXCLUDED (drafts are not cost)
insert into stock_units (id, org_id, code, name) values ('27840000-0000-0000-0000-000000000401', '27840000-0000-0000-0000-00000000000a', 'ea', 'each');
insert into stock_items (id, org_id, code, name, unit_id) values
  ('27840000-0000-0000-0000-000000000402', '27840000-0000-0000-0000-00000000000a', 'BOLT', 'Bolt', '27840000-0000-0000-0000-000000000401'),
  ('27840000-0000-0000-0000-000000000403', '27840000-0000-0000-0000-00000000000a', 'FREE', 'Client Valve', '27840000-0000-0000-0000-000000000401');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('27840000-0000-0000-0000-000000000404', '27840000-0000-0000-0000-00000000000a', 'WH-1', 'Central', 'central', null);
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, work_order_id, occurred_on, created_by, posted_by, posted_at) values
  ('27840000-0000-0000-0000-000000000411', '27840000-0000-0000-0000-00000000000a', 'SI-1', 'issue', 'Posted', '27840000-0000-0000-0000-000000000404', '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '2026-11-12', '27840000-0000-0000-0000-0000000000a1', '27840000-0000-0000-0000-0000000000a1', now()),
  ('27840000-0000-0000-0000-000000000412', '27840000-0000-0000-0000-00000000000a', 'SI-2', 'issue', 'Posted', '27840000-0000-0000-0000-000000000404', '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '2026-11-12', '27840000-0000-0000-0000-0000000000a1', '27840000-0000-0000-0000-0000000000a1', now()),
  ('27840000-0000-0000-0000-000000000413', '27840000-0000-0000-0000-00000000000a', 'SI-3', 'issue', 'Draft',  '27840000-0000-0000-0000-000000000404', '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '2026-11-12', '27840000-0000-0000-0000-0000000000a1', null, null);
insert into stock_document_lines (id, org_id, document_id, line_no, item_id, quantity, direction) values
  ('27840000-0000-0000-0000-000000000421', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000411', 1, '27840000-0000-0000-0000-000000000402', 5, 'out'),
  ('27840000-0000-0000-0000-000000000422', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000412', 1, '27840000-0000-0000-0000-000000000403', 2, 'out');
insert into stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, kind, qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by) values
  ('27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000411', '27840000-0000-0000-0000-000000000421', '27840000-0000-0000-0000-000000000402', '27840000-0000-0000-0000-000000000404', '27840000-0000-0000-0000-000000000101', 'issue', -5, -750000, 0, 0, '2026-11-12', '27840000-0000-0000-0000-0000000000a1'),
  ('27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000412', '27840000-0000-0000-0000-000000000422', '27840000-0000-0000-0000-000000000403', '27840000-0000-0000-0000-000000000404', '27840000-0000-0000-0000-000000000101', 'issue', -2,       0, 0, 0, '2026-11-12', '27840000-0000-0000-0000-0000000000a1');

-- 3. Labour: 1 submitted timesheet entry (unapproved_labour) + 1 approved timesheet entry with labour costing OFF (unrated_labour).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('27840000-0000-0000-0000-000000000501', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-0000000000a6', '2026-11-09', 'Submitted'),
  ('27840000-0000-0000-0000-000000000502', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-0000000000a6', '2026-11-02', 'Approved');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, work_order_id, entry_date, hours) values
  ('27840000-0000-0000-0000-000000000511', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000501', '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '2026-11-10', 8),
  ('27840000-0000-0000-0000-000000000512', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000502', '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '2026-11-03', 8);

-- 4. Equipment: 1 Submitted (unapproved_equipment) + 1 Approved without hire rate (unrated_equipment).
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('27840000-0000-0000-0000-000000000601', '27840000-0000-0000-0000-00000000000a', 'CRANE-1', 'Crane', 'hours');
insert into equipment_usage_entries (id, org_id, asset_id, project_id, work_order_id, work_date, quantity, unit, kind, status, author_id, approved_at) values
  ('27840000-0000-0000-0000-000000000611', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000601', '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '2026-11-10', 4, 'hours', 'work', 'Submitted', '27840000-0000-0000-0000-0000000000a6', null),
  ('27840000-0000-0000-0000-000000000612', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000601', '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '2026-11-11', 5, 'hours', 'work', 'Approved',  '27840000-0000-0000-0000-0000000000a6', now());

-- 5. Expense claim: 1 Submitted claim (300,000) -> unapproved_claim; 1 Approved claim (200,000) -> NOT left out.
insert into expense_claims (id, org_id, project_id, work_order_id, claimant_id, kind, status, title, amount, currency) values
  ('27840000-0000-0000-0000-000000000701', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '27840000-0000-0000-0000-0000000000a6', 'claim', 'Submitted', 'Site fuel', 300000, 'IDR'),
  ('27840000-0000-0000-0000-000000000702', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '27840000-0000-0000-0000-0000000000a6', 'claim', 'Approved',  'Site toll', 200000, 'IDR');

-- 6. Review cases (#3026 fix round):
--   P4: bill 1,000,000 (tax 0) with a 400,000 advance NOT linked to the bill. Direct cost already counts the 400,000 as the
--       purchase balance, so only 600,000 is left out (mut:unlinked_cap).
--   P5: a Draft purchase order (900,000) is not a commitment -> not "ordered, not billed" (mut:draft_po).
--   P6: Issued PO 1,000,000, no bill, 300,000 advance not linked to a bill -> 700,000 left out.
insert into procurements (id, org_id, title, project_id, work_order_id, requested_by_id, status, total_value, approved_total_value, currency) values
  ('27840000-0000-0000-0000-000000000304', '27840000-0000-0000-0000-00000000000a', 'Rebar advance', '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '27840000-0000-0000-0000-0000000000a1', 'Vendor Invoiced', 1000000, 1000000, 'IDR'),
  ('27840000-0000-0000-0000-000000000305', '27840000-0000-0000-0000-00000000000a', 'Draft order',   '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '27840000-0000-0000-0000-0000000000a1', 'Approved',        900000,  900000, 'IDR'),
  ('27840000-0000-0000-0000-000000000306', '27840000-0000-0000-0000-00000000000a', 'Pipe advance',  '27840000-0000-0000-0000-000000000101', '27840000-0000-0000-0000-000000000201', '27840000-0000-0000-0000-0000000000a1', 'Ordered',        1000000, 1000000, 'IDR');
insert into purchase_orders (id, org_id, procurement_id, po_number, date, status, amount, currency, work_order_id) values
  ('27840000-0000-0000-0000-000000000315', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000305', 'PO-5', '2026-11-11', 'Draft',   900000, 'IDR', '27840000-0000-0000-0000-000000000201'),
  ('27840000-0000-0000-0000-000000000316', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000306', 'PO-6', '2026-11-11', 'Issued', 1000000, 'IDR', '27840000-0000-0000-0000-000000000201');
insert into procurement_invoices (id, org_id, procurement_id, po_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency, work_order_id) values
  ('27840000-0000-0000-0000-000000000334', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000304', null, 'VI-4', '2026-11-12', 'Received', 1000000, 'exclusive', 0, 'IDR', '27840000-0000-0000-0000-000000000201');
insert into payments (id, org_id, procurement_id, invoice_id, pay_number, date, status, amount, currency) values
  ('27840000-0000-0000-0000-000000000344', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000304', null, 'PAY-4', '2026-11-10', 'Paid', 400000, 'IDR'),
  ('27840000-0000-0000-0000-000000000346', '27840000-0000-0000-0000-00000000000a', '27840000-0000-0000-0000-000000000306', null, 'PAY-6', '2026-11-10', 'Paid', 300000, 'IDR');

set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- ── 1. Project Control Manager sees counts + reliable totals, zero-cost & draft stock excluded ───────
set local role authenticated;
select pg_temp.act_as('27840000-0000-0000-0000-0000000000a2');

select is(
  (work_order_cost_left_out('27840000-0000-0000-0000-000000000201')->>'pricesHidden')::boolean,
  false, 'PCM: pricesHidden is false'
);
select is(
  (work_order_cost_left_out('27840000-0000-0000-0000-000000000201')->>'labourCostEnabled')::boolean,
  false, 'PCM: labourCostEnabled reflects org setting (off)'
);
select is(
  (work_order_cost_left_out('27840000-0000-0000-0000-000000000201')->>'stockIssueCostEnabled')::boolean,
  false, 'PCM: stockIssueCostEnabled reflects org setting (off)'
);

-- Verify every kind, count, and total on WO-1
select is(
  (select jsonb_object_agg(x->>'kind', jsonb_build_object('count', (x->>'count')::int, 'currency', x->>'currency', 'total', x->>'total'))
     from jsonb_array_elements(work_order_cost_left_out('27840000-0000-0000-0000-000000000201')->'items') x),
  jsonb_build_object(
    'unpaid_bill',          jsonb_build_object('count', 2, 'currency', 'IDR', 'total', '1600000.00'),
    'purchase_order',       jsonb_build_object('count', 2, 'currency', 'IDR', 'total', '3200000.00'),
    'goods_receipt',        jsonb_build_object('count', 1, 'currency', null,  'total', null),
    'uncounted_stock',      jsonb_build_object('count', 1, 'currency', 'IDR', 'total', '750000.00'),
    'unapproved_claim',     jsonb_build_object('count', 1, 'currency', 'IDR', 'total', '300000.00'),
    'unapproved_labour',    jsonb_build_object('count', 1, 'currency', null,  'total', null),
    'unrated_labour',       jsonb_build_object('count', 1, 'currency', null,  'total', null),
    'unapproved_equipment', jsonb_build_object('count', 1, 'currency', null,  'total', null),
    'unrated_equipment',    jsonb_build_object('count', 1, 'currency', null,  'total', null)
  ),
  'PCM: exact counts and totals for all left-out kinds; paid bill, zero-cost stock, draft stock and approved claim excluded'
);

-- Clean WO returns empty items array (no zero-count kinds)
select is(
  work_order_cost_left_out('27840000-0000-0000-0000-000000000202')->'items',
  '[]'::jsonb,
  'PCM: clean work order returns empty items array'
);

-- ── 2. Price-hidden role (site_supervisor + hide_prices_from_requesters = true) gets counts ONLY ───
select pg_temp.act_as('27840000-0000-0000-0000-0000000000a5');

select is(
  (work_order_cost_left_out('27840000-0000-0000-0000-000000000201')->>'pricesHidden')::boolean,
  true, 'Price-hidden role: pricesHidden is true'
);
select is(
  (select count(*) from jsonb_array_elements(work_order_cost_left_out('27840000-0000-0000-0000-000000000201')->'items') x
    where x->>'total' is not null or x->>'currency' is not null),
  0::bigint,
  'Price-hidden role: every kind returns count only with null total and null currency (mut:hide_prices)'
);
select is(
  (select jsonb_array_length(work_order_cost_left_out('27840000-0000-0000-0000-000000000201')->'items')),
  9,
  'Price-hidden role: still sees all 9 non-zero counts'
);

-- ── 3. Project Manager of another project reads as not found (P0002) ───────────────────────────────
select pg_temp.act_as('27840000-0000-0000-0000-0000000000a4');
select throws_ok(
  $$select work_order_cost_left_out('27840000-0000-0000-0000-000000000201')$$,
  'P0002', 'work order not found',
  'PM of another project: refused as not found (mut:pm_scope)'
);

-- ── 4. Non-cost role (Engineer) and light account are refused (42501) ──────────────────────────────
select pg_temp.act_as('27840000-0000-0000-0000-0000000000a6');
select throws_ok(
  $$select work_order_cost_left_out('27840000-0000-0000-0000-000000000201')$$,
  '42501', 'not authorized',
  'Engineer: refused with 42501'
);

select pg_temp.act_as('27840000-0000-0000-0000-0000000000a7');
select throws_ok(
  $$select work_order_cost_left_out('27840000-0000-0000-0000-000000000201')$$,
  '42501', null,
  'Light account: refused with 42501'
);

-- ── 5. Cross-org Admin reads as not found (P0002) ──────────────────────────────────────────────────
select pg_temp.act_as('27840000-0000-0000-0000-0000000000b1');
select throws_ok(
  $$select work_order_cost_left_out('27840000-0000-0000-0000-000000000201')$$,
  'P0002', 'work order not found',
  'Other org Admin: refused as not found'
);

select * from finish();
rollback;
