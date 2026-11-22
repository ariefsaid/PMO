-- 1530_light_guard_declared_per_function.sql -- the field-account guard is declared per function and checked by the catalogue (#2711).
-- Rollback: supabase/migrations/rollback/1530_light_guard_declared_per_function_down.sql
-- Every public security-definer function a signed-in account can execute either refuses a field account in its body
-- or is on the sweep's allowlist under a kind the sweep verifies (field path, scalar helper, trigger function). This
-- migration puts the same body guard 1461/1480 use on the functions that were exempted by a stated reason alone; for
-- anyone who is not a field account assert_not_light() returns true, so nothing changes for them.
-- The block first checks, and raises if it fails, that none of the functions is named by a field-account path body or
-- by an RLS policy expression (a guarded function called from a policy would refuse a field account on that table).
-- A name that is missing, has no body, is in an unsupported language or cannot be rewritten RAISES, never skips.
do $$
declare
  v_names text[] := array[
      'attendance_decide_week', 'approve_equipment_usage_week', 'approve_procurement_amount', 'accept_invoice_pairs',
      'activate_budget_version', 'add_skipped_stage_entry', 'admin_change_domain_ownership', 'admin_move_credit_allocation',
      'admin_set_feedback_surveys', 'admin_set_user_status', 'approve_bill_match_exception', 'approve_journal',
      'approve_subcontract_certificate', 'approved_journal_for_push', 'archive_budget_version_with_cancel_intent', 'archive_document_category',
      'archive_scheduled_report', 'archive_stock_document_file', 'archive_subcontract_backcharge', 'assemble_tm_claim',
      'assert_seat_available', 'assign_capture_invoices', 'assign_sales_invoice_project', 'attach_billing_stage_document',
      'attach_claim_evidence', 'attest_timesheet_no_erp_document', 'attribute_subcontract_bill_lines', 'cancel_subcontract_certificate',
      'change_equipment_rental_rate', 'claim_sales_invoice_author', 'clear_shared_cost_split', 'clone_budget_version',
      'compare_and_unpair_invoice', 'confirm_erp_employee_link', 'confirm_subcontract_acceptance', 'confirm_tm_signoff',
      'confirm_work_order_acceptance', 'consent_budget_occupant_replace', 'correct_crew_tool_report', 'create_document_category',
      'create_native_progress_claim_invoice', 'create_native_sales_invoice', 'create_native_tm_invoice', 'create_payment',
      'create_procurement_invoice', 'create_procurement_quotation', 'create_progress_claim', 'create_purchase_order',
      'create_purchase_request', 'create_record_only_journal_purchase', 'create_rented_equipment_asset', 'create_rfq',
      'create_task_from_incident', 'csr_record_release', 'csr_record_reservation', 'cus_adjust_plan_line',
      'cus_generate_plan', 'decide_connect_review', 'decide_po_variation', 'deselect_tm_source',
      'detach_erp_journal_line', 'dispose_account_reconciliation', 'dsr_correct', 'dsr_return',
      'dsr_validate', 'end_contract_rate_assignee', 'establish_imprest_float', 'import_budget_line_v2',
      'import_project_stage_history', 'import_purchase_history', 'issue_po_revision', 'issue_subcontract_po_lines',
      'link_erp_purchase_documents', 'link_m365_documents_batch', 'link_po_variation', 'link_procurement_sharepoint_item',
      'load_stock_opening', 'load_work_order_opening', 'm365_disconnect_cascade', 'mrq_set_chain',
      'mrq_set_cutoff', 'mrq_set_step_pin', 'operator_agent_run_stats', 'operator_clear_feature_override',
      'operator_create_org', 'operator_grant_credits', 'operator_list_orgs', 'operator_org_exists',
      'operator_org_overrides', 'operator_org_plan', 'operator_plan_catalogue', 'operator_resolved_org_features',
      'operator_set_domain_ownership', 'operator_set_global_feature', 'operator_set_org_lifecycle_state', 'operator_set_org_plan',
      'operator_set_plan_feature', 'operator_set_plan_limits', 'operator_toggle_feature', 'operator_usage_summary',
      'prepare_certificate_acceptance', 'prepare_subcontract_acceptance', 'prepare_subcontract_certificate', 'prepare_tm_signoff',
      'prepare_work_order_acceptance', 'propose_imprest_float_amount', 'qcr_approve', 'qcr_raise',
      'qcr_record_decision', 'qcr_record_sent', 'qcr_return', 'qcr_submit',
      'qcr_update_draft', 'qcr_withdraw', 'rate_catalogue_add_variants', 'rate_catalogue_set_default_variant',
      'recategorise_budget_lines', 'record_bill_match_lines', 'record_native_on_account_receipt', 'record_native_receipt',
      'record_quantity_forecast', 'record_receipt_match_lines', 'record_subcontract_backcharge', 'record_vendor_withholding_slip',
      'redate_stage_entry', 'refile_document_lineage', 'release_outbox_hold', 'rename_document_category',
      'reorder_document_categories', 'request_account_send', 'request_company_defaults', 'request_financial_statement_refresh',
      'request_journal_reversal', 'resolve_held_outbox_command', 'restore_document_category', 'resubmit_budget_version',
      'retry_connect_send', 'return_budget_version', 'return_journal', 'return_subcontract_certificate',
      'reverse_opening_balance', 'save_budget_distribution', 'save_contract_rate_line', 'save_cost_attribution_rule',
      'save_equipment_costing', 'save_equipment_rental_term', 'save_journal_draft', 'save_scheduled_report',
      'select_procurement_quote', 'set_billing_stage_template', 'set_built_in_roles_enabled', 'set_certificate_backcharge',
      'set_certificate_deselection', 'set_contract_rate_assignee', 'set_crew_tool_settings', 'set_desk_journal',
      'set_document_category_roles', 'set_document_warning_days', 'set_email_event_setting', 'set_email_locale',
      'set_equipment_ownership', 'set_equipment_working_hours', 'set_hide_prices_enabled', 'set_imprest_procurement_limit',
      'set_leave_settings', 'set_org_crew_loans_enabled', 'set_org_fiscal_year_start_month', 'set_phone_check_in_supervisor_role',
      'set_procurement_gates', 'set_procurement_invoice_efaktur', 'set_project_billing_terms', 'set_project_contract_value',
      'set_project_invoice_deadline', 'set_project_retention', 'set_sales_invoice_billing_kind', 'set_sales_invoice_efaktur',
      'set_sales_invoice_received_date', 'set_scheduled_report_enabled', 'set_shared_cost_split', 'set_stock_reorder_level',
      'set_stock_warehouse_keeper', 'set_subcontract_po_lines', 'set_subcontractor_rate', 'set_three_way_match_settings',
      'set_vendor_supply_status', 'set_vendor_tax_defaults', 'set_work_order_value', 'submit_journal',
      'submit_sales_invoice', 'submit_subcontract_certificate', 'switch_budget_draft_mode', 'tpi_raise_purchase',
      'tpi_waive', 'transition_native_sales_invoice', 'transition_project', 'transition_work_order',
      'unapply_native_allocation', 'unlink_connect_match', 'unlink_erp_purchase_document', 'unpair_invoice',
      'void_subcontract_bill', 'void_vendor_withholding_slip', 'withdraw_progress_claim', 'withdraw_subcontract_acceptance',
      'withdraw_tm_signoff', 'withdraw_work_order_acceptance'];
  v_field text[] := array[
      'attendance_can_record', 'attendance_generate_timesheet', 'attendance_record', 'leave_enabled',
      'leave_on_date', 'leave_request_cancel', 'leave_request_submit', 'leave_requestable_people',
      'my_home', 'phone_check_in', 'set_my_email_opt_out', 'actor_authorization_state',
      'org_seat_report', 'resolved_org_features', 'resolved_org_plan', 'receive_stock_transfer',
      'record_stock_handover'];
  v_n text; v_found int; v_bad text;
  r record; v_def text; v_new text; v_body text;
begin
  select string_agg(distinct n, ', ') into v_bad
    from unnest(v_names) n
   where exists (select 1 from pg_proc p
                  where p.pronamespace = 'public'::regnamespace and p.proname = any (v_field)
                    and p.prosrc ~ ('\m' || n || '\M'))
      or exists (select 1 from pg_policies pol
                  where coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~ ('\m' || n || '\M'));
  if v_bad is not null then
    raise exception '2711 guard: named by a field path or a policy, not guarded here: %', v_bad;
  end if;
  foreach v_n in array v_names loop
    v_found := 0;
    for r in
      select p.oid, p.proname, l.lanname, p.prosrc
        from pg_proc p join pg_language l on l.oid = p.prolang
       where p.pronamespace = 'public'::regnamespace and p.proname = v_n
    loop
      v_found := v_found + 1;
      if r.prosrc ~* '(perform|where)\s+public\.assert_not_light\(\)' then
        continue;
      end if;
      if coalesce(btrim(r.prosrc), '') = '' then
        raise exception '2711 guard: % has no source body, cannot guard', r.proname;
      end if;
      v_def := pg_get_functiondef(r.oid);
      if r.lanname = 'plpgsql' then
        v_body := regexp_replace(r.prosrc, '(^|\n)(\s*begin\s*)(\n|$)', E'\\1\\2\\3  perform public.assert_not_light();\n', 'i');
      elsif r.lanname = 'sql' then
        v_body := E'\n  select q.* from (' || regexp_replace(btrim(r.prosrc, E' \n\t\r;'), ';\s*$', '') ||
                  E'\n) q where public.assert_not_light()\n';
      else
        raise exception '2711 guard: % is language %, cannot guard', r.proname, r.lanname;
      end if;
      if v_body = r.prosrc or position(r.prosrc in v_def) = 0 then
        raise exception '2711 guard: % could not be rewritten', r.proname;
      end if;
      v_new := overlay(v_def placing v_body from position(r.prosrc in v_def) for length(r.prosrc));
      begin
        execute v_new;
      exception when others then
        raise exception '2711 guard: rewriting % failed: %', r.proname, sqlerrm;
      end;
    end loop;
    if v_found = 0 then
      raise exception '2711 guard: function % not found in public', v_n;
    end if;
  end loop;
end $$;
