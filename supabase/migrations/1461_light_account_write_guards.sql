-- 1461 (#2711): the light-account refusal at the top of the write-side definers a field account has no screen for.
-- Rollback: supabase/migrations/rollback/1461_light_account_write_guards_down.sql
-- 1209/1219 guarded the data-returning read RPCs. A security-definer function does not go through the restrictive policies, so every
-- write-side definer granted to `authenticated` refuses a light account itself. These are the procurement, stock, timesheet,
-- daily-report, equipment, imprest, billing and retention writes, the leave decision, third-party inspections, client
-- requisitions and the assistant credit bookkeeping. The field paths a light account does use (my_home, attendance_record,
-- phone_check_in, own leave submit/cancel, set_my_email_opt_out and the shell helpers) are not in this list; the standing
-- sweep (2711) records each of them as an allowlisted entry with its reason.
-- Body rewrite is the same mechanical one as 1209, so each body is restated from its LATEST definition in the database and
-- only the guard line is added: signature, language, volatility, search_path and grants are kept by CREATE OR REPLACE.
--   plpgsql -> `perform public.assert_not_light();` as the first statement of the outer block;
--   sql     -> `select q.* from (<body>) q where public.assert_not_light()`.
-- A name that is missing, has no body, is in an unsupported language or cannot be rewritten RAISES: the migration fails,
-- never skips. For anyone who is not a light account assert_not_light() returns true: behaviour is unchanged.
do $$
declare
  v_names text[] := array[
      'add_equipment_downtime_proof', 'archive_equipment_usage', 'audit_agent_denial', 'cancel_native_receipt',
      'cancel_retention_release', 'cancel_stock_document', 'close_crew_tool_report', 'complete_billing_stage',
      'create_procurement_receipt', 'create_procurement_with_items', 'create_stock_document', 'csr_cancel',
      'csr_create', 'csr_record_pickup', 'csr_send', 'csr_update_draft', 'decide_imprest_float_change',
      'dsr_save_draft', 'dsr_submit', 'leave_request_decide', 'mrq_cancel', 'mrq_decide_step', 'mrq_retry_transfer',
      'mrq_revoke_stand_in', 'mrq_save_draft', 'mrq_set_stand_in', 'mrq_submit', 'note_billing_stage',
      'post_stock_document', 'pre_cutover_procurement', 'procurement_amount_eligibility', 'procurement_gate',
      'procurement_gate_violation', 'procurement_item_values_editable', 'record_expense_advance_return',
      'record_imprest_count', 'release_credits', 'release_retention', 'report_crew_tool',
      'request_imprest_replenishment', 'request_po_variation', 'reserve_credits', 'save_equipment_usage',
      'save_stock_draft', 'save_timesheet_week', 'schedule_retention_release', 'send_task_reminders',
      'set_cost_attribution', 'set_equipment_status', 'set_equipment_status_bulk', 'start_procurement_import_run',
      'tpi_cancel', 'tpi_create', 'tpi_record_execution', 'tpi_record_invitation', 'tpi_record_report',
      'transition_document_status', 'transition_equipment_usage', 'transition_expense_claim',
      'transition_imprest_plan', 'transition_imprest_replenishment', 'transition_procurement',
      'transition_timesheet', 'update_procurement_header'];
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
      if r.prosrc like '%assert_not_light%' then
        continue;
      end if;
      if coalesce(btrim(r.prosrc), '') = '' then
        raise exception '2711: % has no source body, cannot guard', r.proname;
      end if;
      v_def := pg_get_functiondef(r.oid);
      if r.lanname = 'plpgsql' then
        v_body := regexp_replace(r.prosrc, '(^|\n)(\s*begin\s*)(\n|$)', E'\\1\\2\\3  perform public.assert_not_light();\n', 'i');
      elsif r.lanname = 'sql' then
        v_body := E'\n  select q.* from (' || regexp_replace(btrim(r.prosrc, E' \n\t\r;'), ';\s*$', '') ||
                  E'\n) q where public.assert_not_light()\n';
      else
        raise exception '2711: % is language %, cannot guard', r.proname, r.lanname;
      end if;
      if v_body = r.prosrc or position(r.prosrc in v_def) = 0 then
        raise exception '2711: % could not be rewritten', r.proname;
      end if;
      v_new := overlay(v_def placing v_body from position(r.prosrc in v_def) for length(r.prosrc));
      begin
        execute v_new;
      exception when others then
        raise exception '2711: rewriting % failed: %', r.proname, sqlerrm;
      end;
    end loop;
    if v_found = 0 then
      raise exception '2711: function % not found in public', v_n;
    end if;
  end loop;
end $$;
