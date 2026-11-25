-- Rollback of 2181: the switch and its setter, the server-side copy, and the 2180 bodies (add_work_order_step without the switch, a null
-- place refused; the organisation audit trigger without the new column). Checklists already written stay (they are the work orders' own data).
drop function if exists public.save_work_order_steps_as_template(uuid, text);
drop function if exists public.set_org_work_order_checklist_edit(boolean);

-- add_work_order_step as 2180 defined it (its grants are unchanged).
create or replace function public.add_work_order_step(p_work_order uuid, p_after_position integer, p_step jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.auth_org_id();
  v_project uuid;
  v_status  public.work_order_status;
  v_pm      uuid;
  v_name    text; v_owner text; v_days numeric; v_opt boolean;
  v_n       int; v_k int; v_cur int;
  v_row     record;
  v_new     public.work_order_billing_steps;
  v_first   public.work_order_billing_steps;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  -- Same row lock as transition_work_order and lock_wo_billing_step.
  select w.project_id, w.status into v_project, v_status from public.work_orders w where w.id = p_work_order and w.org_id = v_org for update;
  if not found then raise exception 'WBS_ORDER_NOT_FOUND: work order not found' using errcode = 'P0002'; end if;
  -- The run right: the same callers as the checklist's other writers. A Project Manager level person runs it only on a project they manage.
  if not coalesce(public.actor_may_run_billing_steps(), false) then
    raise exception 'WBS_STEP_ADD_RIGHT: only a person who runs billing steps can add a step to this checklist' using errcode = '42501';
  end if;
  if coalesce(public.auth_role() = 'Project Manager', false) then
    select pr.project_manager_id into v_pm from public.projects pr where pr.id = v_project;
    if v_pm is distinct from auth.uid() then
      raise exception 'WBS_STEP_ADD_PM: only the project''s manager can add a step to this checklist' using errcode = '42501';
    end if;
  end if;
  if v_status is distinct from 'Issued' then
    raise exception 'WBS_NOT_ISSUED: billing steps change only while the work order is issued' using errcode = '55000';
  end if;

  -- the step: a name, an optional owner job role (never a field account), an optional target and optional flag
  if p_step is null or jsonb_typeof(p_step) <> 'object' then
    raise exception 'WBS_STEP_NAME: every billing step needs a name of up to 120 characters' using errcode = '23514';
  end if;
  v_name := btrim(coalesce(p_step ->> 'name', ''));
  if v_name = '' or length(v_name) > 120 then
    raise exception 'WBS_STEP_NAME: every billing step needs a name of up to 120 characters' using errcode = '23514';
  end if;
  v_owner := nullif(btrim(coalesce(p_step ->> 'owner_role_key', '')), '');
  if v_owner is not null and not exists (select 1 from public.built_in_roles r where r.key = v_owner and not public.is_light_role_key(r.key)) then
    raise exception 'WBS_STEP_ROLE: choose an owner role from the organisation''s role list; a field account cannot own a billing step' using errcode = '23514';
  end if;
  v_days := null;
  if p_step ? 'target_days' and jsonb_typeof(p_step -> 'target_days') <> 'null' then
    if jsonb_typeof(p_step -> 'target_days') <> 'number' then
      raise exception 'WBS_STEP_DAYS: a step target is a whole number of days, 1 to 365' using errcode = '23514';
    end if;
    v_days := (p_step ->> 'target_days')::numeric;
    if v_days <> trunc(v_days) or v_days < 1 or v_days > 365 then
      raise exception 'WBS_STEP_DAYS: a step target is a whole number of days, 1 to 365' using errcode = '23514';
    end if;
  end if;
  v_opt := coalesce(case when jsonb_typeof(p_step -> 'optional') = 'boolean' then (p_step ->> 'optional')::boolean end, false);

  -- the list: a finished prefix, then the current step, then the steps not opened yet
  select count(*),
         count(*) filter (where s.done_on is not null or s.skipped_on is not null),
         min(s.position) filter (where s.done_on is null and s.skipped_on is null and s.started_on is not null)
    into v_n, v_k, v_cur
    from public.work_order_billing_steps s where s.work_order_id = p_work_order;
  if v_n >= 20 then
    raise exception 'WBS_STEP_SHAPE: a work order has at most 20 billing steps' using errcode = '22023';
  end if;
  if p_after_position is null or p_after_position < 0 or p_after_position > v_n then
    raise exception 'WBS_STEP_SHAPE: position out of range' using errcode = '22023';
  end if;
  if p_after_position < coalesce(v_cur, v_k) then
    raise exception 'WBS_STEP_CLOSED: a new step goes after the current step' using errcode = '55000';
  end if;

  -- make room: the steps after the chosen place move down one, highest first ((work_order_id, position) is unique and not deferrable)
  for v_row in
    select s.id from public.work_order_billing_steps s
     where s.work_order_id = p_work_order and s.position > p_after_position
     order by s.position desc
  loop
    update public.work_order_billing_steps s set position = s.position + 1 where s.id = v_row.id;
  end loop;
  insert into public.work_order_billing_steps (org_id, work_order_id, project_id, position, name, owner_role_key, target_days, optional)
  values (v_org, p_work_order, v_project, p_after_position + 1, v_name, v_owner, v_days::smallint, v_opt)
  returning * into v_new;

  -- a list with no current step (none yet, or every step finished): the first open step is current from today and its people are told
  if v_cur is null then
    select * into v_first from public.work_order_billing_steps s
     where s.work_order_id = p_work_order and s.done_on is null and s.skipped_on is null and s.started_on is null
     order by s.position limit 1
       for update;
    if v_first.id is not null then
      update public.work_order_billing_steps s set started_on = public.native_org_today(v_org) where s.id = v_first.id returning * into v_first;
      perform public.notify_wo_step_opened(v_first);
    end if;
  end if;

  perform public.log_audit('wo_billing_step.add', v_org, auth.uid(), p_work_order,
    jsonb_build_object('step_id', v_new.id, 'position', v_new.position, 'name', v_name, 'owner_role_key', v_owner, 'after_position', p_after_position));
  return v_new.id;
end; $$;

drop trigger zz_audit_org_setting_change on public.organizations;
create trigger zz_audit_org_setting_change after update on public.organizations for each row
  execute function public.audit_org_setting_change(
    'quantity_change_limit', 'built_in_roles_enabled', 'phone_check_in_supervisor_role', 'hide_prices_from_requesters',
    'clearance_checklist_enabled', 'leave_requests_enabled', 'leave_approver_role', 'crew_loans_enabled',
    'discipline_profit_enabled', 'performance_indices_enabled', 'performance_band_low', 'performance_band_high',
    'stock_transfer_mode', 'stock_proof_timing', 'stock_wo_transfers', 'stock_reservations', 'reservation_borrow_mode',
    'reservation_borrow_role', 'reservation_borrow_label', 'dsr_stock_issue', 'dsr_stock_issue_items',
    'purchase_line_planning', 'safety_records_enabled', 'equipment_availability_target_pct',
    'equipment_utilisation_target_pct', 'equipment_escalation_down_days', 'attendance_target_rate',
    'module_people_crews', 'module_site_day', 'module_stock', 'module_purchasing_extras', 'module_billing_extras');
alter table public.organizations drop column if exists work_order_checklist_enabled;
