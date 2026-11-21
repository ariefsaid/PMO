-- Rollback of 1480: removes the light-account guard line it put at the top of each function's outer block, leaving the
-- rest of the body as shipped (CREATE OR REPLACE keeps signature, language, volatility, search_path and grants), and
-- drops the restrictive policies it added. No column, grant or row is touched; the permissive policies were never
-- changed. A listed function that no longer carries the guard, is not plpgsql or cannot be rewritten RAISES: the
-- rollback fails, never skips.
do $$
declare
  v_names text[] := array[
      'add_claim_billing_step', 'add_task_to_incident', 'approve_equipment_plan', 'archive_billing_step_template',
      'archive_labour_cost_rate', 'archive_payment_channel', 'archive_purchase_line_category', 'attach_closeout_item_document',
      'attendance_rate_by_crew', 'clear_equipment_vendor_response', 'complete_closeout_item', 'correct_safety_day',
      'create_work_order_candidate', 'decide_work_order_candidate', 'end_labour_cost_rate', 'extend_rental_procurement',
      'get_equipment_targets', 'get_issue_closing_time_report', 'get_purchase_line_planning', 'get_safety_summary',
      'get_safety_summary_detail', 'get_stock_at_risk', 'get_work_order_performance', 'list_equipment_breakdowns',
      'load_billing_step_template_onto_claim', 'load_billing_step_template_onto_project', 'management_pack_earned', 'move_claim_billing_step',
      'mrq_set_approver_inbox', 'mrq_set_delivery_note_settings', 'mrq_set_usage_thresholds', 'my_waiting_billing_steps',
      'non_working_date_add', 'non_working_date_remove', 'overdue_billing_steps_by_claim', 'po_set_print_settings',
      'post_stock_wo_transfer', 'project_daily_target_vs_actual', 'project_discipline_revenue', 'project_revenue_plan_vs_actual',
      'project_work_order_earned_billed', 'recall_stock_transfer', 'record_equipment_vendor_response', 'record_site_checkpoint',
      'reject_equipment_plan', 'release_reservation', 'release_stale_reservations', 'remove_claim_billing_step',
      'reopen_equipment_plan', 'reserve_stock', 'resolve_stock_transfer_shortfall', 'safety_save_talk',
      'safety_work_order_days', 'save_billing_step_template', 'save_equipment_plan', 'save_idle_cost_setting',
      'save_labour_cost_rate', 'save_labour_cost_settings', 'save_payment_channel', 'send_stock_transfer',
      'set_billing_plan_month_target', 'set_billing_plan_reminder', 'set_billing_plan_settings', 'set_boq_item_discipline',
      'set_closeout_checklist', 'set_dsr_stock_issue', 'set_equipment_plan_category_active', 'set_equipment_plan_settings',
      'set_equipment_targets', 'set_org_discipline_profit_enabled', 'set_payment_channel_settings', 'set_procurement_line_planning',
      'set_procurement_payment_channel', 'set_purchase_line_category', 'set_purchase_line_planning', 'set_purchase_type_active',
      'set_purchase_types_enabled', 'set_revenue_plan_settings', 'set_safety_records_enabled', 'set_site_checkpoint_list',
      'set_stock_proof_timing', 'set_stock_reservations', 'set_stock_transfer_mode', 'set_stock_wo_transfers',
      'set_work_order_area_group', 'set_work_order_candidate_template', 'set_work_order_issue_threshold', 'set_work_order_site_location',
      'site_lost_time_by_cause', 'skip_billing_stage', 'submit_equipment_plan', 'submit_safety_day',
      'update_claim_billing_step', 'upsert_equipment_plan_category', 'upsert_purchase_type', 'wo_daily_target_vs_actual',
      'wo_revenue_plan_clear', 'wo_revenue_plan_set_day', 'wo_revenue_plan_set_month', 'wo_revenue_plan_vs_actual',
      'work_order_idle_cost'];
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
      if r.prosrc not like '%assert_not_light%' then
        raise exception '2711 rollback: % carries no guard, nothing to undo', r.proname;
      end if;
      if r.lanname <> 'plpgsql' and r.lanname <> 'sql' then
        raise exception '2711 rollback: % is language %, cannot rewrite', r.proname, r.lanname;
      end if;
      v_def := pg_get_functiondef(r.oid);
      if r.lanname = 'plpgsql' then
        v_body := regexp_replace(r.prosrc, E'\n[ \t]*perform public[.]assert_not_light[(][)];\n', E'\n', 'g');
      else
        -- the 1461/1480 rewrite for a sql function: the original body, once more unwrapped
        v_body := regexp_replace(r.prosrc,
          '^\n  select q[.]\* from \((.*)\n\) q where public[.]assert_not_light[(][)]\n$', '\1', 's');
      end if;
      if v_body = r.prosrc or position(r.prosrc in v_def) = 0 then
        raise exception '2711 rollback: % could not be rewritten', r.proname;
      end if;
      v_new := overlay(v_def placing v_body from position(r.prosrc in v_def) for length(r.prosrc));
      begin
        execute v_new;
      exception when others then
        raise exception '2711 rollback: rewriting % failed: %', r.proname, sqlerrm;
      end;
    end loop;
    if v_found = 0 then
      raise exception '2711 rollback: function % not found in public', v_n;
    end if;
  end loop;
end $$;

do $$
declare
  v_tables text[] := array[
      'billing_plan_month_targets', 'billing_step_template_documents', 'billing_step_template_steps', 'billing_step_templates',
      'closeout_checklist_templates', 'done_not_claimed_notices', 'dsr_stock_posting_lines', 'dsr_stock_postings',
      'equipment_plan_categories', 'equipment_plan_lines', 'equipment_plans', 'equipment_vendor_responses',
      'idle_cost_settings', 'incident_tasks', 'issue_closing_report_settings', 'issue_department_groups',
      'labour_cost_classes', 'labour_cost_rates', 'labour_cost_settings', 'material_request_usage_alerts',
      'org_billing_plan_settings', 'org_equipment_plan_settings', 'org_non_working_dates', 'org_payment_channel_settings',
      'org_payment_channels', 'org_purchase_type_settings', 'org_revenue_plan_settings', 'purchase_line_categories',
      'purchase_order_settings', 'purchase_types', 'safety_checklist_answers', 'safety_days',
      'safety_fitness_checks', 'safety_list_items', 'safety_officer_entries', 'safety_permits',
      'safety_toolbox_attendees', 'safety_toolbox_photos', 'safety_toolbox_talks', 'site_checkpoint_templates',
      'site_checkpoints', 'spend_approval_settings', 'stock_reservation_events', 'stock_reservations',
      'stock_wo_transfers', 'task_groups', 'work_order_areas', 'work_order_candidate_items',
      'work_order_candidate_proofs', 'work_order_candidates', 'work_order_checklist_items', 'work_order_closeout_items',
      'work_order_groups', 'work_order_revenue_plan', 'work_order_stock_settings'];
  t text; c text;
begin
  foreach t in array v_tables loop
    foreach c in array array['select', 'insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', 'light_account_deny_' || c, t);
    end loop;
  end loop;
end $$;

drop policy if exists light_account_scope_select on public.stock_transfers;
drop policy if exists light_account_scope_select on public.stock_transfer_lines;
drop policy if exists light_account_scope_select on public.stock_handover_confirmations;
