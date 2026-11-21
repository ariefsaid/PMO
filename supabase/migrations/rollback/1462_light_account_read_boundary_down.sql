-- Rollback of 1462: drops the restrictive policies it added (tables, incident_files, storage). No column, grant or row is
-- touched; the permissive policies were never changed.
do $$
declare
  v_tables text[] := array[
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
    'spend_approvers', 'stock_erp_mirror', 'stock_reorder_levels', 'task_dependencies'];
  t text; c text;
begin
  foreach t in array v_tables loop
    foreach c in array array['select', 'insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', 'light_account_deny_' || c, t);
    end loop;
  end loop;
end $$;

drop policy if exists light_account_scope_select on public.incident_files;
drop policy if exists storage_objects_project_doc_light on storage.objects;
