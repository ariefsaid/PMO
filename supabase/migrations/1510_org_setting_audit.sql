-- 1510_org_setting_audit.sql — #2746 / ADR-0121: one org.setting.change audit event for every organisation setting change, whichever
-- path wrote it (a setter RPC, a column-grant update, a settings-table write). Setters that already write their own domain event keep
-- it; no function body is restated. The setting columns are the trigger arguments: a new setting adds its column name here.
-- Rollback: supabase/migrations/rollback/1510_org_setting_audit_down.sql

create function public.audit_org_setting_change() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  c text;
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  n jsonb := to_jsonb(new);
  v_org uuid := coalesce((n ->> 'org_id')::uuid, (n ->> 'id')::uuid);
begin
  foreach c in array tg_argv loop
    if (o -> c) is distinct from (n -> c) then
      perform public.log_audit('org.setting.change', v_org, auth.uid(), v_org,
        jsonb_build_object('setting', tg_table_name || '.' || c, 'from', o -> c, 'to', n -> c)
          || case when n ? 'event_key' then jsonb_build_object('event_key', n -> 'event_key') else '{}'::jsonb end);
    end if;
  end loop;
  return new;
end; $$;
revoke all on function public.audit_org_setting_change() from public, anon, authenticated;

create trigger zz_audit_org_setting_change after update on public.organizations for each row
  execute function public.audit_org_setting_change(
    'quantity_change_limit', 'built_in_roles_enabled', 'phone_check_in_supervisor_role', 'hide_prices_from_requesters',
    'clearance_checklist_enabled', 'leave_requests_enabled', 'leave_approver_role',
    'discipline_profit_enabled', 'performance_indices_enabled', 'performance_band_low', 'performance_band_high',
    'stock_transfer_mode', 'stock_proof_timing', 'stock_wo_transfers', 'stock_reservations', 'reservation_borrow_mode',
    'reservation_borrow_role', 'reservation_borrow_label', 'dsr_stock_issue', 'dsr_stock_issue_items',
    'purchase_line_planning', 'safety_records_enabled', 'equipment_availability_target_pct',
    'equipment_utilisation_target_pct', 'equipment_escalation_down_days', 'attendance_target_rate');

create trigger zz_audit_org_setting_change after insert or update on public.org_crew_tool_settings for each row
  execute function public.audit_org_setting_change('coordinator_id', 'task_due_days');
create trigger zz_audit_org_setting_change after insert or update on public.org_revenue_plan_settings for each row
  execute function public.audit_org_setting_change('enabled', 'working_weekdays');
create trigger zz_audit_org_setting_change after insert or update on public.work_order_stock_settings for each row
  execute function public.audit_org_setting_change('issue_progress_threshold_pct');
create trigger zz_audit_org_setting_change after insert or update on public.org_purchase_type_settings for each row
  execute function public.audit_org_setting_change('enabled');
create trigger zz_audit_org_setting_change after insert or update on public.issue_closing_report_settings for each row
  execute function public.audit_org_setting_change('enabled', 'grouping_mode');
create trigger zz_audit_org_setting_change after insert or update on public.purchase_order_settings for each row
  execute function public.audit_org_setting_change('print_enabled', 'signature_blocks', 'authorised_collectors');
create trigger zz_audit_org_setting_change after insert or update on public.email_org_settings for each row
  execute function public.audit_org_setting_change('locale');
create trigger zz_audit_org_setting_change after insert or update on public.email_event_settings for each row
  execute function public.audit_org_setting_change('enabled', 'extra_roles');
