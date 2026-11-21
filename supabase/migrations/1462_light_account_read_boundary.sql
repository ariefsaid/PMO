-- 1462 (#2711): the remaining org-scoped tables a field account must not read, and the project-documents bucket.
-- Rollback: supabase/migrations/rollback/1462_light_account_read_boundary_down.sql
-- Same RESTRICTIVE shape as 1206/1229: per command, the caller test is ONE `(select public.actor_is_light())`, so it is
-- inert for every other account (`is not true` is true for them) and the 0646 initplan rule still holds. These are the
-- tables a member of the organisation could read with a flat org-member SELECT policy, and a field account has no screen
-- for: claim and retention money, customer payment allocations, billing templates and their documents, budget/ERP mirrors,
-- approval configuration, procurement documents and status, material and client requests, equipment usage, stock cost and
-- reorder configuration, vendor evidence and spend approvers, the accounting map, the external-integration tables and the
-- saved-view list. `crew_loans` and `task_dependencies` join them: both are per-person project data the home screen does
-- not show.
-- Reads stay unchanged for every full account: only `actor_is_light()` rows are removed.
-- incident_files keeps its own rows: a field account attaches and reads the photos it uploaded, nothing else.
-- storage: a restrictive read policy for the project-documents bucket only, so attendance, expense and issue photos are
-- unaffected.
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
  t text;
begin
  foreach t in array v_tables loop
    execute format('create policy light_account_deny_select on public.%I as restrictive for select to authenticated using ((select public.actor_is_light()) is not true)', t);
    execute format('create policy light_account_deny_insert on public.%I as restrictive for insert to authenticated with check ((select public.actor_is_light()) is not true)', t);
    execute format('create policy light_account_deny_update on public.%I as restrictive for update to authenticated using ((select public.actor_is_light()) is not true) with check ((select public.actor_is_light()) is not true)', t);
    if has_table_privilege('authenticated', format('public.%I', t), 'DELETE') then
      execute format('create policy light_account_deny_delete on public.%I as restrictive for delete to authenticated using ((select public.actor_is_light()) is not true)', t);
    end if;
  end loop;
end $$;

-- issue photos: a field account sees only the files it uploaded (its own report's evidence); everyone else unchanged
create policy light_account_scope_select on public.incident_files as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true or uploaded_by_id = (select auth.uid()));

-- project-documents: no field-account read of the bucket, so a document cannot be listed or downloaded by URL.
-- Bucket-scoped: the attendance, expense and issue photo buckets keep their own policies.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'storage_objects_project_doc_light') then
    execute $p$
      create policy storage_objects_project_doc_light on storage.objects as restrictive for select to authenticated
        using ((select public.actor_is_light()) is not true or bucket_id is distinct from 'project-documents')
    $p$;
  end if;
end $$;
