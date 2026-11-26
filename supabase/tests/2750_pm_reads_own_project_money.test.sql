-- 2750_pm_reads_own_project_money.test.sql — a Project Manager reads project money for their own projects.
-- Migration under test: 2750_pm_reads_own_project_money.sql.
-- Every denial for a Project Manager of another project is the invisible shape (not found, no rows, or the money withheld),
-- the same as a project that does not exist. Roles above Project Manager and other organisations are unchanged.
-- Mutation check: make project_money_in_scope return true and the Project Manager "other project" cases below go red.
begin;
create extension if not exists pgtap;
select no_plan();

insert into organizations (id, name, default_currency) values
  ('27500000-0000-0000-0000-00000000000a', 'PS1 Org',       'IDR'),
  ('27500000-0000-0000-0000-00000000000b', 'PS1 Other Org', 'IDR');
insert into auth.users (id, email) values
  ('27500000-0000-0000-0000-0000000000a1', 'ps1-admin@example.com'),
  ('27500000-0000-0000-0000-0000000000a2', 'ps1-fin@example.com'),
  ('27500000-0000-0000-0000-0000000000a3', 'ps1-pm-a@example.com'),
  ('27500000-0000-0000-0000-0000000000a4', 'ps1-pm-b@example.com'),
  ('27500000-0000-0000-0000-0000000000b1', 'ps1-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27500000-0000-0000-0000-0000000000a1', '27500000-0000-0000-0000-00000000000a', 'PS1 Admin', 'ps1-admin@example.com', 'Admin', 'active'),
  ('27500000-0000-0000-0000-0000000000a2', '27500000-0000-0000-0000-00000000000a', 'PS1 Fin',   'ps1-fin@example.com',   'Finance', 'active'),
  ('27500000-0000-0000-0000-0000000000a3', '27500000-0000-0000-0000-00000000000a', 'PS1 PM A',  'ps1-pm-a@example.com',  'Project Manager', 'active'),
  ('27500000-0000-0000-0000-0000000000a4', '27500000-0000-0000-0000-00000000000a', 'PS1 PM B',  'ps1-pm-b@example.com',  'Project Manager', 'active'),
  ('27500000-0000-0000-0000-0000000000b1', '27500000-0000-0000-0000-00000000000b', 'PS1 XOrg',  'ps1-xorg@example.com',  'Admin', 'active');
-- A is managed by PM A, B by PM B.
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('27500000-0000-0000-0000-0000000000d1', '27500000-0000-0000-0000-00000000000a', 'PS1 Project A', 'Ongoing Project', '27500000-0000-0000-0000-0000000000a3', 'IDR'),
  ('27500000-0000-0000-0000-0000000000d2', '27500000-0000-0000-0000-00000000000a', 'PS1 Project B', 'Ongoing Project', '27500000-0000-0000-0000-0000000000a4', 'IDR');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('27500000-0000-0000-0000-00000000000a', 'erpnext', 'https://erp.example.test', 'test-ref', '{"company":"PS1 Co","project_map":{"27500000-0000-0000-0000-0000000000d2":"ERP-B"}}'::jsonb, now(), 'active');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('27500000-0000-0000-0000-000000000401', '27500000-0000-0000-0000-00000000000a', '27500000-0000-0000-0000-0000000000d1', 'WO-A', 'PS1 WO A', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('27500000-0000-0000-0000-000000000402', '27500000-0000-0000-0000-00000000000a', '27500000-0000-0000-0000-0000000000d2', 'WO-B', 'PS1 WO B', 'Issued', 10000, 'exclusive', 0, 'IDR');
set local session_replication_role = replica;
insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, required_for, status, created_by, estimate, estimate_currency) values
  ('27500000-0000-0000-0000-000000000a01', '27500000-0000-0000-0000-00000000000a', '27500000-0000-0000-0000-000000000401', '27500000-0000-0000-0000-0000000000d1', 'Insp A', '2026-12-01', '{}', 'requested', '27500000-0000-0000-0000-0000000000a3', 777, 'IDR'),
  ('27500000-0000-0000-0000-000000000a02', '27500000-0000-0000-0000-00000000000a', '27500000-0000-0000-0000-000000000402', '27500000-0000-0000-0000-0000000000d2', 'Insp B', '2026-12-01', '{}', 'requested', '27500000-0000-0000-0000-0000000000a4', 888, 'IDR');
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, currency) values
  ('27500000-0000-0000-0000-000000000601', '27500000-0000-0000-0000-00000000000a', 'PS1 buy A', '27500000-0000-0000-0000-0000000000d1', '27500000-0000-0000-0000-0000000000a3', 'Ordered', 600, 600, 'IDR'),
  ('27500000-0000-0000-0000-000000000602', '27500000-0000-0000-0000-00000000000a', 'PS1 buy B', '27500000-0000-0000-0000-0000000000d2', '27500000-0000-0000-0000-0000000000a4', 'Ordered', 600, 600, 'IDR');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency) values
  ('27500000-0000-0000-0000-000000000621', '27500000-0000-0000-0000-00000000000a', '27500000-0000-0000-0000-000000000601', 'VI-A', '2026-11-16', 'Received', 500, 'exclusive', 0, 'IDR'),
  ('27500000-0000-0000-0000-000000000622', '27500000-0000-0000-0000-00000000000a', '27500000-0000-0000-0000-000000000602', 'VI-B', '2026-11-16', 'Received', 500, 'exclusive', 0, 'IDR');
-- B also carries a journal line from the books, an equipment usage and an issue of stock to a work item, so each
-- "no rows" / "withholds" case below would show B's money without the rule.
insert into budget_category_account_map (org_id, category, erp_account) values ('27500000-0000-0000-0000-00000000000a', 'Subcontractors', 'Project Subcontractors - X');
insert into erp_gl_entry_mirror (org_id, erp_name, company, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, remarks, erp_modified) values
  ('27500000-0000-0000-0000-00000000000a', 'ps1-g1', 'PS1 Co', 'Project Subcontractors - X', 'ERP-B', 'Journal Entry', 'JV-PS1', '2026-03-01', 60, 0, false, null, '2026-03-01');
insert into equipment_assets (id, org_id, code, name, default_unit) values ('27500000-0000-0000-0000-0000000000e1', '27500000-0000-0000-0000-00000000000a', 'PS1-GEN', 'Generator', 'hours');
insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, status, author_id, approver_id, approved_at) values
  ('27500000-0000-0000-0000-00000000000a', '27500000-0000-0000-0000-0000000000e1', '27500000-0000-0000-0000-0000000000d2', '2026-09-11', 4, 'hours', 'work', 'Approved', '27500000-0000-0000-0000-0000000000a1', '27500000-0000-0000-0000-0000000000a4', now());
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values ('27500000-0000-0000-0000-000000000b01', '27500000-0000-0000-0000-00000000000a', '27500000-0000-0000-0000-0000000000d2', 'B-1', 'Cabling', 'm', 10, 5);
insert into stock_units (id, org_id, code, name) values ('27500000-0000-0000-0000-000000000851', '27500000-0000-0000-0000-00000000000a', 'm', 'metre');
insert into stock_items (id, org_id, code, name, unit_id) values ('27500000-0000-0000-0000-000000000852', '27500000-0000-0000-0000-00000000000a', 'CBL', 'Cable', '27500000-0000-0000-0000-000000000851');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values ('27500000-0000-0000-0000-000000000801', '27500000-0000-0000-0000-00000000000a', 'PS1-C', 'Central', 'central', null);
insert into stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, occurred_on, created_by, posted_by, posted_at) values
  ('27500000-0000-0000-0000-000000000811', '27500000-0000-0000-0000-00000000000a', 'SI-PS1-1', 'issue', 'Posted', '27500000-0000-0000-0000-000000000801', '27500000-0000-0000-0000-0000000000d2', '2026-11-16', '27500000-0000-0000-0000-0000000000a4', '27500000-0000-0000-0000-0000000000a4', now());
insert into stock_document_lines (id, org_id, document_id, line_no, item_id, quantity, direction, boq_item_id) values ('27500000-0000-0000-0000-000000000821', '27500000-0000-0000-0000-00000000000a', '27500000-0000-0000-0000-000000000811', 1, '27500000-0000-0000-0000-000000000852', 3, 'out', '27500000-0000-0000-0000-000000000b01');
insert into stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, boq_item_id, kind, qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by) values
  ('27500000-0000-0000-0000-00000000000a', '27500000-0000-0000-0000-000000000811', '27500000-0000-0000-0000-000000000821', '27500000-0000-0000-0000-000000000852', '27500000-0000-0000-0000-000000000801', '27500000-0000-0000-0000-0000000000d2', '27500000-0000-0000-0000-000000000b01', 'issue', -3, -30, 0, 0, '2026-11-16', '27500000-0000-0000-0000-0000000000a4');
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- ── Project Manager A ────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('27500000-0000-0000-0000-0000000000a3');

select is(project_money_in_scope('27500000-0000-0000-0000-0000000000d1'), true,  'PS1 helper: own project is in scope');
select is(project_money_in_scope('27500000-0000-0000-0000-0000000000d2'), false, 'PS1 helper: another PM''s project is out of scope');
select is(project_money_in_scope(null), true, 'PS1 helper: money not bound to a project is outside the rule');

select lives_ok($$select * from work_order_cost_amounts('27500000-0000-0000-0000-0000000000d1')$$, 'PS1 own project: work_order_cost_amounts returns');
select throws_ok($$select * from work_order_cost_amounts('27500000-0000-0000-0000-0000000000d2')$$, 'P0002', 'project not found', 'PS1 other project: work_order_cost_amounts reads as not found');
select is((select count(*) from work_order_cost_amounts('27500000-0000-0000-0000-0000000000d1') where project_id = '27500000-0000-0000-0000-0000000000d1'),
          (select count(*) from work_order_cost_amounts('27500000-0000-0000-0000-0000000000d1')), 'PS1 own project: only own rows');
select lives_ok($$select * from work_order_idle_cost('27500000-0000-0000-0000-0000000000d1')$$, 'PS1 own project: work_order_idle_cost returns');
select throws_ok($$select * from work_order_idle_cost('27500000-0000-0000-0000-0000000000d2')$$, 'P0002', 'project not found', 'PS1 other project: work_order_idle_cost reads as not found');
select lives_ok($$select * from qcr_over_contract('27500000-0000-0000-0000-0000000000d1', false)$$, 'PS1 own project: qcr_over_contract returns');
select throws_ok($$select * from qcr_over_contract('27500000-0000-0000-0000-0000000000d2', false)$$, 'P0002', 'project not found', 'PS1 other project: qcr_over_contract reads as not found');

select is((select array_agg(project_id order by project_id) from get_projects_money_collection(array['27500000-0000-0000-0000-0000000000d1','27500000-0000-0000-0000-0000000000d2']::uuid[])),
          array['27500000-0000-0000-0000-0000000000d1']::uuid[], 'PS1 money collection returns only the Project Manager''s own project');

select lives_ok($$select * from get_project_finances('27500000-0000-0000-0000-0000000000d1')$$, 'PS1 own project: get_project_finances returns');
select throws_ok($$select * from get_project_finances('27500000-0000-0000-0000-0000000000d2')$$, 'P0002', 'project not found', 'PS1 other project: get_project_finances reads as not found');

select is((select estimate from tpi_costs('27500000-0000-0000-0000-000000000401')), 777::numeric, 'PS1 own work order: tpi_costs shows the estimate');
select is((select estimate from tpi_costs('27500000-0000-0000-0000-000000000402')), null::numeric, 'PS1 other work order: tpi_costs withholds the money');

select lives_ok($$select * from get_bill_match('27500000-0000-0000-0000-000000000621')$$, 'PS1 own project: get_bill_match returns');
select throws_ok($$select * from get_bill_match('27500000-0000-0000-0000-000000000622')$$, 'P0002', 'invoice not found', 'PS1 other project: get_bill_match reads as not found');
select is((select count(*) from project_erp_journal_lines('27500000-0000-0000-0000-0000000000d2')), 0::bigint, 'PS1 other project: project_erp_journal_lines returns no rows');
select is((select count(*) from list_equipment_allocations(null, '2026-01-01', '2026-12-31', '27500000-0000-0000-0000-0000000000d2')), 0::bigint, 'PS1 other project: list_equipment_allocations returns no rows');
select ok(not (get_project_consumption('27500000-0000-0000-0000-0000000000d2', '2026-01-01', '2026-12-31')::text like '%net_value%'), 'PS1 other project: get_project_consumption withholds the money');

-- ── Roles above Project Manager read both projects ───────────────────────────────────────────────
select pg_temp.act_as('27500000-0000-0000-0000-0000000000a2');
select is(project_money_in_scope('27500000-0000-0000-0000-0000000000d2'), true, 'PS1 Finance: helper in scope for any project');
select ok((select count(*) from project_erp_journal_lines('27500000-0000-0000-0000-0000000000d2')) > 0, 'PS1 Finance: B''s journal lines read');
select ok((select count(*) from list_equipment_allocations(null, '2026-01-01', '2026-12-31', '27500000-0000-0000-0000-0000000000d2')) > 0, 'PS1 Finance: B''s equipment allocations read');
select ok(get_project_consumption('27500000-0000-0000-0000-0000000000d2', '2026-01-01', '2026-12-31')::text like '%net_value%', 'PS1 Finance: B''s consumption carries its value');
select lives_ok($$select * from work_order_cost_amounts('27500000-0000-0000-0000-0000000000d2')$$, 'PS1 Finance: work_order_cost_amounts unchanged');
select is((select count(*) from get_projects_money_collection(array['27500000-0000-0000-0000-0000000000d1','27500000-0000-0000-0000-0000000000d2']::uuid[])), 2::bigint, 'PS1 Finance: money collection returns both projects');
select is((select estimate from tpi_costs('27500000-0000-0000-0000-000000000402')), 888::numeric, 'PS1 Finance: tpi_costs unchanged');
select lives_ok($$select * from get_project_finances('27500000-0000-0000-0000-0000000000d2')$$, 'PS1 Finance: get_project_finances unchanged');
select lives_ok($$select * from get_bill_match('27500000-0000-0000-0000-000000000622')$$, 'PS1 Finance: get_bill_match unchanged');

select pg_temp.act_as('27500000-0000-0000-0000-0000000000a1');
select lives_ok($$select * from qcr_over_contract('27500000-0000-0000-0000-0000000000d2', false)$$, 'PS1 Admin: qcr_over_contract unchanged');
select lives_ok($$select * from work_order_idle_cost('27500000-0000-0000-0000-0000000000d2')$$, 'PS1 Admin: work_order_idle_cost unchanged');

-- ── Another organisation is still refused ────────────────────────────────────────────────────────
select pg_temp.act_as('27500000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from work_order_cost_amounts('27500000-0000-0000-0000-0000000000d1')$$, 'P0002', 'project not found', 'PS1 other organisation: work_order_cost_amounts still refused');
select throws_ok($$select * from get_bill_match('27500000-0000-0000-0000-000000000621')$$, 'P0002', 'invoice not found', 'PS1 other organisation: get_bill_match still refused');

reset role;
select * from finish();
rollback;
