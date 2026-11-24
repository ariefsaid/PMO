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
select no_plan();

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

set local session_replication_role=replica;
insert into stock_documents(id,org_id,number,kind,status,warehouse_id,occurred_on,created_by,posted_by,posted_at)
select '25190000-0000-0000-0000-000000000814',org_id,'OPEN-CUTOVER','receive','Posted',warehouse_id,'2026-11-15',created_by,posted_by,posted_at from stock_documents where id='25190000-0000-0000-0000-000000000810';
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a1');
select is((select count(*) from stock_issue_cost_settings),0::bigint,'AC-ISC-001 no setting defaults off');
select is((select count(*) from stock_issue_cost_lines('25190000-0000-0000-0000-0000000000d1')),0::bigint,'AC-ISC-001 no added cost while off');
select is(public.set_stock_issue_cost_date('2026-11-16'), '2026-11-16'::date, 'AC-ISC-003 clean organisation enables');
select is((select sum(amount::numeric) from work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1') where source='stock_document' and reason='counted'),30::numeric,'AC-ISC-002 issue counts existing ledger value');
select is((get_project_finances('25190000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric,1130::numeric,'AC-ISC-002 project includes issued stock');
select is((select spent from project_pmo_positions(array['25190000-0000-0000-0000-0000000000d1']::uuid[])),1130::numeric,'AC-ISC-002 dashboard agrees');
select is(public.set_stock_issue_cost_date(null),null::date,'AC-ISC-001 disable');
select is((get_project_finances('25190000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric,1100::numeric,'AC-ISC-001 disabled unchanged');
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a4');
select throws_ok($$select set_stock_issue_cost_date('2026-11-16')$$,'42501',null,'AC-ISC-004 Engineer cannot change');
select throws_ok($$select * from stock_issue_cost_lines('25190000-0000-0000-0000-0000000000d1')$$,'42501',null,'AC-ISC-004 Engineer cannot read');

reset role;
set local session_replication_role=replica;
-- Stock purchase 999 paid once. Two issues (300, 200) and a return (50) leave stock 549.
insert into payments(id,org_id,procurement_id,invoice_id,status,amount,currency) values
 ('25190000-0000-0000-0000-000000000645','25190000-0000-0000-0000-00000000000a','25190000-0000-0000-0000-000000000604','25190000-0000-0000-0000-000000000626','Paid',999,'IDR');
update stock_documents set work_order_id='25190000-0000-0000-0000-000000000401' where id='25190000-0000-0000-0000-000000000811';
update stock_ledger set qty_delta=-30,value_delta=-300 where line_id='25190000-0000-0000-0000-000000000821';
update stock_document_lines set quantity=30 where id='25190000-0000-0000-0000-000000000821';
insert into stock_document_lines(id,org_id,document_id,line_no,item_id,quantity,unit_cost)
select '25190000-0000-0000-0000-000000000824',org_id,'25190000-0000-0000-0000-000000000810',1,item_id,99.9,10 from stock_document_lines where id='25190000-0000-0000-0000-000000000821';
insert into stock_ledger(org_id,document_id,line_id,item_id,warehouse_id,kind,qty_delta,value_delta,qty_after,value_after,occurred_on,posted_by)
select org_id,'25190000-0000-0000-0000-000000000810','25190000-0000-0000-0000-000000000824',item_id,warehouse_id,'receive',99.9,999,99.9,999,occurred_on,posted_by from stock_ledger where line_id='25190000-0000-0000-0000-000000000821';

insert into stock_documents(id,org_id,number,kind,status,warehouse_id,project_id,occurred_on,created_by,posted_by,posted_at,work_order_id)
select '25190000-0000-0000-0000-000000000812',org_id,'SI-2','issue','Posted',warehouse_id,project_id,occurred_on,created_by,posted_by,posted_at,'25190000-0000-0000-0000-000000000402' from stock_documents where id='25190000-0000-0000-0000-000000000811';
insert into stock_documents(id,org_id,number,kind,status,warehouse_id,project_id,occurred_on,created_by,posted_by,posted_at,work_order_id)
select '25190000-0000-0000-0000-000000000813',org_id,'RT-1','return','Posted',warehouse_id,project_id,occurred_on,created_by,posted_by,posted_at,work_order_id from stock_documents where id='25190000-0000-0000-0000-000000000811';
insert into stock_document_lines(id,org_id,document_id,line_no,item_id,quantity,direction)
select '25190000-0000-0000-0000-000000000822',org_id,'25190000-0000-0000-0000-000000000812',1,item_id,20,'out' from stock_document_lines where id='25190000-0000-0000-0000-000000000821';
insert into stock_document_lines(id,org_id,document_id,line_no,item_id,quantity,source_line_id)
select '25190000-0000-0000-0000-000000000823',org_id,'25190000-0000-0000-0000-000000000813',1,item_id,5,id from stock_document_lines where id='25190000-0000-0000-0000-000000000821';
insert into stock_ledger(org_id,document_id,line_id,item_id,warehouse_id,project_id,kind,qty_delta,value_delta,qty_after,value_after,occurred_on,posted_by)
select org_id,'25190000-0000-0000-0000-000000000812','25190000-0000-0000-0000-000000000822',item_id,warehouse_id,project_id,'issue',-20,-200,49.9,499,occurred_on,posted_by from stock_ledger where line_id='25190000-0000-0000-0000-000000000821';
insert into stock_ledger(org_id,document_id,line_id,item_id,warehouse_id,project_id,kind,qty_delta,value_delta,qty_after,value_after,occurred_on,posted_by)
select org_id,'25190000-0000-0000-0000-000000000813','25190000-0000-0000-0000-000000000823',item_id,warehouse_id,project_id,'return',5,50,54.9,549,occurred_on,posted_by from stock_ledger where line_id='25190000-0000-0000-0000-000000000821';
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a1');
select throws_ok($$select set_stock_issue_cost_date('2026-11-17')$$,'23514','this organisation needs a stock-cost migration first','AC-ISC-003 refuses historically costed purchase');
select is(set_stock_issue_cost_date('2026-11-16'),'2026-11-16'::date,'AC-ISC-002 enable at receipt date');
select is((select sum(amount::numeric) from work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1') where source='stock_document' and work_order_id='25190000-0000-0000-0000-000000000401' and reason='counted'),250::numeric,'AC-ISC-002 work order A issue less return');
select is((select sum(amount::numeric) from work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1') where source='stock_document' and work_order_id='25190000-0000-0000-0000-000000000402' and reason='counted'),200::numeric,'AC-ISC-002 work order B issue');
select is((select sum(amount) from stock_issue_cost_lines('25190000-0000-0000-0000-0000000000d1'))+(select sum(value_delta) from stock_ledger where org_id='25190000-0000-0000-0000-00000000000a'),999::numeric,'AC-ISC-002 consumed plus remaining stock equals bill once');
select is((get_project_finances('25190000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric,1550::numeric,'AC-ISC-002 project excludes stocked bill and includes 450 consumed plus direct delivery 1100');
select is((select spent from project_pmo_positions(array['25190000-0000-0000-0000-0000000000d1']::uuid[])),1550::numeric,'AC-ISC-002 dashboard same source');
select is((select amount from project_pmo_spent_position('25190000-0000-0000-0000-0000000000d1')),1550::numeric,'AC-ISC-002 single-project position same source');
select is((select sum(amount::numeric) from work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1') where reason in ('counted','unassigned','split-when-custom')),1550::numeric,'AC-ISC-002 work order totals reconcile project');
select pg_temp.act_as('25190000-0000-0000-0000-0000000000b1');
select is((select count(*) from stock_issue_cost_settings),0::bigint,'AC-ISC-004 settings isolated');
select throws_ok($$select * from stock_issue_cost_lines('25190000-0000-0000-0000-0000000000d1')$$,'P0002','project not found','AC-ISC-004 costs isolated');


reset role;
create temp table issue_cost_function_backups(name text primary key, definition text);
insert into issue_cost_function_backups values ('erp_case',pg_get_functiondef('public.org_reads_erp_ledger()'::regprocedure));
create or replace function public.org_reads_erp_ledger() returns boolean language sql stable as $$select true$$;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a1');
select throws_ok($$select set_stock_issue_cost_date('2026-11-16')$$,'23514','stock issue costing requires the PMO-paid basis','AC-ISC-005 ERP enabling refused');
select is((select count(*) from stock_issue_cost_lines('25190000-0000-0000-0000-0000000000d1')),0::bigint,'AC-ISC-005 ERP has no extra PMO stock cost');
reset role;
do $restore$ begin execute (select definition from issue_cost_function_backups where name='erp_case'); end $restore$;
insert into issue_cost_function_backups values ('stock_mutation',pg_get_functiondef('public.stock_issue_cost_lines(uuid)'::regprocedure));
do $mut$ begin execute replace(pg_get_functiondef('public.stock_issue_cost_lines(uuid)'::regprocedure),'-sum(l.value_delta)','sum(l.value_delta)'); end $mut$;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a1');
select isnt((select sum(amount) from stock_issue_cost_lines('25190000-0000-0000-0000-0000000000d1')),450::numeric,'AC-ISC-002 mutation: broken sign fails the same cost oracle');
reset role;
do $restore$ begin execute (select definition from issue_cost_function_backups where name='stock_mutation'); end $restore$;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a1');
select is((select sum(amount) from stock_issue_cost_lines('25190000-0000-0000-0000-0000000000d1')),450::numeric,'AC-ISC-002 restored money oracle');
reset role;
insert into issue_cost_function_backups values ('admin_mutation',pg_get_functiondef('public.set_stock_issue_cost_date(date)'::regprocedure));
do $mut$ begin execute replace(pg_get_functiondef('public.set_stock_issue_cost_date(date)'::regprocedure),
  $old$if public.auth_role() is distinct from 'Admin' then$old$,$new$if false then$new$); end $mut$;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a4');
select lives_ok($$select set_stock_issue_cost_date(null)$$,'AC-ISC-004 mutation: removing role rule breaks refusal oracle');
reset role;
do $restore$ begin execute (select definition from issue_cost_function_backups where name='admin_mutation'); end $restore$;
select * from finish();
rollback;
