-- Stock cutover date sequence (AC-ISC-008); fixture writes are privileged, assertions use authenticated readers.
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


reset role;
set local session_replication_role=replica;
update stock_documents set occurred_on='2026-11-15' where id='25190000-0000-0000-0000-000000000810';
delete from procurement_invoices where id='25190000-0000-0000-0000-000000000626';
update stock_documents set work_order_id='25190000-0000-0000-0000-000000000401' where id='25190000-0000-0000-0000-000000000811';
insert into stock_document_lines(id,org_id,document_id,line_no,item_id,quantity,unit_cost)
select '25190000-0000-0000-0000-000000000824',org_id,'25190000-0000-0000-0000-000000000810',1,item_id,99.9,10 from stock_document_lines where id='25190000-0000-0000-0000-000000000821';
insert into stock_ledger(org_id,document_id,line_id,item_id,warehouse_id,kind,qty_delta,value_delta,qty_after,value_after,occurred_on,posted_by)
select org_id,'25190000-0000-0000-0000-000000000810','25190000-0000-0000-0000-000000000824',item_id,warehouse_id,'receive',99.9,999,99.9,999,'2026-11-15',posted_by from stock_ledger where line_id='25190000-0000-0000-0000-000000000821';
delete from stock_ledger where line_id='25190000-0000-0000-0000-000000000821';
update stock_documents set status='Draft',posted_by=null,posted_at=null,occurred_on='2026-11-18' where id='25190000-0000-0000-0000-000000000811';
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a1');
select is(set_stock_issue_cost_date('2026-11-16'),'2026-11-16'::date,'AC-ISC-008 receive 15th, enable 16th before billing');
reset role;
set local session_replication_role=replica;
insert into procurement_invoices(id,org_id,procurement_id,vi_number,invoice_date,status,amount,tax_treatment,tax_amount,currency)
values('25190000-0000-0000-0000-000000000626','25190000-0000-0000-0000-00000000000a','25190000-0000-0000-0000-000000000604','VI-ST','2026-11-15','Received',999,'exclusive',0,'IDR');
insert into payments(id,org_id,procurement_id,invoice_id,status,amount,currency,date)
values('25190000-0000-0000-0000-000000000645','25190000-0000-0000-0000-00000000000a','25190000-0000-0000-0000-000000000604','25190000-0000-0000-0000-000000000626','Paid',999,'IDR','2026-11-17');
update stock_documents set status='Posted',posted_by=created_by,posted_at=now() where id='25190000-0000-0000-0000-000000000811';
insert into stock_ledger(org_id,document_id,line_id,item_id,warehouse_id,project_id,kind,qty_delta,value_delta,qty_after,value_after,occurred_on,posted_by)
select d.org_id,d.id,l.id,l.item_id,d.warehouse_id,d.project_id,'issue',-3,-30,96.9,969,d.occurred_on,d.created_by
from stock_documents d join stock_document_lines l on l.document_id=d.id where d.id='25190000-0000-0000-0000-000000000811';
set local session_replication_role=origin;
create temp table cutover_stock_remainder as select sum(value_delta) as amount from stock_ledger where org_id='25190000-0000-0000-0000-00000000000a';
grant select on cutover_stock_remainder to authenticated;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a1');
select is(purchase_costs_as_stock('25190000-0000-0000-0000-000000000604'),true,'AC-ISC-008 later billed receipt uses stock basis');

select is((get_project_finances('25190000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric-1100+(select amount from cutover_stock_remainder),999::numeric,'AC-ISC-008 partial project cost plus stock equals bill');
select is((select sum(amount::numeric) from work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1') where source='stock_document' and reason='counted')+(select amount from cutover_stock_remainder),999::numeric,'AC-ISC-008 partial work order cost plus stock equals bill');
reset role;
set local session_replication_role=replica;
update stock_document_lines set quantity=99.9 where id='25190000-0000-0000-0000-000000000821';
update stock_ledger set qty_delta=-99.9,value_delta=-999,qty_after=0,value_after=0 where line_id='25190000-0000-0000-0000-000000000821';
update cutover_stock_remainder set amount=(select sum(value_delta) from stock_ledger where org_id='25190000-0000-0000-0000-00000000000a');
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a1');
select is((get_project_finances('25190000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric-1100+(select amount from cutover_stock_remainder),999::numeric,'AC-ISC-008 fully issued project cost equals bill');
select is((select sum(amount::numeric) from work_order_cost_amounts('25190000-0000-0000-0000-0000000000d1') where source='stock_document' and reason='counted' and work_order_id='25190000-0000-0000-0000-000000000401'),999::numeric,'AC-ISC-008 fully issued work order cost equals bill');

reset role;
set local session_replication_role=replica;
update procurement_invoices set invoice_date='2026-11-14' where id='25190000-0000-0000-000000000626';
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.act_as('25190000-0000-0000-0000-0000000000a1');
select is(purchase_costs_as_stock('25190000-0000-0000-0000-000000000604'),true,'AC-ISC-008 snapshot survives another invoice date correction');
select is((get_project_finances('25190000-0000-0000-0000-0000000000d1')->'actuals'->>'total')::numeric-1100,999::numeric,'AC-ISC-008 corrected bill date preserves project conservation');
select throws_ok($$select set_stock_issue_cost_date('2026-11-17')$$,'23514','this organisation needs a stock-cost migration first','AC-ISC-008 date change rechecks historical cost');
select is(purchase_costs_as_stock('25190000-0000-0000-0000-000000000604'),true,'AC-ISC-008 refused date change preserves the snapshot');
select is(set_stock_issue_cost_date(null),null::date,'AC-ISC-008 switching off succeeds');
select throws_ok($$select set_stock_issue_cost_date('2026-11-16')$$,'23514','this organisation needs a stock-cost migration first','AC-ISC-008 switching back on rechecks history');
select is(purchase_costs_as_stock('25190000-0000-0000-0000-000000000604'),false,'AC-ISC-008 refused re-enable stays off');
select * from finish();
rollback;
