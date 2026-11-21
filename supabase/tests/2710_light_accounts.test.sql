-- 2710_light_accounts.test.sql — #2710 (docs/specs/light-accounts.spec.md).
-- Migrations under test: 1205 helpers, 1206 restrictive policies, 1207 my_home, 1208 seat report, 1209 definer guards.
-- AC-LA-001 seat type · AC-LA-002/003 a light account reads only its own rows · AC-LA-004 a full Engineer is unchanged ·
-- AC-LA-005 writes outside own items refused · AC-LA-006 my_home carries no price/budget · AC-LA-007 seat report ·
-- AC-LA-013 definer RPCs refuse a light account.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   drop policy light_account_deny_insert on projects ............ 'AC-LA-005 every covered table has the restrictive light_account_deny_* per-command policies'
--   drop policy light_account_scope_select on tasks .............. 'AC-LA-002 foreman reads only own tasks'
--   make actor_is_light() return false ........................... every AC-LA-002/003/005/013 assertion
--   is_light_role_key returns true for 'engineer' ................ 'AC-LA-001 an engineer is full'
--   drop trigger aa_tasks_light_status_only ...................... 'AC-LA-005 a light account cannot rename its task'
--   drop the guard line in org_credit_balance .................... 'AC-LA-013 org_credit_balance refuses a light account'
begin;
create extension if not exists pgtap;
select plan(55);

insert into organizations (id, name, default_currency, built_in_roles_enabled) values
  ('27100000-0000-0000-0000-00000000000a', 'LA Org',       'IDR', true),
  ('27100000-0000-0000-0000-00000000000b', 'LA Other Org', 'IDR', true);
insert into auth.users (id, email) values
  ('27100000-0000-0000-0000-0000000000a1', 'la-admin@example.com'),
  ('27100000-0000-0000-0000-0000000000a3', 'la-pm@example.com'),
  ('27100000-0000-0000-0000-0000000000a4', 'la-eng@example.com'),
  ('27100000-0000-0000-0000-0000000000a5', 'la-foreman@example.com'),
  ('27100000-0000-0000-0000-0000000000a6', 'la-field@example.com'),
  ('27100000-0000-0000-0000-0000000000a7', 'la-other@example.com'),
  ('27100000-0000-0000-0000-0000000000b1', 'la-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27100000-0000-0000-0000-0000000000a1', '27100000-0000-0000-0000-00000000000a', 'LA Admin',   'la-admin@example.com',   'Admin', 'active', null),
  ('27100000-0000-0000-0000-0000000000a3', '27100000-0000-0000-0000-00000000000a', 'LA PM',      'la-pm@example.com',      'Project Manager', 'active', null),
  ('27100000-0000-0000-0000-0000000000a4', '27100000-0000-0000-0000-00000000000a', 'LA Eng',     'la-eng@example.com',     'Engineer', 'active', null),
  ('27100000-0000-0000-0000-0000000000a5', '27100000-0000-0000-0000-00000000000a', 'LA Foreman', 'la-foreman@example.com', 'Engineer', 'active', 'foreman'),
  ('27100000-0000-0000-0000-0000000000a6', '27100000-0000-0000-0000-00000000000a', 'LA Field',   'la-field@example.com',   'Engineer', 'active', 'field_user'),
  ('27100000-0000-0000-0000-0000000000a7', '27100000-0000-0000-0000-00000000000a', 'LA Other',   'la-other@example.com',   'Engineer', 'active', 'engineer'),
  ('27100000-0000-0000-0000-0000000000b1', '27100000-0000-0000-0000-00000000000b', 'LA XOrg',    'la-xorg@example.com',    'Admin', 'active', null);

insert into projects (id, org_id, name, status, project_manager_id) values
  ('27100000-0000-0000-0000-0000000000d1', '27100000-0000-0000-0000-00000000000a', 'LA Site', 'Ongoing Project', '27100000-0000-0000-0000-0000000000a3');
insert into companies (id, org_id, name, type) values
  ('27100000-0000-0000-0000-000000000c91', '27100000-0000-0000-0000-00000000000a', 'LA Client', 'Client');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27100000-0000-0000-0000-000000000401', '27100000-0000-0000-0000-00000000000a', '27100000-0000-0000-0000-0000000000d1', 'LA WO rostered', 'Issued', 1000, 'exclusive', 0),
  ('27100000-0000-0000-0000-000000000402', '27100000-0000-0000-0000-00000000000a', '27100000-0000-0000-0000-0000000000d1', 'LA WO other',    'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('27100000-0000-0000-0000-000000000c01', '27100000-0000-0000-0000-00000000000a', 'LA-1', 'LA crew one', '27100000-0000-0000-0000-0000000000a5'),
  ('27100000-0000-0000-0000-000000000c02', '27100000-0000-0000-0000-00000000000a', 'LA-2', 'LA crew two', null);
insert into people (id, org_id, kind, name, profile_id) values
  ('27100000-0000-0000-0000-000000000f01', '27100000-0000-0000-0000-00000000000a', 'own', 'LA Field person',   '27100000-0000-0000-0000-0000000000a6'),
  ('27100000-0000-0000-0000-000000000f02', '27100000-0000-0000-0000-00000000000a', 'own', 'LA Colleague',      null),
  ('27100000-0000-0000-0000-000000000f03', '27100000-0000-0000-0000-00000000000a', 'own', 'LA Other crew man', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('27100000-0000-0000-0000-00000000000a', '27100000-0000-0000-0000-000000000c01', '27100000-0000-0000-0000-000000000f01', current_date - 30),
  ('27100000-0000-0000-0000-00000000000a', '27100000-0000-0000-0000-000000000c01', '27100000-0000-0000-0000-000000000f02', current_date - 30),
  ('27100000-0000-0000-0000-00000000000a', '27100000-0000-0000-0000-000000000c02', '27100000-0000-0000-0000-000000000f03', current_date - 30);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('27100000-0000-0000-0000-00000000000a', '27100000-0000-0000-0000-000000000401', '27100000-0000-0000-0000-000000000c01', current_date - 5),
  ('27100000-0000-0000-0000-00000000000a', '27100000-0000-0000-0000-000000000402', '27100000-0000-0000-0000-000000000c02', current_date - 5);
insert into tasks (id, org_id, project_id, name, assignee_id) values
  ('27100000-0000-0000-0000-000000000a01', '27100000-0000-0000-0000-00000000000a', '27100000-0000-0000-0000-0000000000d1', 'LA task foreman', '27100000-0000-0000-0000-0000000000a5'),
  ('27100000-0000-0000-0000-000000000a02', '27100000-0000-0000-0000-00000000000a', '27100000-0000-0000-0000-0000000000d1', 'LA task field',   '27100000-0000-0000-0000-0000000000a6'),
  ('27100000-0000-0000-0000-000000000a03', '27100000-0000-0000-0000-00000000000a', '27100000-0000-0000-0000-0000000000d1', 'LA task other',   '27100000-0000-0000-0000-0000000000a7');
insert into incident_reports (id, org_id, incident_date, type, severity, reported_by) values
  ('27100000-0000-0000-0000-000000000b01', '27100000-0000-0000-0000-00000000000a', current_date, 'Near miss', 'Low', '27100000-0000-0000-0000-0000000000a5'),
  ('27100000-0000-0000-0000-000000000b02', '27100000-0000-0000-0000-00000000000a', current_date, 'Near miss', 'Low', '27100000-0000-0000-0000-0000000000a6'),
  ('27100000-0000-0000-0000-000000000b03', '27100000-0000-0000-0000-00000000000a', current_date, 'Near miss', 'Low', '27100000-0000-0000-0000-0000000000a7');

-- AC-LA-001 seat type over the keys (independent literals)
select is(public.profile_seat_type('27100000-0000-0000-0000-0000000000a5'), 'light', 'AC-LA-001 a foreman is light');
select is(public.profile_seat_type('27100000-0000-0000-0000-0000000000a6'), 'light', 'AC-LA-001 a field user is light');
select is(public.profile_seat_type('27100000-0000-0000-0000-0000000000a7'), 'full', 'AC-LA-001 an engineer is full');
select is(public.profile_seat_type('27100000-0000-0000-0000-0000000000a4'), 'full', 'AC-LA-001 a person with no role key is full');
select is(public.profile_seat_type('27100000-0000-0000-0000-0000000000ff'), 'full', 'AC-LA-001 an unknown person is full');
select is((select count(*)::int from built_in_roles r where public.is_light_role_key(r.key)), 2, 'AC-LA-001 exactly two of the 28 keys are light');
select is((select array_agg(r.key order by r.key) from built_in_roles r where public.is_light_role_key(r.key)),
  array['field_user','foreman'], 'AC-LA-001 the two light keys are foreman and field_user');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
set local role authenticated;

-- AC-LA-004 a full Engineer (no key) sees exactly what it saw before: the whole organisation.
select pg_temp.act_as('27100000-0000-0000-0000-0000000000a4');
select is(public.actor_is_light(), false, 'AC-LA-001 a legacy engineer is not a light account');
select is((select count(*)::int from projects), 1, 'AC-LA-004 a full engineer reads the project');
select is((select count(*)::int from tasks), 3, 'AC-LA-004 a full engineer reads every task');
select is((select count(*)::int from incident_reports), 3, 'AC-LA-004 a full engineer reads every issue');
select is((select count(*)::int from work_orders), 2, 'AC-LA-004 a full engineer reads every work order');
select is((select count(*)::int from crews), 2, 'AC-LA-004 a full engineer reads every crew');
select is((select count(*)::int from companies), 1, 'AC-LA-004 a full engineer reads the company list');
select pg_temp.act_as('27100000-0000-0000-0000-0000000000a7');
select is((select count(*)::int from tasks), 3, 'AC-LA-004 an engineer holding the engineer key reads every task');

-- AC-LA-002 the Foreman
select pg_temp.act_as('27100000-0000-0000-0000-0000000000a5');
select is(public.actor_is_light(), true, 'AC-LA-001 the foreman is a light account');
select is((select array_agg(name) from tasks), array['LA task foreman'], 'AC-LA-002 foreman reads only own tasks');
select is((select count(*)::int from incident_reports), 1, 'AC-LA-002 foreman reads only issues they reported');
select is((select array_agg(title) from work_orders), array['LA WO rostered'], 'AC-LA-002 foreman reads only the rostered work order');
select is((select count(*)::int from crews), 1, 'AC-LA-002 foreman reads only the crew they lead');
select is((select count(*)::int from crew_members), 2, 'AC-LA-002 foreman reads the members of their crew');
select is((select count(*)::int from work_order_crews), 1, 'AC-LA-002 foreman reads only their crew''s roster row');
select is((select count(*)::int from projects) + (select count(*)::int from companies), 0, 'AC-LA-003 foreman reads no project and no company');

-- AC-LA-005 writes
select lives_ok($$ update tasks set status = 'In Progress' where id = '27100000-0000-0000-0000-000000000a01' $$,
  'AC-LA-005 a light account updates its own task');
select is((select status::text from tasks where id = '27100000-0000-0000-0000-000000000a01'), 'In Progress',
  'AC-LA-005 and the status of its own task changed');
select throws_ok($$ update tasks set name = 'renamed' where id = '27100000-0000-0000-0000-000000000a01' $$, '42501', null,
  'AC-LA-005 a light account cannot rename its task');
select lives_ok($$ update tasks set status = 'Done' where id = '27100000-0000-0000-0000-000000000a03' $$,
  'AC-LA-005 a light account''s update of another person''s task touches nothing');
reset role;
select is((select status::text from tasks where id = '27100000-0000-0000-0000-000000000a03'), 'To Do',
  'AC-LA-005 a light account cannot update another person''s task');
set local role authenticated;
select throws_ok($$ insert into tasks (project_id, name, assignee_id) values ('27100000-0000-0000-0000-0000000000d1', 'new', '27100000-0000-0000-0000-0000000000a5') $$,
  '42501', null, 'AC-LA-005 a light account cannot create a task');
select lives_ok($$ insert into incident_reports (incident_date, type, severity) values (current_date, 'Hazard', 'Low') $$,
  'AC-LA-005 a light account reports an issue');
select throws_ok($$ insert into incident_reports (incident_date, type, severity, reported_by)
  values (current_date, 'Hazard', 'Low', '27100000-0000-0000-0000-0000000000a7') $$, '42501', null,
  'AC-LA-005 a light account cannot report an issue in another person''s name');
select throws_ok($$ delete from work_orders where id = '27100000-0000-0000-0000-000000000401' $$, '42501', null,
  'AC-LA-005 a light account''s delete of a work order is refused');
reset role;
select is((select count(*)::int from work_orders where id = '27100000-0000-0000-0000-000000000401'), 1,
  'AC-LA-005 a light account cannot delete a work order');
set local role authenticated;

-- AC-LA-006 my_home: own items only, no money key
select is((select jsonb_array_length(public.my_home()->'tasks')), 1, 'AC-LA-006 my_home lists the one own task');
select is((select jsonb_array_length(public.my_home()->'work_orders')), 1, 'AC-LA-006 my_home lists the one rostered work order');
select ok(public.my_home()::text !~* '(price|budget|order_value|contract_value|rate|cost)', 'AC-LA-006 my_home carries no price, budget or value');

-- AC-LA-013 definer RPCs refuse a light account (guard from 1209)
select throws_ilike($$ select * from public.list_account_reconciliation() $$, 'LIGHT_ACCOUNT%', 'AC-LA-013 list_account_reconciliation refuses a light account');
select throws_ilike($$ select * from public.org_usage_summary() $$, 'LIGHT_ACCOUNT%', 'AC-LA-013 org_usage_summary refuses a light account');
select throws_ilike($$ select * from public.org_agent_run_stats() $$, 'LIGHT_ACCOUNT%', 'AC-LA-013 org_agent_run_stats refuses a light account');
select throws_ilike($$ select public.org_credit_balance('27100000-0000-0000-0000-00000000000a') $$, 'LIGHT_ACCOUNT%', 'AC-LA-013 org_credit_balance refuses a light account');
select throws_ilike($$ select * from public.get_budget_archive_targets('27100000-0000-0000-0000-0000000000d1') $$, 'LIGHT_ACCOUNT%', 'AC-LA-013 get_budget_archive_targets refuses a light account');
select throws_ilike($$ select public.preview_task_reminders(array['27100000-0000-0000-0000-000000000a01']::uuid[]) $$, 'LIGHT_ACCOUNT%', 'AC-LA-013 preview_task_reminders refuses a light account');

-- AC-LA-013 a Foreman still ticks their crew (existing attendance path, not guarded)
select lives_ok($$ select public.attendance_record('27100000-0000-0000-0000-000000000401', current_date - 1, 'roster_tick',
  '[{"worker_id":"27100000-0000-0000-0000-000000000f01","status":"present","hours":8}]'::jsonb) $$,
  'AC-LA-013 a Foreman ticks the crew they lead through attendance_record');

-- AC-LA-013 every data-returning definer function carries the guard; the shell and attendance path do not.
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname = any(array['accept_connect_proposals', 'accept_equipment_asset_matches', 'account_send_groups', 'apply_native_receipt', 'attach_erp_journal_lines', 'capture_subcontract_vendor_invoice', 'capture_vendor_invoice', 'connect_proposal_counts', 'correct_vendor_withholding_slip', 'cost_attribution_org_actuals', 'cost_attribution_project_actuals', 'dsr_report_hours', 'dsr_report_revenue', 'dsr_validation_queue', 'end_contract_rate_line', 'end_cost_attribution_rule', 'end_equipment_costing', 'equipment_charge_org_actuals', 'equipment_charge_project_actuals', 'equipment_charge_project_actuals_between', 'equipment_metrics', 'equipment_rental_check', 'get_bill_match', 'get_budget_archive_targets', 'get_process_gates', 'get_procurement_gates', 'get_project_consumption', 'get_project_vat_editability', 'get_projects_money_collection', 'get_reorder_suggestions', 'get_stock_below_reorder', 'get_stock_document_costs', 'get_stock_erp_value', 'get_stock_ledger', 'get_stock_on_hand', 'get_work_order_stock_balance', 'imprest_float_choices', 'journal_ledger_setup', 'list_account_reconciliation', 'list_equipment_allocations', 'list_equipment_costing', 'list_equipment_downtime_flags', 'list_equipment_proofs', 'list_equipment_usage_totals', 'list_journals', 'list_tm_claim_source_details', 'list_tm_claims', 'list_unlinkable_connect_matches', 'mark_erp_purchase_documents', 'mrq_plan_for', 'mrq_waiting_for_me', 'odoo_project_ledger', 'opening_balance_report', 'org_agent_run_stats', 'org_credit_balance', 'org_usage_summary', 'preview_cost_attribution', 'preview_equipment_costing', 'preview_task_reminders', 'preview_tm_claim', 'procurement_ledger_held', 'procurement_ledger_held_many', 'procurement_payment_within_ceiling', 'project_erp_journal_lines', 'purchase_capture_assignment_report', 'purchase_capture_feed_health', 'purchase_capture_ledger_page', 'purchase_capture_source_page', 'rate_catalogue_upsert_item', 'search_connect_staged', 'switch_odoo_ledger_basis', 'undo_captured_purchase', 'undo_imported_purchase', 'work_order_cost_amounts', 'work_order_issue_eligibility', 'work_order_validated_revenue', 'approved_timesheet_for_push']) and p.prosrc not like '%assert_not_light%'),
  0, 'AC-LA-013 every listed definer function body contains assert_not_light');
select is((select count(distinct p.proname)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname = any(array['accept_connect_proposals', 'accept_equipment_asset_matches', 'account_send_groups', 'apply_native_receipt', 'attach_erp_journal_lines', 'capture_subcontract_vendor_invoice', 'capture_vendor_invoice', 'connect_proposal_counts', 'correct_vendor_withholding_slip', 'cost_attribution_org_actuals', 'cost_attribution_project_actuals', 'dsr_report_hours', 'dsr_report_revenue', 'dsr_validation_queue', 'end_contract_rate_line', 'end_cost_attribution_rule', 'end_equipment_costing', 'equipment_charge_org_actuals', 'equipment_charge_project_actuals', 'equipment_charge_project_actuals_between', 'equipment_metrics', 'equipment_rental_check', 'get_bill_match', 'get_budget_archive_targets', 'get_process_gates', 'get_procurement_gates', 'get_project_consumption', 'get_project_vat_editability', 'get_projects_money_collection', 'get_reorder_suggestions', 'get_stock_below_reorder', 'get_stock_document_costs', 'get_stock_erp_value', 'get_stock_ledger', 'get_stock_on_hand', 'get_work_order_stock_balance', 'imprest_float_choices', 'journal_ledger_setup', 'list_account_reconciliation', 'list_equipment_allocations', 'list_equipment_costing', 'list_equipment_downtime_flags', 'list_equipment_proofs', 'list_equipment_usage_totals', 'list_journals', 'list_tm_claim_source_details', 'list_tm_claims', 'list_unlinkable_connect_matches', 'mark_erp_purchase_documents', 'mrq_plan_for', 'mrq_waiting_for_me', 'odoo_project_ledger', 'opening_balance_report', 'org_agent_run_stats', 'org_credit_balance', 'org_usage_summary', 'preview_cost_attribution', 'preview_equipment_costing', 'preview_task_reminders', 'preview_tm_claim', 'procurement_ledger_held', 'procurement_ledger_held_many', 'procurement_payment_within_ceiling', 'project_erp_journal_lines', 'purchase_capture_assignment_report', 'purchase_capture_feed_health', 'purchase_capture_ledger_page', 'purchase_capture_source_page', 'rate_catalogue_upsert_item', 'search_connect_staged', 'switch_odoo_ledger_basis', 'undo_captured_purchase', 'undo_imported_purchase', 'work_order_cost_amounts', 'work_order_issue_eligibility', 'work_order_validated_revenue', 'approved_timesheet_for_push'])), 77,
  'AC-LA-013 every listed function exists');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('attendance_record', 'attendance_generate_timesheet', 'my_home', 'auth_role', 'actor_authorization_state')
            and p.prosrc like '%assert_not_light%'),
  0, 'AC-LA-013 the shell, home and attendance functions are not guarded');

-- AC-LA-003 the Field user
select pg_temp.act_as('27100000-0000-0000-0000-0000000000a6');
select lives_ok($$ select public.attendance_record('27100000-0000-0000-0000-000000000401', current_date, 'phone_check_in',
  '[{"worker_id":"27100000-0000-0000-0000-000000000f01","status":"present","hours":8}]'::jsonb) $$,
  'AC-LA-013 a Field user clocks in through attendance_record');
select is((select array_agg(name) from tasks), array['LA task field'], 'AC-LA-003 field user reads only own tasks');
select is((select count(*)::int from crew_members), 1, 'AC-LA-003 field user reads only their own crew row');
select is((select array_agg(title) from work_orders), array['LA WO rostered'], 'AC-LA-003 field user reads only the rostered work order');
select is((select count(*)::int from projects), 0, 'AC-LA-003 field user reads no project');

-- AC-LA-007 seat report (counts only)
select pg_temp.act_as('27100000-0000-0000-0000-0000000000a1');
select is(public.org_seat_report(), '{"full": 4, "light": 2, "total": 6}'::jsonb, 'AC-LA-007 an Admin sees seats split full and light');
select pg_temp.act_as('27100000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.org_seat_report() $$, '42501', null, 'AC-LA-007 a light account cannot read the seat report');
select pg_temp.act_as('27100000-0000-0000-0000-0000000000b1');
select is(public.org_seat_report(), '{"full": 1, "light": 0, "total": 1}'::jsonb, 'AC-LA-007 another organization''s Admin sees only its own seats');

-- every table 1206 covers: restrictive per-command light_account_deny_* policies (select/insert/update; delete only where granted; select only on six tables whose write policies other guards pin), no `for all`
select is((select count(*)::int from unnest(array[
    'projects','project_milestones','project_documents','project_stage_entries','project_progress_entries','project_shared_cost_splits',
    'boq_items','boq_material_allowances','budget_versions','budget_line_items','budget_projections','budget_year_distributions',
    'budget_distribution_plans','companies','contacts','crm_activities','procurements','procurement_items','procurement_quotations',
    'procurement_invoices','procurement_invoice_lines','procurement_receipts','procurement_receipt_lines','purchase_orders',
    'purchase_order_lines','purchase_requests','rfqs','payments','incoming_payments','sales_invoices','expense_claims',
    'expense_claim_lines','imprest_floats','journal_entries','journal_entry_lines','stock_items','stock_balances','stock_ledger',
    'stock_documents','stock_document_lines','stock_warehouses','work_order_lines','work_order_acceptances','work_order_plan_lines',
    'daily_site_reports','equipment_assets','tm_claims','progress_claims','subcontract_acceptances','contract_rate_lines',
    'rate_catalogue_items','rate_catalogue_rates','erp_actuals_snapshot','erp_gl_entry_mirror','erp_ap_aging_snapshot',
    'erp_ar_aging_snapshot','meetings','comments']) as x(t)
  where (select string_agg(cmd || ':' || permissive, ',' order by cmd) from pg_policies
          where schemaname = 'public' and tablename = x.t and policyname ~ '^light_account_deny(_|$)')
    is distinct from
    case when x.t = any(array['sales_invoices','incoming_payments','payments','procurement_invoices','procurement_receipts','purchase_orders']) then 'SELECT:RESTRICTIVE'
         else case when has_table_privilege('authenticated', 'public.' || x.t, 'DELETE') then 'DELETE:RESTRICTIVE,' else '' end
              || 'INSERT:RESTRICTIVE,SELECT:RESTRICTIVE,UPDATE:RESTRICTIVE' end), 0,
  'AC-LA-005 every covered table has the restrictive light_account_deny_* per-command policies');

select * from finish();
rollback;
