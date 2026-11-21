-- 2713_light_account_read_boundary.test.sql — #2711, AC-LA-003/AC-LA-014. A field account reads none of the office tables it has no screen for.
-- Migrations under test: 1462 (the deny set that completes 1206/1219, the incident-file own-row scope, the storage policy).
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   drop policy light_account_deny_select on approval_chain_steps .. 'AC-LA-003 no office table row reaches a field account'
--   drop policy light_account_scope_select on incident_files ..... 'AC-LA-003 issue files are own-row for a field account'
--   drop policy storage_objects_project_doc_light on storage.objects 'AC-LA-003 the project-documents bucket is closed'
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name, default_currency, built_in_roles_enabled)
  values ('27130000-0000-0000-0000-00000000000a', 'LA Reads', 'IDR', true);
insert into auth.users (id, email) values
  ('27130000-0000-0000-0000-0000000000a4', 'lar-eng@example.com'),
  ('27130000-0000-0000-0000-0000000000a6', 'lar-field@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27130000-0000-0000-0000-0000000000a4', '27130000-0000-0000-0000-00000000000a', 'LAR Eng', 'lar-eng@example.com', 'Engineer', 'active', null),
  ('27130000-0000-0000-0000-0000000000a6', '27130000-0000-0000-0000-00000000000a', 'LAR Field', 'lar-field@example.com', 'Engineer', 'active', 'field_user');
insert into approval_chain_steps (org_id, position, role, label, only_over_plan)
  values ('27130000-0000-0000-0000-00000000000a', 1, 'Admin', 'LA approval step', false);
insert into expense_account_map (org_id, account_key, erp_account)
  values ('27130000-0000-0000-0000-00000000000a', 'project_direct_cost', '6000');

-- every table in the deny set carries the restrictive select policy (per-command shape, one initplan call)
select is((select count(*)::int from unnest(array[
    'approval_chain_steps', 'approval_stand_ins', 'approval_step_pins', 'billing_stage_template_documents',
    'billing_stage_templates', 'budget_category_account_map', 'budget_version_account_erp_mirror',
    'budget_version_erp_mirror', 'claim_billing_stage_documents', 'claim_billing_stages', 'crew_loans',
    'equipment_downtime_proofs', 'equipment_status_days', 'equipment_status_history', 'equipment_usage_entries',
    'error_events', 'expense_account_map', 'external_domain_ownership', 'external_master_records',
    'external_project_bindings', 'external_ref_lineage', 'external_reference_items', 'external_refs',
    'external_sync_watermarks', 'incoming_payment_allocations', 'material_request_events', 'material_request_lines',
    'material_request_settings', 'material_request_steps', 'material_requests', 'odoo_stock_cost_lines',
    'org_imprest_settings', 'org_three_way_match_settings', 'payment_files', 'procurement_doc_counters',
    'procurement_documents', 'procurement_import_runs', 'procurement_invoice_files', 'procurement_quotation_files',
    'procurement_receipt_files', 'procurement_status_events', 'progress_assessment_quantities',
    'progress_claim_evidence', 'progress_claim_lines', 'purchase_order_files', 'purchase_request_files',
    'retention_releases', 'rfq_files', 'sales_invoice_authors', 'sales_invoice_submit_authorizations',
    'spend_approvers', 'stock_erp_mirror', 'stock_reorder_levels', 'task_dependencies']) as x(t)
  where not exists (select 1 from pg_policies p
                     where p.schemaname = 'public' and p.tablename = x.t
                       and p.policyname = 'light_account_deny_select'
                       and p.cmd = 'SELECT' and p.permissive = 'RESTRICTIVE'
                       and p.qual like '%actor_is_light%')), 0,
  'AC-LA-003 every office table without a field-account screen carries the restrictive select policy');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- a full Engineer is unchanged: the rows are there for the office
set local role authenticated;
select pg_temp.act_as('27130000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from approval_chain_steps), 1, 'AC-LA-003 a full Engineer reads the approval configuration');
select is((select count(*)::int from expense_account_map), 1, 'AC-LA-003 a full Engineer reads the accounting map');

-- a field account reads none of it
select pg_temp.act_as('27130000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from approval_chain_steps), 0, 'AC-LA-003 no approval configuration reaches a field account');
select is((select count(*)::int from expense_account_map), 0, 'AC-LA-003 no accounting map reaches a field account');
select is((select count(*)::int from retention_releases) + (select count(*)::int from progress_claim_lines)
          + (select count(*)::int from incoming_payment_allocations), 0,
  'AC-LA-003 no claim, retention or customer-payment amount reaches a field account');

-- the issue photos keep their own rows only
select ok(exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = 'incident_files'
                     and policyname = 'light_account_scope_select' and cmd = 'SELECT' and permissive = 'RESTRICTIVE'
                     and qual like '%actor_is_light%' and qual like '%uploaded_by_id%'),
  'AC-LA-003 issue files are own-row for a field account');

-- the project-documents bucket is closed by a restrictive read policy scoped to that bucket
select ok(exists (select 1 from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname = 'storage_objects_project_doc_light'
                     and cmd = 'SELECT' and permissive = 'RESTRICTIVE'
                     and qual like '%actor_is_light%' and qual like '%project-documents%' and qual like '%bucket_id%'),
  'AC-LA-003 the project-documents bucket is closed to a field account and other buckets are untouched');

select * from finish();
rollback;
