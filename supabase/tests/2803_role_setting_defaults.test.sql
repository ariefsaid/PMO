-- 2803_role_setting_defaults.test.sql — working defaults for the role settings (RR-3, owner ruling 28 Nov 2026).
-- Spec docs/specs/role-setting-defaults.spec.md. Migration under test: 2803_role_setting_defaults.sql
-- (seeds through seed_org_defaults; the daily-report, keeper and crew-tool default branches).
-- AC-RSD-001 standard checks template · AC-RSD-002 request chain · AC-RSD-003 daily-report validators ·
-- AC-RSD-004 billing QC step owner · AC-RSD-005 close-out item owners · AC-RSD-006 keeper fallback ·
-- AC-RSD-007 crew field-controller fallback · AC-RSD-008 PCM scheduled reports default on.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   mut:rsd_seed_checks_guard ..... 'AC-RSD-001 an organisation that keeps its own checks is not overwritten'
--   mut:rsd_chain_over_plan ....... 'AC-RSD-002 a request within plan snapshots two steps'
--   mut:rsd_chain_admin_wins ...... 'AC-RSD-002 an Admin-set chain replaces the default'
--   mut:rsd_dsr_default_keys ...... 'AC-RSD-003 the route names the default validator roles while nothing is set'
--   mut:rsd_dsr_default_includes .. 'AC-RSD-003 an unkeyed Engineer validates by default (level inclusion)'
--   mut:rsd_dsr_admin_wins ........ 'AC-RSD-003 an unkeyed Engineer is refused once the Admin set their own list'
--   mut:rsd_billing_seed_owner .... 'AC-RSD-004 the issued work order carries the default QC report step'
--   mut:rsd_closeout_seed_owner ... 'AC-RSD-005 the issued checklist copies the default owners'
--   mut:rsd_keeper_default ........ 'AC-RSD-006 an unkeyed Engineer passes the keeper guard on a keeperless warehouse'
--   mut:rsd_keeper_scoped ......... 'AC-RSD-006 a warehouse with a named keeper refuses another storekeeper'
--   mut:rsd_tool_default .......... 'AC-RSD-007 an unkeyed Engineer reports a tool for a controllerless crew'
--   mut:rsd_tool_named ............ 'AC-RSD-007 a crew with a named controller refuses another site supervisor'
begin;
create extension if not exists pgtap;
select plan(80);

-- ── Fixtures (written as the table owner; RLS is bypassed here, functions run as the actor) ──────────────────
-- Org A: built-in roles OFF (level holders only — the shape of an organisation that never turned keys on).
-- Org B: built-in roles ON with keyed people. Org C: keeps its own settings (the seeds must skip it).
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('28030000-0000-0000-0000-0000000000a1', 'RSD Org Level', 'IDR', 'UTC', false),
  ('28030000-0000-0000-0000-0000000000a2', 'RSD Org Keys',  'IDR', 'UTC', true),
  ('28030000-0000-0000-0000-0000000000a3', 'RSD Org Own',   'IDR', 'UTC', false);
insert into auth.users (id, email) values
  ('28030000-0000-0000-0000-0000000000b1', 'rsd-a-admin@example.com'),
  ('28030000-0000-0000-0000-0000000000b2', 'rsd-a-auth@example.com'),
  ('28030000-0000-0000-0000-0000000000b3', 'rsd-a-eng2@example.com'),
  ('28030000-0000-0000-0000-0000000000b4', 'rsd-a-pm@example.com'),
  ('28030000-0000-0000-0000-0000000000b5', 'rsd-a-fin@example.com'),
  ('28030000-0000-0000-0000-0000000000b6', 'rsd-a-pm2@example.com'),
  ('28030000-0000-0000-0000-0000000000c1', 'rsd-b-admin@example.com'),
  ('28030000-0000-0000-0000-0000000000c2', 'rsd-b-mc@example.com'),
  ('28030000-0000-0000-0000-0000000000c3', 'rsd-b-cm@example.com'),
  ('28030000-0000-0000-0000-0000000000c4', 'rsd-b-qs@example.com'),
  ('28030000-0000-0000-0000-0000000000c5', 'rsd-b-pcm@example.com'),
  ('28030000-0000-0000-0000-0000000000c6', 'rsd-b-eng@example.com'),
  ('28030000-0000-0000-0000-0000000000c7', 'rsd-b-qi@example.com'),
  ('28030000-0000-0000-0000-0000000000c8', 'rsd-b-ss@example.com'),
  ('28030000-0000-0000-0000-0000000000c9', 'rsd-b-sk@example.com'),
  ('28030000-0000-0000-0000-0000000000ca', 'rsd-b-auth@example.com'),
  ('28030000-0000-0000-0000-0000000000d1', 'rsd-c-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('28030000-0000-0000-0000-0000000000b1', '28030000-0000-0000-0000-0000000000a1', 'A Admin',  'rsd-a-admin@example.com', 'Admin',           'active', null),
  ('28030000-0000-0000-0000-0000000000b2', '28030000-0000-0000-0000-0000000000a1', 'A Author', 'rsd-a-auth@example.com',  'Engineer',        'active', null),
  ('28030000-0000-0000-0000-0000000000b3', '28030000-0000-0000-0000-0000000000a1', 'A Eng2',   'rsd-a-eng2@example.com',  'Engineer',        'active', null),
  ('28030000-0000-0000-0000-0000000000b4', '28030000-0000-0000-0000-0000000000a1', 'A PM',     'rsd-a-pm@example.com',    'Project Manager', 'active', null),
  ('28030000-0000-0000-0000-0000000000b5', '28030000-0000-0000-0000-0000000000a1', 'A Fin',    'rsd-a-fin@example.com',   'Finance',         'active', null),
  ('28030000-0000-0000-0000-0000000000b6', '28030000-0000-0000-0000-0000000000a1', 'A PM2',    'rsd-a-pm2@example.com',   'Project Manager', 'active', null),
  ('28030000-0000-0000-0000-0000000000c1', '28030000-0000-0000-0000-0000000000a2', 'B Admin',  'rsd-b-admin@example.com', 'Admin',           'active', null),
  ('28030000-0000-0000-0000-0000000000c2', '28030000-0000-0000-0000-0000000000a2', 'B MC',     'rsd-b-mc@example.com',    'Engineer',        'active', 'material_coordinator'),
  ('28030000-0000-0000-0000-0000000000c3', '28030000-0000-0000-0000-0000000000a2', 'B CM',     'rsd-b-cm@example.com',    'Project Manager', 'active', 'construction_manager'),
  ('28030000-0000-0000-0000-0000000000c4', '28030000-0000-0000-0000-0000000000a2', 'B QS',     'rsd-b-qs@example.com',    'Engineer',        'active', 'quantity_surveyor'),
  ('28030000-0000-0000-0000-0000000000c5', '28030000-0000-0000-0000-0000000000a2', 'B PCM',    'rsd-b-pcm@example.com',   'Project Manager', 'active', 'project_control_manager'),
  ('28030000-0000-0000-0000-0000000000c6', '28030000-0000-0000-0000-0000000000a2', 'B Eng',    'rsd-b-eng@example.com',   'Engineer',        'active', null),
  ('28030000-0000-0000-0000-0000000000c7', '28030000-0000-0000-0000-0000000000a2', 'B QI',     'rsd-b-qi@example.com',    'Engineer',        'active', 'quality_inspector'),
  ('28030000-0000-0000-0000-0000000000c8', '28030000-0000-0000-0000-0000000000a2', 'B SS',     'rsd-b-ss@example.com',    'Engineer',        'active', 'site_supervisor'),
  ('28030000-0000-0000-0000-0000000000c9', '28030000-0000-0000-0000-0000000000a2', 'B SK',     'rsd-b-sk@example.com',    'Engineer',        'active', 'storekeeper'),
  ('28030000-0000-0000-0000-0000000000ca', '28030000-0000-0000-0000-0000000000a2', 'B Author', 'rsd-b-auth@example.com',  'Engineer',        'active', null),
  ('28030000-0000-0000-0000-0000000000d1', '28030000-0000-0000-0000-0000000000a3', 'C Admin',  'rsd-c-admin@example.com', 'Admin',           'active', null);

insert into projects (id, org_id, name, status, project_manager_id) values
  ('28030000-0000-0000-0000-0000000000e1', '28030000-0000-0000-0000-0000000000a1', 'RSD Proj A', 'Ongoing Project', '28030000-0000-0000-0000-0000000000b4'),
  ('28030000-0000-0000-0000-0000000000e2', '28030000-0000-0000-0000-0000000000a2', 'RSD Proj B', 'Ongoing Project', null),
  ('28030000-0000-0000-0000-0000000000e3', '28030000-0000-0000-0000-0000000000a3', 'RSD Proj C', 'Ongoing Project', null);

insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  -- material-request and daily-report work orders (Issued directly: no issue-time triggers)
  ('28030000-0000-0000-0000-000000000100', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-0000000000e1', 'RSD MRQ WO A', 'Issued', 10000, 'exclusive', 0),
  ('28030000-0000-0000-0000-000000000101', '28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-0000000000e2', 'RSD MRQ WO B', 'Issued', 10000, 'exclusive', 0),
  ('28030000-0000-0000-0000-000000000110', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-0000000000e1', 'RSD DSR WO A', 'Issued', 10000, 'exclusive', 0),
  ('28030000-0000-0000-0000-000000000111', '28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-0000000000e2', 'RSD DSR WO B', 'Issued', 10000, 'exclusive', 0),
  -- Drafts inserted AFTER the seeds (§2), then issued through the update trigger (§5/§6)
  ('28030000-0000-0000-0000-000000000130', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-0000000000e1', 'RSD Issue WO A', 'Draft', 10000, 'exclusive', 0),
  ('28030000-0000-0000-0000-000000000131', '28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-0000000000e2', 'RSD Issue WO B', 'Draft', 10000, 'exclusive', 0);

-- ── material-request plan figure: a priced allowance of 10 units on work order A ─────────────────────────────
insert into stock_units (id, org_id, code, name, whole_only) values
  ('28030000-0000-0000-0000-000000000200', '28030000-0000-0000-0000-0000000000a1', 'BAG', 'Bag', true),
  ('28030000-0000-0000-0000-000000000201', '28030000-0000-0000-0000-0000000000a2', 'BAG', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('28030000-0000-0000-0000-000000000210', '28030000-0000-0000-0000-0000000000a1', 'CEM', 'Cement', '28030000-0000-0000-0000-000000000200'),
  ('28030000-0000-0000-0000-000000000211', '28030000-0000-0000-0000-0000000000a2', 'CEM', 'Cement', '28030000-0000-0000-0000-000000000201');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('28030000-0000-0000-0000-000000000220', '28030000-0000-0000-0000-0000000000a1', 'RSD-C', 'Central', 'central', null),
  ('28030000-0000-0000-0000-000000000221', '28030000-0000-0000-0000-0000000000a1', 'RSD-S', 'Site A',  'site', '28030000-0000-0000-0000-0000000000e1'),
  ('28030000-0000-0000-0000-000000000222', '28030000-0000-0000-0000-0000000000a2', 'RSD-B', 'Store B', 'central', null);
-- a named keeper only on 221 (the keeperless fallback is per warehouse)
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000221', '28030000-0000-0000-0000-0000000000b5');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('28030000-0000-0000-0000-000000000230', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-0000000000e1', 'L-A', 'Priced pipe', 'm', 100, 100),
  ('28030000-0000-0000-0000-000000000231', '28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-0000000000e2', 'L-B', 'Priced trench', 'm', 100, 80);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('28030000-0000-0000-0000-000000000240', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000100', '28030000-0000-0000-0000-000000000230', 10),
  ('28030000-0000-0000-0000-000000000241', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000110', '28030000-0000-0000-0000-000000000230', 100),
  ('28030000-0000-0000-0000-000000000242', '28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-000000000111', '28030000-0000-0000-0000-000000000231', 100);
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity) values
  ('28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000230', '28030000-0000-0000-0000-000000000210', 1);

-- ── crews and tool lines (the field-controller fallback) ─────────────────────────────────────────────────────
insert into crews (id, org_id, code, name, field_controller_id) values
  ('28030000-0000-0000-0000-000000000300', '28030000-0000-0000-0000-0000000000a1', 'CA', 'Crew no controller', null),
  ('28030000-0000-0000-0000-000000000301', '28030000-0000-0000-0000-0000000000a1', 'CB', 'Crew with controller', '28030000-0000-0000-0000-0000000000b4'),
  ('28030000-0000-0000-0000-000000000302', '28030000-0000-0000-0000-0000000000a2', 'CC', 'Crew B no controller', null);
insert into crew_tool_lines (id, org_id, crew_id, name, serial, held_qty) values
  ('28030000-0000-0000-0000-000000000310', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000300', 'Hammer A', null, 5),
  ('28030000-0000-0000-0000-000000000311', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000301', 'Hammer B', null, 5),
  ('28030000-0000-0000-0000-000000000312', '28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-000000000302', 'Hammer C', null, 5);

-- ── daily site reports: submitted reports whose author is never the validator ────────────────────────────────
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, author_id, status, submitted_at) values
  ('28030000-0000-0000-0000-000000000400', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-0000000000e1',
   '28030000-0000-0000-0000-000000000110', current_date - 1, '28030000-0000-0000-0000-0000000000b2', 'submitted', now()),
  ('28030000-0000-0000-0000-000000000401', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-0000000000e1',
   '28030000-0000-0000-0000-000000000110', current_date - 2, '28030000-0000-0000-0000-0000000000b2', 'submitted', now()),
  ('28030000-0000-0000-0000-000000000402', '28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-0000000000e2',
   '28030000-0000-0000-0000-000000000111', current_date - 1, '28030000-0000-0000-0000-0000000000ca', 'submitted', now()),
  ('28030000-0000-0000-0000-000000000403', '28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-0000000000e2',
   '28030000-0000-0000-0000-000000000111', current_date - 2, '28030000-0000-0000-0000-0000000000ca', 'submitted', now());
insert into dsr_progress_lines (id, org_id, report_id, position, work_order_line_id, quantity, unit) values
  ('28030000-0000-0000-0000-000000000410', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000400', 1, '28030000-0000-0000-0000-000000000241', 5, 'm'),
  ('28030000-0000-0000-0000-000000000411', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000401', 1, '28030000-0000-0000-0000-000000000241', 5, 'm'),
  ('28030000-0000-0000-0000-000000000412', '28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-000000000402', 1, '28030000-0000-0000-0000-000000000242', 5, 'm'),
  ('28030000-0000-0000-0000-000000000413', '28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-000000000403', 1, '28030000-0000-0000-0000-000000000242', 5, 'm');
insert into storage.objects (bucket_id, name, owner) values
  ('site-report-photos', '28030000-0000-0000-0000-0000000000a1/28030000-0000-0000-0000-000000000400/28030000-0000-0000-0000-0000000004f0/form.jpg', '28030000-0000-0000-0000-0000000000b2'),
  ('site-report-photos', '28030000-0000-0000-0000-0000000000a1/28030000-0000-0000-0000-000000000401/28030000-0000-0000-0000-0000000004f1/form.jpg', '28030000-0000-0000-0000-0000000000b2'),
  ('site-report-photos', '28030000-0000-0000-0000-0000000000a2/28030000-0000-0000-0000-000000000402/28030000-0000-0000-0000-0000000004f2/form.jpg', '28030000-0000-0000-0000-0000000000ca'),
  ('site-report-photos', '28030000-0000-0000-0000-0000000000a2/28030000-0000-0000-0000-000000000403/28030000-0000-0000-0000-0000000004f3/form.jpg', '28030000-0000-0000-0000-0000000000ca');
insert into dsr_photos (org_id, report_id, kind, file_path) values
  ('28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000400', 'paper_form', '28030000-0000-0000-0000-0000000000a1/28030000-0000-0000-0000-000000000400/28030000-0000-0000-0000-0000000004f0/form.jpg'),
  ('28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000401', 'paper_form', '28030000-0000-0000-0000-0000000000a1/28030000-0000-0000-0000-000000000401/28030000-0000-0000-0000-0000000004f1/form.jpg'),
  ('28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-000000000402', 'paper_form', '28030000-0000-0000-0000-0000000000a2/28030000-0000-0000-0000-000000000402/28030000-0000-0000-0000-0000000004f2/form.jpg'),
  ('28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-000000000403', 'paper_form', '28030000-0000-0000-0000-0000000000a2/28030000-0000-0000-0000-000000000403/28030000-0000-0000-0000-0000000004f3/form.jpg');

-- ── documents for the close-out items ────────────────────────────────────────────────────────────────────────
insert into project_documents (id, org_id, project_id, category, title, status, file_path) values
  ('28030000-0000-0000-0000-000000000600', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-0000000000e1', 'Report', 'Close-out letter', 'Issued', '/rsd/closeout-a.pdf'),
  ('28030000-0000-0000-0000-000000000601', '28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-0000000000e2', 'Report', 'Close-out report', 'Issued', '/rsd/closeout-b.pdf');

-- ── Org C keeps its own settings BEFORE the seeds run: the guards must skip it ───────────────────────────────
insert into work_order_checklist_items (id, org_id, label, position, required, owner_job_role, target_days) values
  ('28030000-0000-0000-0000-000000000500', '28030000-0000-0000-0000-0000000000a3', 'C own check', 1, true, 'planner', 2);
insert into approval_chain_steps (id, org_id, position, role, label, only_over_plan) values
  ('28030000-0000-0000-0000-000000000510', '28030000-0000-0000-0000-0000000000a3', 1, 'Finance', 'C own stock step', false);
insert into closeout_checklist_templates (id, org_id, position, name, required) values
  ('28030000-0000-0000-0000-000000000520', '28030000-0000-0000-0000-0000000000a3', 1, 'C own handover', true);
insert into billing_step_templates (id, org_id, name) values
  ('28030000-0000-0000-0000-000000000530', '28030000-0000-0000-0000-0000000000a3', 'C own checklist');
insert into billing_step_template_steps (org_id, template_id, position, name, owner_role, owner_role_key) values
  ('28030000-0000-0000-0000-0000000000a3', '28030000-0000-0000-0000-000000000530', 1, 'C own step', 'Finance', 'billing_officer');
insert into org_billing_step_settings (org_id, default_template_id) values
  ('28030000-0000-0000-0000-0000000000a3', '28030000-0000-0000-0000-000000000530');

-- ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.err(p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.as_user(p_uid);
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
create or replace function pg_temp.val(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_user(p_uid);
  execute p_sql into v;
  return coalesce(v, '<null>');
exception when others then
  return 'error ' || sqlstate || ' ' || sqlerrm;
end $$;

-- ── §1 the seeds (AC-RSD-001/002/004/005/008) ────────────────────────────────────────────────────────────────
select lives_ok($$ select public.seed_org_defaults('28030000-0000-0000-0000-0000000000a1') $$,
  'the defaults seed runs for a level-only organisation');
select lives_ok($$ select public.seed_org_defaults('28030000-0000-0000-0000-0000000000a2') $$,
  'the defaults seed runs for a keyed organisation');

select is((select string_agg(owner_job_role, ',' order by position) from work_order_checklist_items
            where org_id = '28030000-0000-0000-0000-0000000000a1' and archived_at is null),
  'engineer,storekeeper,project_control_manager,hr_officer',
  'AC-RSD-001 the default standard checks name engineer, storekeeper, project_control_manager, hr_officer');
select is((select string_agg(job_role, ',' order by position) from approval_chain_steps
            where org_id = '28030000-0000-0000-0000-0000000000a1'),
  'material_coordinator,project_control_manager,construction_manager',
  'AC-RSD-002 the default chain is coordinator, control manager, construction manager');
select is((select (bool_and(only_over_plan) filter (where position = 3))
              and not coalesce((bool_or(only_over_plan) filter (where position in (1, 2))), false)
             from approval_chain_steps where org_id = '28030000-0000-0000-0000-0000000000a1'), true,
  'AC-RSD-002 only the construction-manager step applies above plan');
select is((select string_agg(owner_job_role, ',' order by position) from closeout_checklist_templates
            where org_id = '28030000-0000-0000-0000-0000000000a1'),
  'project_control_manager,project_control_manager,storekeeper,project_control_manager,project_control_manager',
  'AC-RSD-005 the default close-out owners are the control manager (certificates) and the storekeeper (material report)');
select is((select s.name || ':' || t.name || ':' || st.owner_role_key
             from org_billing_step_settings s
             join billing_step_templates t on t.id = s.default_template_id
             join billing_step_template_steps st on st.template_id = t.id and st.position = 1
            where s.org_id = '28030000-0000-0000-0000-0000000000a1'),
  'Standard billing checklist:QC report:quality_inspector',
  'AC-RSD-004 the default billing checklist ships a QC report step owned by quality_inspector');  -- mut:rsd_billing_seed_owner
select is((select bool_and(required) from closeout_checklist_templates
            where org_id = '28030000-0000-0000-0000-0000000000a1'), true,
  'AC-RSD-005 the default close-out items are required');
select is((select pcm_scheduled_reports_enabled from organizations
            where id = '28030000-0000-0000-0000-0000000000a1'), true,
  'AC-RSD-008 the Project Control Manager scheduled reports ship enabled (2580, unchanged)');

-- Org C keeps its own settings: the seed's guards must skip every table.
select public.seed_org_defaults('28030000-0000-0000-0000-0000000000a3');
select is((select (select count(*)::text from work_order_checklist_items where org_id = '28030000-0000-0000-0000-0000000000a3')
        || '|' || (select count(*)::text from approval_chain_steps where org_id = '28030000-0000-0000-0000-0000000000a3')
        || '|' || (select count(*)::text from closeout_checklist_templates where org_id = '28030000-0000-0000-0000-0000000000a3')
        || '|' || (select count(*)::text from billing_step_templates where org_id = '28030000-0000-0000-0000-0000000000a3')
        || '|' || (select label from work_order_checklist_items where org_id = '28030000-0000-0000-0000-0000000000a3')),
  '1|1|1|1|C own check',
  'AC-RSD-001 an organisation that keeps its own settings is not overwritten');  -- mut:rsd_seed_checks_guard

-- Idempotent: a second run adds nothing.
select public.seed_org_defaults('28030000-0000-0000-0000-0000000000a1');
select is((select (select count(*)::text from work_order_checklist_items where org_id = '28030000-0000-0000-0000-0000000000a1')
        || '|' || (select count(*)::text from approval_chain_steps where org_id = '28030000-0000-0000-0000-0000000000a1')
        || '|' || (select count(*)::text from closeout_checklist_templates where org_id = '28030000-0000-0000-0000-0000000000a1')
        || '|' || (select count(*)::text from billing_step_templates where org_id = '28030000-0000-0000-0000-0000000000a1')),
  '4|3|5|1', 'AC-RSD-001 the seed is idempotent');

-- ── §2 the standard checks copy onto a captured Draft (AC-RSD-001) ───────────────────────────────────────────
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('28030000-0000-0000-0000-000000000140', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-0000000000e1', 'RSD Draft WO 3', 'Draft', 10000, 'exclusive', 0);
select is((select count(*)::int from tasks where work_order_id = '28030000-0000-0000-0000-000000000140'), 4,
  'AC-RSD-001 a captured Draft carries the four default check tasks');
select is((select bool_and(assignee_id is null) from tasks where work_order_id = '28030000-0000-0000-0000-000000000140'), true,
  'AC-RSD-001 with no keys assigned the check tasks start unassigned (2680 rule)');
select is((select bool_and(end_date = public.native_org_today('28030000-0000-0000-0000-0000000000a1') + 1)
             from tasks where work_order_id = '28030000-0000-0000-0000-000000000140'), true,
  'AC-RSD-001 each default check is due the next org day (target 1 day)');

-- The Admin replaces the list; the replacement wins and the defaults are gone.
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b1',
  $$ select public.set_work_order_check_template('[{"label":"Only the safety walk","owner_job_role":"site_supervisor","target_days":2}]'::jsonb) $$),
  'ok', 'AC-RSD-001 an Admin replaces the standard checks');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('28030000-0000-0000-0000-000000000141', '28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-0000000000e1', 'RSD Draft WO 4', 'Draft', 10000, 'exclusive', 0);
select is((select label || ':' || owner_job_role from tasks where work_order_id = '28030000-0000-0000-0000-000000000141'),
  'Only the safety walk:site_supervisor',
  'AC-RSD-001 the Admin''s list is the only list copied afterwards (explicit value wins)');

-- ── §3 the default request chain decides (AC-RSD-002) ────────────────────────────────────────────────────────
create or replace function pg_temp.raise_a(p_uid uuid, p_qty numeric, p_reason text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_user(p_uid);
  v := public.mrq_save_draft(null,
        jsonb_build_object('work_order_id', '28030000-0000-0000-0000-000000000100', 'needed_by', current_date + 5),
        jsonb_build_array(jsonb_build_object('item_id', '28030000-0000-0000-0000-000000000210', 'quantity', p_qty,
                                             'over_plan_reason', p_reason)));
  perform public.mrq_submit(v);
  return v;
end $$;
create or replace function pg_temp.raise_b(p_uid uuid, p_qty numeric, p_reason text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_user(p_uid);
  v := public.mrq_save_draft(null,
        jsonb_build_object('work_order_id', '28030000-0000-0000-0000-000000000101', 'needed_by', current_date + 5),
        jsonb_build_array(jsonb_build_object('item_id', '28030000-0000-0000-0000-000000000211', 'quantity', p_qty,
                                             'over_plan_reason', p_reason)));
  perform public.mrq_submit(v);
  return v;
end $$;
create temp table t_rsd (k text primary key, v uuid not null);
insert into t_rsd values
  ('a_over',   pg_temp.raise_a('28030000-0000-0000-0000-0000000000b2', 50, 'extra pour')),
  ('a_within', pg_temp.raise_a('28030000-0000-0000-0000-0000000000b2', 5, null)),
  ('b_over',   pg_temp.raise_b('28030000-0000-0000-0000-0000000000ca', 5, 'over'));

-- Org A: plan 10 on the work order. Above plan → three steps; within plan → two.
select is((select count(*)::int from material_request_steps where request_id = (select v from t_rsd where k = 'a_over')), 3,
  'AC-RSD-002 a request above plan snapshots all three default steps');
select is((select count(*)::int from material_request_steps where request_id = (select v from t_rsd where k = 'a_within')), 2,
  'AC-RSD-002 a request within plan snapshots two steps');  -- mut:rsd_chain_over_plan
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b2',
  $$ select public.mrq_decide_step((select v from t_rsd where k = 'a_within'), 1, 'approve') $$),
  '42501 MRQ_SOD_AUTHOR: you cannot decide a request you raised',
  'AC-RSD-002 the author never decides their own request (unchanged SoD)');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b6',
  $$ select public.mrq_decide_step((select v from t_rsd where k = 'a_over'), 3, 'approve') $$),
  'P0001 MRQ_OUT_OF_ORDER: step 3 is not the open step; steps are decided in order',
  'AC-RSD-002 steps decide in order (unchanged)');

-- The within-plan request: step 1 by an unkeyed Engineer (level inclusion), step 2 by an unkeyed control manager.
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b3',
  $$ select public.mrq_decide_step((select v from t_rsd where k = 'a_within'), 1, 'approve') $$), 'ok',
  'AC-RSD-002 an unkeyed Engineer decides the coordinator step (level inclusion)');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b4',
  $$ select public.mrq_decide_step((select v from t_rsd where k = 'a_within'), 2, 'approve') $$), 'ok',
  'AC-RSD-002 an unkeyed Project Manager decides the control-manager step');
-- The above-plan request: step 3 goes to a DIFFERENT construction manager (one person, one step).
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b3',
  $$ select public.mrq_decide_step((select v from t_rsd where k = 'a_over'), 1, 'approve') $$), 'ok',
  'AC-RSD-002 the above-plan request starts at its coordinator step');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b6',
  $$ select public.mrq_decide_step((select v from t_rsd where k = 'a_over'), 2, 'approve') $$), 'ok',
  'AC-RSD-002 the second control-manager-level person decides step 2');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b4',
  $$ select public.mrq_decide_step((select v from t_rsd where k = 'a_over'), 3, 'approve') $$), 'ok',
  'AC-RSD-002 the construction-manager step decides the above-plan request');

-- Org B (keyed people): the keyed holders decide; a keyed person of another step's role cannot take it.
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c2',
  $$ select public.mrq_decide_step((select v from t_rsd where k = 'b_over'), 1, 'approve') $$), 'ok',
  'AC-RSD-002 the keyed material coordinator decides step 1');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c5',
  $$ select public.mrq_decide_step((select v from t_rsd where k = 'b_over'), 2, 'approve') $$), 'ok',
  'AC-RSD-002 the keyed control manager decides step 2');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c5',
  $$ select public.mrq_decide_step((select v from t_rsd where k = 'b_over'), 3, 'approve') $$),
  '42501 MRQ_SOD_TWICE: you already decided another step of this request',
  'AC-RSD-002 one person still decides one step (unchanged SoD)');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c3',
  $$ select public.mrq_decide_step((select v from t_rsd where k = 'b_over'), 3, 'approve') $$), 'ok',
  'AC-RSD-002 the keyed construction manager decides the over-plan step');

-- An Admin-set chain replaces the default (explicit value wins).
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c1',
  $$ select public.mrq_set_chain('[{"job_role":"storekeeper","label":"Store check"}]'::jsonb) $$), 'ok',
  'AC-RSD-002 an Admin sets their own chain (built-in roles on)');
insert into t_rsd values ('b_admin', pg_temp.raise_b('28030000-0000-0000-0000-0000000000ca', 5, 'over again'));
select is((select count(*)::int from material_request_steps where request_id = (select v from t_rsd where k = 'b_admin')), 1,
  'AC-RSD-002 the Admin''s chain is the one snapshotted afterwards');  -- mut:rsd_chain_admin_wins

-- ── §4 the daily-report validators (AC-RSD-003) ──────────────────────────────────────────────────────────────
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b3',
  $$ select public.dsr_validate('28030000-0000-0000-0000-000000000400') $$), 'ok',
  'AC-RSD-003 an unkeyed Engineer validates by default (fills quantity_surveyor)');  -- mut:rsd_dsr_default_includes
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b4',
  $$ select public.dsr_validate('28030000-0000-0000-0000-000000000401') $$), 'ok',
  'AC-RSD-003 an unkeyed Project Manager validates by default (fills project_control_manager)');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b3',
  $$ select public.dsr_validate('28030000-0000-0000-0000-000000000401') $$),
  '42501 the author of a report cannot validate it',
  'AC-RSD-003 the author never validates their own report (unchanged SoD)');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b5',
  $$ select public.dsr_validate('28030000-0000-0000-0000-000000000401') $$), 'ok',
  'AC-RSD-003 Finance still validates (unchanged path)');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000b3',
  $$ select exists (select 1 from public.dsr_validation_queue() q
                     where q.report_id = '28030000-0000-0000-0000-000000000401') $$), 'true',
  'AC-RSD-003 a default validator sees the report in the validation queue');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000b4',
  $$ select (public.get_dsr_validation_route('28030000-0000-0000-0000-000000000401'))->>'route_kind' $$),
  'project_manager',
  'AC-RSD-003 the validation route still names the project''s manager first');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000b4',
  $$ select coalesce((public.get_dsr_validation_route('28030000-0000-0000-0000-000000000401')->'validate_roles')::text, 'absent') $$),
  '["project_control_manager", "quantity_surveyor"]',
  'AC-RSD-003 the route names the default validator roles while nothing is set');  -- mut:rsd_dsr_default_keys

-- Org B: an Admin list overrides the default and admits key holders only.
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c1',
  $$ select public.set_daily_report_validate_roles(array['quantity_surveyor']::text[]) $$), 'ok',
  'AC-RSD-003 an Admin sets the validator roles');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c6',
  $$ select public.dsr_validate('28030000-0000-0000-0000-000000000402') $$),
  '42501 you cannot validate site reports on this project',
  'AC-RSD-003 an unkeyed Engineer is refused once the Admin set their own list');  -- mut:rsd_dsr_admin_wins
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c4',
  $$ select public.dsr_validate('28030000-0000-0000-0000-000000000402') $$), 'ok',
  'AC-RSD-003 the Admin''s keyed quantity surveyor validates');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c1',
  $$ select public.set_daily_report_validate_roles(array['hr_officer']::text[]) $$), 'ok',
  'AC-RSD-003 the Admin names a role with no holder');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000c1',
  $$ select (select q.waiting_for_validator from public.dsr_validation_queue() q
              where q.report_id = '28030000-0000-0000-0000-000000000403') $$), 'true',
  'AC-RSD-003 a report with no eligible validator waits for one');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000c1',
  $$ select (public.get_dsr_validation_route('28030000-0000-0000-0000-000000000403'))->>'route_kind' $$),
  'nobody', 'AC-RSD-003 the route resolves as nobody with no eligible validator');

-- ── §5 the billing QC step (AC-RSD-004) ──────────────────────────────────────────────────────────────────────
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b1',
  $$ update work_orders set status = 'Issued' where id = '28030000-0000-0000-0000-000000000130' $$), 'ok',
  'the Admin issues the work order');
select is((select name || '|' || owner_role_key || '|' || (started_on is not null)::text
             from work_order_billing_steps where work_order_id = '28030000-0000-0000-0000-000000000130'),
  'QC report|quality_inspector|true',
  'AC-RSD-004 the issued work order carries the default QC report step');  -- mut:rsd_billing_seed_owner
select is((select count(*)::int from notifications
            where owner_id = '28030000-0000-0000-0000-0000000000b1'
              and metadata->'entity'->>'id' = '28030000-0000-0000-0000-000000000130'), 1,
  'AC-RSD-004 with no keyed holder the step-opening notice reaches an Admin (1936 fallback)');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000b3',
  $$ select public.wo_step_owner_matches('quality_inspector', '28030000-0000-0000-0000-0000000000e1') $$), 'true',
  'AC-RSD-004 an unkeyed Engineer owns the QC step by level (holds_job_role)');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c1',
  $$ update work_orders set status = 'Issued' where id = '28030000-0000-0000-0000-000000000131' $$), 'ok',
  'the keyed organisation issues its work order');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000c7',
  $$ select public.wo_step_owner_matches('quality_inspector', '28030000-0000-0000-0000-0000000000e2') $$), 'true',
  'AC-RSD-004 the keyed quality inspector owns the QC step');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000c9',
  $$ select public.wo_step_owner_matches('quality_inspector', '28030000-0000-0000-0000-0000000000e2') $$), 'false',
  'AC-RSD-004 a keyed storekeeper does not own the QC step');
select is((select count(*)::int from notifications
            where owner_id = '28030000-0000-0000-0000-0000000000c7'
              and metadata->'entity'->>'id' = '28030000-0000-0000-0000-000000000131'), 1,
  'AC-RSD-004 the keyed owner is told when the step opens');

-- ── §6 the close-out items (AC-RSD-005) ──────────────────────────────────────────────────────────────────────
select is((select string_agg(owner_job_role, ',' order by position) from work_order_closeout_items
            where work_order_id = '28030000-0000-0000-0000-000000000130'),
  'project_control_manager,project_control_manager,storekeeper,project_control_manager,project_control_manager',
  'AC-RSD-005 the issued checklist copies the default owners');  -- mut:rsd_closeout_seed_owner
-- Org A keeps no keys: only Admin, Finance and the project's own manager record items.
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b3',
  $$ select public.complete_closeout_item((select id from work_order_closeout_items
                                            where work_order_id = '28030000-0000-0000-0000-000000000130' and position = 1), current_date) $$),
  '42501 only Finance, an Admin or the project''s manager can record close-out items',
  'AC-RSD-005 an unkeyed Engineer is refused (the owner key is read by the held key only)');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b4',
  $$ select public.attach_closeout_item_document((select id from work_order_closeout_items
                                                   where work_order_id = '28030000-0000-0000-0000-000000000130' and position = 1),
                                                 '28030000-0000-0000-0000-000000000600') $$), 'ok',
  'AC-RSD-005 the project''s own manager attaches the first item''s document');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b4',
  $$ select public.complete_closeout_item((select id from work_order_closeout_items
                                            where work_order_id = '28030000-0000-0000-0000-000000000130' and position = 1), current_date) $$), 'ok',
  'AC-RSD-005 the project''s own manager records the first item');
-- Org B: the admin clears items 1–2, then the keyed storekeeper records the material completion report (position 3).
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c1',
  $$ select public.attach_closeout_item_document((select id from work_order_closeout_items
                                                   where work_order_id = '28030000-0000-0000-0000-000000000131' and position = 1),
                                                 '28030000-0000-0000-0000-000000000601') $$), 'ok',
  'AC-RSD-005 the Admin attaches the first item''s document');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c1',
  $$ select public.complete_closeout_item((select id from work_order_closeout_items
                                            where work_order_id = '28030000-0000-0000-0000-000000000131' and position = 1), current_date) $$), 'ok',
  'AC-RSD-005 the Admin records the first item');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c1',
  $$ select public.attach_closeout_item_document((select id from work_order_closeout_items
                                                   where work_order_id = '28030000-0000-0000-0000-000000000131' and position = 2),
                                                 '28030000-0000-0000-0000-000000000601') $$), 'ok',
  'AC-RSD-005 the Admin attaches the second item''s document');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c1',
  $$ select public.complete_closeout_item((select id from work_order_closeout_items
                                            where work_order_id = '28030000-0000-0000-0000-000000000131' and position = 2), current_date) $$), 'ok',
  'AC-RSD-005 the Admin records the second item');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c9',
  $$ select public.attach_closeout_item_document((select id from work_order_closeout_items
                                                   where work_order_id = '28030000-0000-0000-0000-000000000131' and position = 3),
                                                 '28030000-0000-0000-0000-000000000601') $$), 'ok',
  'AC-RSD-005 the keyed storekeeper attaches their item''s document');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c9',
  $$ select public.complete_closeout_item((select id from work_order_closeout_items
                                            where work_order_id = '28030000-0000-0000-0000-000000000131' and position = 3), current_date) $$), 'ok',
  'AC-RSD-005 the keyed storekeeper records the material completion report');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c6',
  $$ select public.complete_closeout_item((select id from work_order_closeout_items
                                            where work_order_id = '28030000-0000-0000-0000-000000000131' and position = 4), current_date) $$),
  '42501 only Finance, an Admin or the project''s manager can record close-out items',
  'AC-RSD-005 an unkeyed Engineer cannot record a control-manager item');

-- ── §7 the keeper fallback (AC-RSD-006) ──────────────────────────────────────────────────────────────────────
select is(pg_temp.val('28030000-0000-0000-0000-0000000000b3',
  $$ select public.stock_assert_keeper('28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000220',
                                       '28030000-0000-0000-0000-0000000000b3') $$), 'false',
  'AC-RSD-006 an unkeyed Engineer passes the keeper guard on a warehouse with no keeper named');  -- mut:rsd_keeper_default
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b4',
  $$ select public.stock_assert_keeper('28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000220',
                                       '28030000-0000-0000-0000-0000000000b4') $$),
  'P0001 STK_NOT_KEEPER: you do not keep this warehouse',
  'AC-RSD-006 a Project Manager level person is still refused (not a storekeeper)');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b3',
  $$ select public.stock_assert_keeper('28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000221',
                                       '28030000-0000-0000-0000-0000000000b3') $$),
  'P0001 STK_NOT_KEEPER: you do not keep this warehouse',
  'AC-RSD-006 a warehouse with a named keeper refuses another storekeeper');  -- mut:rsd_keeper_scoped
select is(pg_temp.val('28030000-0000-0000-0000-0000000000b5',
  $$ select public.stock_assert_keeper('28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000221',
                                       '28030000-0000-0000-0000-0000000000b5') $$), 'false',
  'AC-RSD-006 the named keeper still passes');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000b1',
  $$ select public.stock_assert_keeper('28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000220',
                                       '28030000-0000-0000-0000-0000000000b1') $$), 'true',
  'AC-RSD-006 the Admin override still returns true (and audits)');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000c9',
  $$ select public.stock_assert_keeper('28030000-0000-0000-0000-0000000000a2', '28030000-0000-0000-0000-000000000222',
                                       '28030000-0000-0000-0000-0000000000c9') $$), 'false',
  'AC-RSD-006 the keyed storekeeper passes on their keeperless warehouse');

-- ── §8 the crew field-controller fallback (AC-RSD-007) ───────────────────────────────────────────────────────
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b3',
  $$ select public.report_crew_tool(gen_random_uuid(), '28030000-0000-0000-0000-000000000310', 'lost', 1, 'stolen from store', null) $$), 'ok',
  'AC-RSD-007 an unkeyed Engineer reports a tool for a crew with no field controller');  -- mut:rsd_tool_default
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b4',
  $$ select public.report_crew_tool(gen_random_uuid(), '28030000-0000-0000-0000-000000000310', 'lost', 1, 'second loss', null) $$),
  '42501 CTR_NOT_ALLOWED: only the crew''s field controller or site supervisor, a crew manager or the keeper of its site store reports a tool',
  'AC-RSD-007 a Project Manager level person is still refused (not a site supervisor)');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b3',
  $$ select public.report_crew_tool(gen_random_uuid(), '28030000-0000-0000-0000-000000000311', 'lost', 1, 'loss on controlled crew', null) $$),
  '42501 CTR_NOT_ALLOWED: only the crew''s field controller or site supervisor, a crew manager or the keeper of its site store reports a tool',
  'AC-RSD-007 a crew with a named controller refuses another site supervisor');  -- mut:rsd_tool_named
select is(pg_temp.err('28030000-0000-0000-0000-0000000000b4',
  $$ select public.report_crew_tool(gen_random_uuid(), '28030000-0000-0000-0000-000000000311', 'lost', 1, 'controller reports', null) $$), 'ok',
  'AC-RSD-007 the named field controller still reports');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c8',
  $$ select public.report_crew_tool(gen_random_uuid(), '28030000-0000-0000-0000-000000000312', 'lost', 1, 'keyed supervisor', null) $$), 'ok',
  'AC-RSD-007 the keyed site supervisor reports for the controllerless crew');
select is(pg_temp.err('28030000-0000-0000-0000-0000000000c2',
  $$ select public.report_crew_tool(gen_random_uuid(), '28030000-0000-0000-0000-000000000312', 'lost', 1, 'keyed coordinator', null) $$),
  '42501 CTR_NOT_ALLOWED: only the crew''s field controller or site supervisor, a crew manager or the keeper of its site store reports a tool',
  'AC-RSD-007 a keyed member of another role is refused (a keyed person is judged by their key alone)');
-- The photo gates read the same identity: a damaged report needs its photo, so the fallback reaches the upload
-- (crew_tool_is_reporter, 1158) and the report's file rows (crew_tool_can_report, 2041) too.
select is(pg_temp.val('28030000-0000-0000-0000-0000000000c8',
  $$ select public.crew_tool_is_reporter() $$), 'true',
  'AC-RSD-007 the site supervisor of an organisation with a controllerless crew may upload a report photo');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000c9',
  $$ select public.crew_tool_is_reporter() $$), 'false',
  'AC-RSD-007 a keyed storekeeper is not a photo reporter (judged by their key alone)');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000c8',
  $$ select public.crew_tool_can_report('28030000-0000-0000-0000-000000000312') $$), 'true',
  'AC-RSD-007 the site supervisor may add a file to the controllerless crew''s open report');
select is(pg_temp.val('28030000-0000-0000-0000-0000000000c2',
  $$ select public.crew_tool_can_report('28030000-0000-0000-0000-000000000312') $$), 'false',
  'AC-RSD-007 a keyed coordinator may not add files to that report');

-- ── §9 hygiene ───────────────────────────────────────────────────────────────────────────────────────────────
select is((select string_agg(proname || ':' || coalesce((proconfig[array_upper(proconfig, 1)] ~ '^search_path=.*pg_temp$')::text, 'false'), ',' order by proname)
             from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('seed_org_defaults', 'stock_assert_keeper', 'report_crew_tool', 'actor_has_role_capability',
                              'dsr_validation_queue', 'get_dsr_validation_route', 'dsr_validate_role_keys', 'dsr_fills_validate_role',
                              'crew_tool_is_reporter', 'crew_tool_can_report')),
  'actor_has_role_capability:true,crew_tool_can_report:true,crew_tool_is_reporter:true,dsr_fills_validate_role:true,dsr_validate_role_keys:true,dsr_validation_queue:true,get_dsr_validation_route:true,report_crew_tool:true,seed_org_defaults:true,stock_assert_keeper:true',
  'every function this round touches sets its search path with pg_temp last');

select * from finish();
rollback;
