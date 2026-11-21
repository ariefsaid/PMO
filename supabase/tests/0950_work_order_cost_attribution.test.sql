-- 0950_work_order_cost_attribution.test.sql — #2517 (ADR-0104; docs/specs/work-order-cost-attribution.spec.md).
-- Migrations under test: 0950_cost_disciplines.sql, 0951_work_order_cost_attribution.sql, 0952_timesheet_week_attribution.sql.
-- AC-WCA-001 every cost source carries a work order and a discipline · AC-WCA-002 a work order on another project,
-- another org or cancelled is refused by the database, for every writer · AC-WCA-003 a discipline must be the org's,
-- live · AC-WCA-004 a cost with no project names no work order · AC-WCA-005 a transfer to a work order's site may name it ·
-- AC-WCA-006 project totals are unchanged · AC-WCA-007 a second org reads nothing and changes nothing ·
-- AC-WCA-008 an author changes only their own editable record · AC-WCA-009 only an Admin keeps the discipline list ·
-- AC-WCA-010 a posted stock document stays immutable except its attribution · AC-WCA-011 a purchase cannot move
-- away from its records' work orders · AC-WCA-012 one read seam returns a work order's cost lines by source ·
-- AC-WCA-015 the timesheet week save carries a line's work order and discipline.
-- Every denial asserts the errcode AND the message, so a different gate moving in front cannot pass it.
begin;
create extension if not exists pgtap;
select plan(52);

-- ── Fixtures: org A (several roles), org B (another tenant). Written as the table owner. ─────────────────
insert into organizations (id, name, default_currency) values
  ('25170000-0000-0000-0000-00000000000a', 'WCA Org',       'IDR'),
  ('25170000-0000-0000-0000-00000000000b', 'WCA Other Org', 'IDR');
insert into auth.users (id, email) values
  ('25170000-0000-0000-0000-0000000000a1', 'wca-admin@example.com'),
  ('25170000-0000-0000-0000-0000000000a2', 'wca-fin@example.com'),
  ('25170000-0000-0000-0000-0000000000a3', 'wca-pm@example.com'),
  ('25170000-0000-0000-0000-0000000000a4', 'wca-eng@example.com'),
  ('25170000-0000-0000-0000-0000000000a5', 'wca-eng2@example.com'),
  ('25170000-0000-0000-0000-0000000000b1', 'wca-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25170000-0000-0000-0000-0000000000a1', '25170000-0000-0000-0000-00000000000a', 'WCA Admin', 'wca-admin@example.com', 'Admin', 'active'),
  ('25170000-0000-0000-0000-0000000000a2', '25170000-0000-0000-0000-00000000000a', 'WCA Fin',   'wca-fin@example.com',   'Finance', 'active'),
  ('25170000-0000-0000-0000-0000000000a3', '25170000-0000-0000-0000-00000000000a', 'WCA PM',    'wca-pm@example.com',    'Project Manager', 'active'),
  ('25170000-0000-0000-0000-0000000000a4', '25170000-0000-0000-0000-00000000000a', 'WCA Eng',   'wca-eng@example.com',   'Engineer', 'active'),
  ('25170000-0000-0000-0000-0000000000a5', '25170000-0000-0000-0000-00000000000a', 'WCA Eng2',  'wca-eng2@example.com',  'Engineer', 'active'),
  ('25170000-0000-0000-0000-0000000000b1', '25170000-0000-0000-0000-00000000000b', 'WCA XOrg',  'wca-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25170000-0000-0000-0000-0000000000d1', '25170000-0000-0000-0000-00000000000a', 'WCA Site',      'Ongoing Project', '25170000-0000-0000-0000-0000000000a3'),
  ('25170000-0000-0000-0000-0000000000d2', '25170000-0000-0000-0000-00000000000a', 'WCA Site Two',  'Ongoing Project', '25170000-0000-0000-0000-0000000000a3'),
  ('25170000-0000-0000-0000-0000000000d9', '25170000-0000-0000-0000-00000000000b', 'WCA Other Site','Ongoing Project', null);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25170000-0000-0000-0000-000000000401', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-0000000000d1', 'WCA WO one',   'Issued', 10000, 'exclusive', 0),
  ('25170000-0000-0000-0000-000000000402', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-0000000000d2', 'WCA WO two',   'Issued', 10000, 'exclusive', 0),
  ('25170000-0000-0000-0000-000000000409', '25170000-0000-0000-0000-00000000000b', '25170000-0000-0000-0000-0000000000d9', 'WCA WO other', 'Issued', 10000, 'exclusive', 0);

-- Source rows are written with triggers off: this file proves the attribution rule, not each record's create path
-- (each has its own proof). Attribution columns stay NULL here; every attribution below goes through the triggers.
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, cancelled_at, currency) values
  ('25170000-0000-0000-0000-000000000403', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-0000000000d1', 'WCA WO cancelled', 'Cancelled', 0, 'exclusive', 0, now(), 'IDR');
insert into cost_disciplines (id, org_id, code, name, archived_at) values
  ('25170000-0000-0000-0000-000000000501', '25170000-0000-0000-0000-00000000000a', 'CIV', 'Civil', null),
  ('25170000-0000-0000-0000-000000000502', '25170000-0000-0000-0000-00000000000a', 'OLD', 'Retired', now()),
  ('25170000-0000-0000-0000-000000000509', '25170000-0000-0000-0000-00000000000b', 'MEC', 'Mechanical', null);
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, currency) values
  ('25170000-0000-0000-0000-000000000601', '25170000-0000-0000-0000-00000000000a', 'WCA pipe purchase', '25170000-0000-0000-0000-0000000000d1',
   '25170000-0000-0000-0000-0000000000a4', 'Ordered', 1000000, 1000000, 'IDR'),
  ('25170000-0000-0000-0000-000000000609', '25170000-0000-0000-0000-00000000000b', 'WCA other purchase', '25170000-0000-0000-0000-0000000000d9',
   '25170000-0000-0000-0000-0000000000b1', 'Ordered', 500000, 500000, 'IDR');
insert into purchase_requests (id, org_id, procurement_id, pr_number, status, date, amount, currency) values
  ('25170000-0000-0000-0000-000000000611', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-000000000601', 'PR-WCA-1', 'Approved', '2026-11-16', 1000000, 'IDR'),
  ('25170000-0000-0000-0000-000000000619', '25170000-0000-0000-0000-00000000000b', '25170000-0000-0000-0000-000000000609', 'PR-WCA-9', 'Approved', '2026-11-16', 500000, 'IDR');
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('25170000-0000-0000-0000-000000000612', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-000000000601', 'PO-WCA-1', 'Issued', '2026-11-16', 1000000, 'IDR');
insert into procurement_receipts (id, org_id, procurement_id, gr_number, receipt_date, status) values
  ('25170000-0000-0000-0000-000000000613', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-000000000601', 'GR-WCA-1', '2026-11-16', 'Partial');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, tax_treatment, tax_amount, currency) values
  ('25170000-0000-0000-0000-000000000614', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-000000000601', 'VI-WCA-1', '2026-11-16', 'Received', 'exclusive', 0, 'IDR');
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('25170000-0000-0000-0000-000000000701', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-0000000000a4', '2026-11-16', 'Draft'),
  ('25170000-0000-0000-0000-000000000702', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-0000000000a5', '2026-11-16', 'Approved');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('25170000-0000-0000-0000-000000000711', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-000000000701', '25170000-0000-0000-0000-0000000000d1', '2026-11-16', 8),
  ('25170000-0000-0000-0000-000000000712', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-000000000702', '25170000-0000-0000-0000-0000000000d1', '2026-11-16', 4);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('25170000-0000-0000-0000-000000000801', '25170000-0000-0000-0000-00000000000a', 'WCA-C',  'Central',      'central', null),
  ('25170000-0000-0000-0000-000000000802', '25170000-0000-0000-0000-00000000000a', 'WCA-S1', 'Site one',     'site',    '25170000-0000-0000-0000-0000000000d1'),
  ('25170000-0000-0000-0000-000000000803', '25170000-0000-0000-0000-00000000000a', 'WCA-S0', 'Site, no job', 'site',    null);
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, to_warehouse_id, project_id, occurred_on, created_by, posted_by, posted_at) values
  ('25170000-0000-0000-0000-000000000811', '25170000-0000-0000-0000-00000000000a', 'SI-WCA-1', 'issue',    'Posted', '25170000-0000-0000-0000-000000000801', null,
   '25170000-0000-0000-0000-0000000000d1', '2026-11-16', '25170000-0000-0000-0000-0000000000a4', '25170000-0000-0000-0000-0000000000a4', now()),
  ('25170000-0000-0000-0000-000000000812', '25170000-0000-0000-0000-00000000000a', 'ST-WCA-1', 'transfer', 'Draft',  '25170000-0000-0000-0000-000000000801',
   '25170000-0000-0000-0000-000000000802', null, '2026-11-16', '25170000-0000-0000-0000-0000000000a4', null, null),
  ('25170000-0000-0000-0000-000000000813', '25170000-0000-0000-0000-00000000000a', 'ST-WCA-2', 'transfer', 'Draft',  '25170000-0000-0000-0000-000000000801',
   '25170000-0000-0000-0000-000000000803', null, '2026-11-16', '25170000-0000-0000-0000-0000000000a4', null, null),
  ('25170000-0000-0000-0000-000000000814', '25170000-0000-0000-0000-00000000000a', 'SR-WCA-1', 'receive',  'Draft',  '25170000-0000-0000-0000-000000000801', null,
   null, '2026-11-16', '25170000-0000-0000-0000-0000000000a4', null, null);
insert into equipment_assets (id, org_id, code, name) values
  ('25170000-0000-0000-0000-000000000901', '25170000-0000-0000-0000-00000000000a', 'WCA-EX', 'WCA excavator');
insert into equipment_usage_entries (id, org_id, asset_id, project_id, work_date, quantity, unit, status, author_id) values
  ('25170000-0000-0000-0000-000000000911', '25170000-0000-0000-0000-00000000000a', '25170000-0000-0000-0000-000000000901',
   '25170000-0000-0000-0000-0000000000d1', '2026-11-16', 8, 'hours', 'Draft', '25170000-0000-0000-0000-0000000000a4');
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create temp table wca_snap (label text primary key, v jsonb);
grant all on wca_snap to authenticated;

-- AC-WCA-001: the seven sources carry both columns.
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and column_name in ('work_order_id', 'discipline_id')
              and table_name in ('purchase_requests', 'purchase_orders', 'procurement_receipts', 'procurement_invoices',
                                 'timesheet_entries', 'stock_documents', 'equipment_usage_entries')), 14,
  'AC-WCA-001 the seven cost sources each carry work_order_id and discipline_id');

-- AC-WCA-006 (before): project totals as Finance sees them, captured before any attribution.
set local role authenticated;
select pg_temp.act_as('25170000-0000-0000-0000-0000000000a2');
insert into wca_snap select 'committed_before', coalesce(jsonb_agg(to_jsonb(c) order by c.currency), '[]')
  from public.project_committed_spend('25170000-0000-0000-0000-0000000000d1') c;
insert into wca_snap select 'actuals_before', coalesce(jsonb_agg(to_jsonb(a) order by a.category), '[]')
  from public.project_finance_actuals('25170000-0000-0000-0000-0000000000d1') a;

-- AC-WCA-001: Finance attributes one record of each source to WO one / Civil.
select is(public.set_cost_attribution('purchase_request', array['25170000-0000-0000-0000-000000000611']::uuid[],
  '25170000-0000-0000-0000-000000000401', '25170000-0000-0000-0000-000000000501'), 1, 'AC-WCA-001 a purchase request takes a work order and discipline');
select is(public.set_cost_attribution('purchase_order', array['25170000-0000-0000-0000-000000000612']::uuid[],
  '25170000-0000-0000-0000-000000000401', '25170000-0000-0000-0000-000000000501'), 1, 'AC-WCA-001 a purchase order takes a work order and discipline');
select is(public.set_cost_attribution('goods_receipt', array['25170000-0000-0000-0000-000000000613']::uuid[],
  '25170000-0000-0000-0000-000000000401', '25170000-0000-0000-0000-000000000501'), 1, 'AC-WCA-001 a goods receipt takes a work order and discipline');
select is(public.set_cost_attribution('vendor_bill', array['25170000-0000-0000-0000-000000000614']::uuid[],
  '25170000-0000-0000-0000-000000000401', '25170000-0000-0000-0000-000000000501'), 1, 'AC-WCA-001 a vendor bill takes a work order and discipline');
select is(public.set_cost_attribution('timesheet_entry', array['25170000-0000-0000-0000-000000000712']::uuid[],
  '25170000-0000-0000-0000-000000000401', '25170000-0000-0000-0000-000000000501'), 1, 'AC-WCA-001 an approved timesheet line takes a work order (Finance correction)');
select is(public.set_cost_attribution('stock_document', array['25170000-0000-0000-0000-000000000811']::uuid[],
  '25170000-0000-0000-0000-000000000401', '25170000-0000-0000-0000-000000000501'), 1, 'AC-WCA-010 a posted stock issue takes a work order');
select is(public.set_cost_attribution('equipment_usage', array['25170000-0000-0000-0000-000000000911']::uuid[],
  '25170000-0000-0000-0000-000000000401', '25170000-0000-0000-0000-000000000501'), 1, 'AC-WCA-001 an equipment usage entry takes a work order and discipline');
select is((select work_order_id from public.procurement_invoices where id = '25170000-0000-0000-0000-000000000614'),
  '25170000-0000-0000-0000-000000000401'::uuid, 'AC-WCA-001 the vendor bill now names WO one');

-- AC-WCA-002: another project, another org, cancelled.
select throws_ok($$ select public.set_cost_attribution('purchase_request', array['25170000-0000-0000-0000-000000000611']::uuid[],
  '25170000-0000-0000-0000-000000000402', null) $$, '23514', 'COST_WO_PROJECT: the work order belongs to another project',
  'AC-WCA-002 a work order of another project of the same org is refused');
select throws_ok($$ select public.set_cost_attribution('timesheet_entry', array['25170000-0000-0000-0000-000000000712']::uuid[],
  '25170000-0000-0000-0000-000000000409', null) $$, '23514', 'COST_WO_PROJECT: the work order belongs to another project',
  'AC-WCA-002 a work order of another org is refused');
select throws_ok($$ select public.set_cost_attribution('equipment_usage', array['25170000-0000-0000-0000-000000000911']::uuid[],
  '25170000-0000-0000-0000-000000000403', null) $$, '23514', 'COST_WO_CANCELLED: the work order is cancelled',
  'AC-WCA-002 a cancelled work order takes no new cost');
-- AC-WCA-003: archived and foreign disciplines.
select throws_ok($$ select public.set_cost_attribution('purchase_order', array['25170000-0000-0000-0000-000000000612']::uuid[],
  null, '25170000-0000-0000-0000-000000000502') $$, '23514', 'COST_DISCIPLINE: the discipline is not on this organisation''s list',
  'AC-WCA-003 an archived discipline is refused');
select throws_ok($$ select public.set_cost_attribution('purchase_order', array['25170000-0000-0000-0000-000000000612']::uuid[],
  null, '25170000-0000-0000-0000-000000000509') $$, '23514', 'COST_DISCIPLINE: the discipline is not on this organisation''s list',
  'AC-WCA-003 another org''s discipline is refused');
-- AC-WCA-004 / 005: stock kinds.
select throws_ok($$ select public.set_cost_attribution('stock_document', array['25170000-0000-0000-0000-000000000814']::uuid[],
  '25170000-0000-0000-0000-000000000401', null) $$, '23514', 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order',
  'AC-WCA-004 a stock receipt (no project) cannot name a work order');
select is(public.set_cost_attribution('stock_document', array['25170000-0000-0000-0000-000000000812']::uuid[],
  '25170000-0000-0000-0000-000000000401', null), 1, 'AC-WCA-005 a transfer to the work order''s site takes the work order');
select throws_ok($$ select public.set_cost_attribution('stock_document', array['25170000-0000-0000-0000-000000000813']::uuid[],
  '25170000-0000-0000-0000-000000000401', null) $$, '23514', 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order',
  'AC-WCA-004 a transfer to a site with no project cannot name a work order');
-- Discipline only (no work order) is fine on a project-level cost.
select is(public.set_cost_attribution('stock_document', array['25170000-0000-0000-0000-000000000814']::uuid[],
  null, '25170000-0000-0000-0000-000000000501'), 1, 'AC-WCA-004 a project-level cost may name a discipline without a work order');
-- Bad input.
select throws_ok($$ select public.set_cost_attribution('journal', array['25170000-0000-0000-0000-000000000611']::uuid[], null, null) $$,
  '22023', 'unknown cost source', 'set_cost_attribution refuses an unknown source');
select throws_ok($$ select public.set_cost_attribution('purchase_request', '{}'::uuid[], null, null) $$,
  '22023', 'name between 1 and 500 records', 'set_cost_attribution refuses an empty id list');

-- AC-WCA-012: the read seam lists the work order's lines by source, under the caller's RLS.
select is((select jsonb_object_agg(source, n) from (select source, count(*) n from public.work_order_cost_lines
            where work_order_id = '25170000-0000-0000-0000-000000000401' group by source) s),
  '{"purchase_request":1,"purchase_order":1,"goods_receipt":1,"vendor_bill":1,"timesheet_entry":1,"stock_document":2,"equipment_usage":1}'::jsonb,
  'AC-WCA-012 work_order_cost_lines returns WO one''s records by source');

-- AC-WCA-006 (after): the same totals, unchanged by attribution.
select is((select jsonb_agg(to_jsonb(c) order by c.currency) from public.project_committed_spend('25170000-0000-0000-0000-0000000000d1') c),
          (select case when v = '[]'::jsonb then null else v end from wca_snap where label = 'committed_before'),
  'AC-WCA-006 the project''s committed spend is unchanged by work-order attribution');
select is((select coalesce(jsonb_agg(to_jsonb(a) order by a.category), '[]') from public.project_finance_actuals('25170000-0000-0000-0000-0000000000d1') a),
          (select v from wca_snap where label = 'actuals_before'),
  'AC-WCA-006 the project''s actuals are unchanged by work-order attribution');

-- AC-WCA-008: an Engineer changes only their own editable records.
select pg_temp.act_as('25170000-0000-0000-0000-0000000000a4');
select is(public.set_cost_attribution('timesheet_entry', array['25170000-0000-0000-0000-000000000711']::uuid[],
  '25170000-0000-0000-0000-000000000401', '25170000-0000-0000-0000-000000000501'), 1, 'AC-WCA-008 an Engineer attributes a line of their own draft timesheet');
select lives_ok($$ update public.timesheet_entries set work_order_id = null where id = '25170000-0000-0000-0000-000000000711' $$, 'FR-WCA-034 owner can directly change an editable line');
select throws_ok($$ select public.set_cost_attribution('timesheet_entry', array['25170000-0000-0000-0000-000000000712']::uuid[], null, null) $$,
  '42501', 'you cannot change the work order or discipline of this record', 'AC-WCA-008 an Engineer cannot change another person''s timesheet line');
select is(public.set_cost_attribution('stock_document', array['25170000-0000-0000-0000-000000000811']::uuid[],
  '25170000-0000-0000-0000-000000000401', '25170000-0000-0000-0000-000000000501'), 1,
  'AC-WCA-008 the storekeeper who posted a stock issue attributes it right after (a movement posts on create)');
select is(public.set_cost_attribution('equipment_usage', array['25170000-0000-0000-0000-000000000911']::uuid[], null, null), 1,
  'AC-WCA-008 an Engineer clears the attribution of their own draft equipment entry');

-- AC-WCA-015 (0952): the week save carries a line's work order and discipline; a line that names neither keeps them.
select lives_ok($$ select public.save_timesheet_week('25170000-0000-0000-0000-000000000701', '2026-11-16',
  '[{"project_id":"25170000-0000-0000-0000-0000000000d1","entry_date":"2026-11-17","hours":2,"notes":null,
     "work_order_id":"25170000-0000-0000-0000-000000000401","discipline_id":"25170000-0000-0000-0000-000000000501"}]'::jsonb) $$,
  'AC-WCA-015 an Engineer saves a timesheet line with a work order and discipline');
select is((select work_order_id from public.timesheet_entries where timesheet_id = '25170000-0000-0000-0000-000000000701' and entry_date = '2026-11-17'),
  '25170000-0000-0000-0000-000000000401'::uuid, 'AC-WCA-015 the saved line names the work order');
select public.save_timesheet_week('25170000-0000-0000-0000-000000000701', '2026-11-16',
  '[{"project_id":"25170000-0000-0000-0000-0000000000d1","entry_date":"2026-11-17","hours":3,"notes":null}]'::jsonb);
select is((select work_order_id::text || '/' || hours::text from public.timesheet_entries
            where timesheet_id = '25170000-0000-0000-0000-000000000701' and entry_date = '2026-11-17'),
  '25170000-0000-0000-0000-000000000401/3.00', 'AC-WCA-015 a re-save that names no work order keeps it and changes the hours');
select throws_ok($$ select public.save_timesheet_week('25170000-0000-0000-0000-000000000701', '2026-11-16',
  '[{"project_id":"25170000-0000-0000-0000-0000000000d1","entry_date":"2026-11-17","hours":3,"notes":null,
     "work_order_id":"25170000-0000-0000-0000-000000000402","discipline_id":null}]'::jsonb) $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-WCA-015 the week save refuses a work order of another project');

select pg_temp.act_as('25170000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.set_cost_attribution('stock_document', array['25170000-0000-0000-0000-000000000811']::uuid[], null, null) $$,
  '42501', 'you cannot change the work order or discipline of this record', 'AC-WCA-008 an Engineer cannot change another person''s stock document');

-- AC-WORP-002: the page reads an accessible order, but foreign and random IDs are indistinguishable.
select is((select count(*)::int from public.work_orders where id = '25170000-0000-0000-0000-000000000401'), 1,
  'AC-WORP-002 control: a caller reads an order in their org');
-- AC-WCA-007: org B reads nothing of org A and changes nothing.
select pg_temp.act_as('25170000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.set_cost_attribution('timesheet_entry', array['25170000-0000-0000-0000-000000000711']::uuid[], null, null) $$,
  'P0002', 'record not found', 'AC-WCA-007 another org''s record reads as absent');
select is((select count(*)::int from public.work_orders where id = '25170000-0000-0000-0000-000000000401'), 0,
  'AC-WORP-002 a foreign order is unreadable');
select is((select count(*)::int from public.work_orders where id = '25170000-0000-0000-0000-000000000499'), 0,
  'AC-WORP-002 a random order is equally unreadable');
select ok(has_table_privilege('authenticated', 'public.work_orders', 'SELECT'),
  'AC-WORP-002 authenticated can reach the RLS-protected table');
select is((select count(*)::int from public.work_order_cost_lines where org_id = '25170000-0000-0000-0000-00000000000a'), 0,
  'AC-WCA-007 another org reads none of org A''s cost lines');
select throws_ok($$ select public.set_cost_attribution('purchase_request', array['25170000-0000-0000-0000-000000000619']::uuid[],
  '25170000-0000-0000-0000-000000000401', null) $$, '23514', 'COST_WO_PROJECT: the work order belongs to another project',
  'AC-WCA-007 org B cannot point its own record at org A''s work order');
select is((select count(*)::int from public.cost_disciplines), 1, 'AC-WCA-007 org B sees only its own discipline');

-- AC-WCA-009: only an Admin keeps the list; the org is stamped from the JWT.
select pg_temp.act_as('25170000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into public.cost_disciplines (code, name) values ('ELE', 'Electrical') $$,
  '42501', 'new row violates row-level security policy for table "cost_disciplines"', 'AC-WCA-009 a Project Manager cannot add a discipline');
select pg_temp.act_as('25170000-0000-0000-0000-0000000000a1');
select lives_ok($$ insert into public.cost_disciplines (code, name) values ('ELE', 'Electrical') $$, 'AC-WCA-009 an Admin adds a discipline');
select is((select org_id from public.cost_disciplines where code = 'ELE'), '25170000-0000-0000-0000-00000000000a'::uuid,
  'AC-WCA-009 the new discipline is stamped with the Admin''s org');

reset role;
select set_config('request.jwt.claims', '', true);

-- AC-WCA-002: the rule guards every writer, not only the RPC.
select throws_ok($$ update public.timesheet_entries set work_order_id = '25170000-0000-0000-0000-000000000402'
                     where id = '25170000-0000-0000-0000-000000000711' $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-WCA-002 a direct table write is held to the same rule');
-- AC-WCA-010: a posted stock document's other columns stay immutable.
select throws_ok($$ update public.stock_documents set note = 'changed' where id = '25170000-0000-0000-0000-000000000811' $$,
  'P0001', 'STK_IMMUTABLE: a posted or cancelled document cannot be changed', 'AC-WCA-010 a posted stock document stays immutable');
-- AC-WCA-011: the purchase cannot move away from its records' work order.
select throws_ok($$ update public.procurements set project_id = '25170000-0000-0000-0000-0000000000d2'
                     where id = '25170000-0000-0000-0000-000000000601' $$,
  '23514', 'COST_WO_PROJECT_MOVE: records of this purchase name a work order of its project. Clear their work orders before moving the purchase.',
  'AC-WCA-011 a purchase whose records name a work order cannot move project');
select throws_ok($$ update public.stock_warehouses set project_id = '25170000-0000-0000-0000-0000000000d2' where id = '25170000-0000-0000-0000-000000000802' $$, '23514', 'COST_WO_PROJECT_MOVE: transfers to this warehouse name a work order of its project', 'FR-WCA-020 a warehouse cannot move away from an attributed transfer');
-- Audit and ACL.
select is((select count(*)::int from public.audit_events where action = 'cost_attribution.set' and entity_id = '25170000-0000-0000-0000-000000000711'), 2, 'FR-WCA-034 direct changes are audited as well as RPC changes');
select ok(exists (select 1 from public.audit_events a join public.timesheet_entries e on e.id = a.entity_id where a.action = 'cost_attribution.set' and e.timesheet_id = '25170000-0000-0000-0000-000000000701' and e.entry_date = '2026-11-17'), 'FR-WCA-034 week save audits attribution changes');
select ok((select count(*) from public.audit_events where action = 'cost_attribution.set'
            and entity_id = '25170000-0000-0000-0000-000000000611') = 1, 'set_cost_attribution writes one audit row per record');
select ok(not has_function_privilege('anon', 'public.set_cost_attribution(text,uuid[],uuid,uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.check_cost_attribution()', 'EXECUTE'),
  'anon cannot call set_cost_attribution; nobody calls the rule trigger function');

select * from finish();
rollback;
