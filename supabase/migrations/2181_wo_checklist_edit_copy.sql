-- 2181_wo_checklist_edit_copy.sql — the review fixes of the work-order checklist editing (2180): the organisation switch, and the list
-- saved as a template by a server-side copy. Spec docs/specs/wo-checklist-edit.spec.md (FR-WCE-002/003/006); proven by
-- supabase/tests/2180_wo_billing_step_add.test.sql (AC-WCE-001..006, with the mutation polarity section at its end).
-- Rollback: supabase/migrations/rollback/2181_wo_checklist_edit_copy_down.sql
-- drops: add_work_order_step is restated from 2180 with two rule changes and nothing removed: a null place now means the end of the list
--        (a viewer who cannot see the last steps still appends; review 1124d F4), and the organisation's checklist-editing switch is
--        enforced in the body (F2). The step, role, day, place and closed-list refusals, the row lock and the audit event are unchanged.

-- ── the switch: a new behaviour that changes what existing organisations see sits behind a per-organisation setting, off by default ────
-- Written only through set_org_work_order_checklist_edit (Admin); its change is audited by the standing trigger (1510, ADR-0121).
alter table public.organizations add column work_order_checklist_enabled boolean not null default false;
comment on column public.organizations.work_order_checklist_enabled is
  'On: a person who runs billing steps may add a step to an issued work order''s checklist, and Finance or an Admin may save a work order''s checklist as a template (2181). Default false. Written only through set_org_work_order_checklist_edit (Admin).';

-- Restated from 1670 (the latest migration that defines it), with the new column appended.
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
    'module_people_crews', 'module_site_day', 'module_stock', 'module_purchasing_extras', 'module_billing_extras',
    'work_order_checklist_enabled');

create function public.set_org_work_order_checklist_edit(p_enabled boolean) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid      := public.auth_org_id();
  v_role user_role := public.auth_role();
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_role is distinct from 'Admin' then
    raise exception 'WBS_CHECKLIST_SETTING: only an Admin can switch checklist editing on or off' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'WBS_CHECKLIST_SETTING: checklist editing is on or off' using errcode = '22023';
  end if;
  update public.organizations o set work_order_checklist_enabled = p_enabled where o.id = v_org;
  if not found then raise exception 'WBS_ORDER_NOT_FOUND: organisation not found' using errcode = 'P0002'; end if;
  return p_enabled;
end; $$;
revoke all on function public.set_org_work_order_checklist_edit(boolean) from public, anon;
grant execute on function public.set_org_work_order_checklist_edit(boolean) to authenticated, service_role;

-- ── add a step: restated from 2180 with the switch and the null place (see "drops" above) ─────────────────────────────────────────
create or replace function public.add_work_order_step(p_work_order uuid, p_after_position integer, p_step jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.auth_org_id();
  v_project uuid;
  v_status  public.work_order_status;
  v_pm      uuid;
  v_name    text; v_owner text; v_days numeric; v_opt boolean;
  v_n       int; v_k int; v_cur int; v_after int;
  v_row     record;
  v_new     public.work_order_billing_steps;
  v_first   public.work_order_billing_steps;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  -- Same row lock as transition_work_order and lock_wo_billing_step.
  select w.project_id, w.status into v_project, v_status from public.work_orders w where w.id = p_work_order and w.org_id = v_org for update;
  if not found then raise exception 'WBS_ORDER_NOT_FOUND: work order not found' using errcode = 'P0002'; end if;
  -- The organisation's switch: off until an Admin turns it on (2181).
  if not coalesce((select o.work_order_checklist_enabled from public.organizations o where o.id = v_org), false) then
    raise exception 'WBS_CHECKLIST_OFF: checklist editing is not switched on for this organisation' using errcode = '55000';
  end if;
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
  -- a null place is the end of the list: a viewer who cannot see the last steps still appends after them (2181)
  v_after := coalesce(p_after_position, v_n);
  if v_after < 0 or v_after > v_n then
    raise exception 'WBS_STEP_SHAPE: position out of range' using errcode = '22023';
  end if;
  if v_after < coalesce(v_cur, v_k) then
    raise exception 'WBS_STEP_CLOSED: a new step goes after the current step' using errcode = '55000';
  end if;

  -- make room: the steps after the chosen place move down one, highest first ((work_order_id, position) is unique and not deferrable)
  for v_row in
    select s.id from public.work_order_billing_steps s
     where s.work_order_id = p_work_order and s.position > v_after
     order by s.position desc
  loop
    update public.work_order_billing_steps s set position = s.position + 1 where s.id = v_row.id;
  end loop;
  insert into public.work_order_billing_steps (org_id, work_order_id, project_id, position, name, owner_role_key, target_days, optional)
  values (v_org, p_work_order, v_project, v_after + 1, v_name, v_owner, v_days::smallint, v_opt)
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
    jsonb_build_object('step_id', v_new.id, 'position', v_new.position, 'name', v_name, 'owner_role_key', v_owner, 'after_position', v_after));
  return v_new.id;
end; $$;

-- ── save a work order's checklist as a new template: a server-side copy, so the saved list is complete ─────────────────────────────
-- The page reads only the steps the viewer may see (hidden-from beats every right but the named person, FR-WBS-004): a list sent back
-- from the page could be incomplete and would lose each step's hidden-from rule (review 1124d F1). The database copies every step of
-- the work order with its owner job role, hidden-from roles, target days, optional flag and checklist documents. Finance or an Admin,
-- the rule of save_billing_step_template (1366). The access-level owner role and the per-claim target date have no work-order source.
create function public.save_work_order_steps_as_template(p_work_order uuid, p_name text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid      := public.auth_org_id();
  v_role  user_role := public.auth_role();
  v_name  text      := btrim(coalesce(p_name, ''));
  v_id    uuid;
  v_n     int; v_docs int;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'WBS_SETTER_ROLE: only Finance or an Admin can save billing step templates' using errcode = '42501';
  end if;
  -- the list cannot change while it is copied: the work-order row lock every step writer takes
  perform 1 from public.work_orders w where w.id = p_work_order and w.org_id = v_org for update;
  if not found then raise exception 'WBS_ORDER_NOT_FOUND: work order not found' using errcode = 'P0002'; end if;
  if not coalesce((select o.work_order_checklist_enabled from public.organizations o where o.id = v_org), false) then
    raise exception 'WBS_CHECKLIST_OFF: checklist editing is not switched on for this organisation' using errcode = '55000';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'WBS_TEMPLATE_NAME: a template needs a name of up to 120 characters' using errcode = '23514';
  end if;
  select count(*) into v_n from public.work_order_billing_steps s where s.work_order_id = p_work_order and s.org_id = v_org;
  if v_n = 0 then
    raise exception 'WBS_TEMPLATE_EMPTY: this checklist has no steps to save as a template' using errcode = '22023';
  end if;
  -- one active template per name in an organisation (the unique index of 1365)
  begin
    insert into public.billing_step_templates (org_id, name, created_by) values (v_org, v_name, auth.uid()) returning id into v_id;
  exception when unique_violation then
    raise exception 'WBS_TEMPLATE_TAKEN: an active template with this name already exists' using errcode = '23505';
  end;
  insert into public.billing_step_template_steps
    (org_id, template_id, position, name, owner_role_key, hidden_from_role_keys, target_days, client_side, optional)
  select v_org, v_id, s.position, s.name, s.owner_role_key, s.hidden_from_role_keys, s.target_days, false, s.optional
    from public.work_order_billing_steps s
   where s.work_order_id = p_work_order and s.org_id = v_org;
  insert into public.billing_step_template_documents (org_id, step_id, position, name, required)
  select v_org, ts.id, d.position, d.name, d.required
    from public.work_order_billing_step_documents d
    join public.work_order_billing_steps s on s.id = d.step_id and s.work_order_id = p_work_order and s.org_id = v_org
    join public.billing_step_template_steps ts on ts.template_id = v_id and ts.position = s.position;
  get diagnostics v_docs = row_count;
  perform public.log_audit('wo_billing_steps.save_as_template', v_org, auth.uid(), v_id,
    jsonb_build_object('work_order_id', p_work_order, 'name', v_name, 'steps', v_n, 'documents', v_docs));
  return v_id;
end; $$;
revoke all on function public.save_work_order_steps_as_template(uuid, text) from public, anon;
grant execute on function public.save_work_order_steps_as_template(uuid, text) to authenticated, service_role;
