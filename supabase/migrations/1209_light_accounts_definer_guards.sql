-- 1209 (#2710): explicit light-account refusal at the top of every data-returning security-definer RPC.
-- Rollback: supabase/migrations/rollback/1209_light_accounts_definer_guards_down.sql
-- Restrictive policies (1206) bind security-INVOKER reads, which return zero rows to a light account. A security-DEFINER function
-- bypasses RLS, so each one that returns data to `authenticated` refuses a light account itself.
-- NOT guarded on purpose: auth_role and actor_authorization_state (the shell), attendance_record and attendance_generate_timesheet
-- (the Foreman's crew tick and clock-in), my_home, and the operator_* functions (their own gate). Nothing in this list is called by
-- my_home or attendance_record.
-- Body rewrite is mechanical and keeps signature, language, volatility, search_path and grants (CREATE OR REPLACE):
--   plpgsql -> `perform public.assert_not_light();` as the first statement of the outer block;
--   sql     -> `select q.* from (<body>) q where public.assert_not_light()`; the subquery returns the body's own columns, so a
--              scalar json or jsonb function still returns one value of its declared type, a set-returning one its rows.
-- Any name that is missing, in another language, has no body or cannot be rewritten RAISES: the migration fails, never skips.
-- For anyone who is not a light account assert_not_light() returns true: behaviour is unchanged.
do $$
declare
  v_names text[] := array[
      'accept_connect_proposals', 'accept_equipment_asset_matches', 'account_send_groups', 'apply_native_receipt',
      'attach_erp_journal_lines', 'capture_subcontract_vendor_invoice', 'capture_vendor_invoice',
      'connect_proposal_counts', 'correct_vendor_withholding_slip', 'cost_attribution_org_actuals',
      'cost_attribution_project_actuals', 'dsr_report_hours', 'dsr_report_revenue', 'dsr_validation_queue',
      'end_contract_rate_line', 'end_cost_attribution_rule', 'end_equipment_costing', 'equipment_charge_org_actuals',
      'equipment_charge_project_actuals', 'equipment_charge_project_actuals_between', 'equipment_metrics',
      'equipment_rental_check', 'get_bill_match', 'get_budget_archive_targets', 'get_process_gates',
      'get_procurement_gates', 'get_project_consumption', 'get_project_vat_editability',
      'get_projects_money_collection', 'get_reorder_suggestions', 'get_stock_below_reorder',
      'get_stock_document_costs', 'get_stock_erp_value', 'get_stock_ledger', 'get_stock_on_hand',
      'get_work_order_stock_balance', 'imprest_float_choices', 'journal_ledger_setup', 'list_account_reconciliation',
      'list_equipment_allocations', 'list_equipment_costing', 'list_equipment_downtime_flags',
      'list_equipment_proofs', 'list_equipment_usage_totals', 'list_journals', 'list_tm_claim_source_details',
      'list_tm_claims', 'list_unlinkable_connect_matches', 'mark_erp_purchase_documents', 'mrq_plan_for',
      'mrq_waiting_for_me', 'odoo_project_ledger', 'opening_balance_report', 'org_agent_run_stats',
      'org_credit_balance', 'org_usage_summary', 'preview_cost_attribution', 'preview_equipment_costing',
      'preview_task_reminders', 'preview_tm_claim', 'procurement_ledger_held', 'procurement_ledger_held_many',
      'procurement_payment_within_ceiling', 'project_erp_journal_lines', 'purchase_capture_assignment_report',
      'purchase_capture_feed_health', 'purchase_capture_ledger_page', 'purchase_capture_source_page',
      'rate_catalogue_upsert_item', 'search_connect_staged', 'switch_odoo_ledger_basis', 'undo_captured_purchase',
      'undo_imported_purchase', 'work_order_cost_amounts', 'work_order_issue_eligibility',
      'work_order_validated_revenue', 'approved_timesheet_for_push'];
  v_n text; v_found int;
  r record; v_def text; v_new text; v_body text;
begin
  foreach v_n in array v_names loop
    v_found := 0;
    for r in
      select p.oid, p.proname, l.lanname, p.prosrc
        from pg_proc p join pg_language l on l.oid = p.prolang
       where p.pronamespace = 'public'::regnamespace and p.proname = v_n
    loop
      v_found := v_found + 1;
      if coalesce(btrim(r.prosrc), '') = '' then
        raise exception '2710: % has no source body, cannot guard', r.proname;
      end if;
      v_def := pg_get_functiondef(r.oid);
      if r.lanname = 'plpgsql' then
        v_body := regexp_replace(r.prosrc, '(^|\n)(\s*begin\s*)(\n|$)', E'\\1\\2\\3  perform public.assert_not_light();\n', 'i');
      elsif r.lanname = 'sql' then
        v_body := E'\n  select q.* from (' || regexp_replace(btrim(r.prosrc, E' \n\t\r;'), ';\s*$', '') ||
                  E') q where public.assert_not_light()\n';
      else
        raise exception '2710: % is language %, cannot guard', r.proname, r.lanname;
      end if;
      if v_body = r.prosrc or position(r.prosrc in v_def) = 0 then
        raise exception '2710: % could not be rewritten', r.proname;
      end if;
      v_new := overlay(v_def placing v_body from position(r.prosrc in v_def) for length(r.prosrc));
      execute v_new;
    end loop;
    if v_found = 0 then
      raise exception '2710: function % not found in public', v_n;
    end if;
  end loop;
end $$;

create index if not exists tasks_assignee_idx on public.tasks (assignee_id) where assignee_id is not null;
create index if not exists incident_reports_reported_by_idx on public.incident_reports (reported_by) where reported_by is not null;
