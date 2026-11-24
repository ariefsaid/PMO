-- rollback/2048_role_rights_self_action_guards_down.sql — restores the 2041 and 2042 bodies and drops the identity-link guard.
drop trigger if exists people_identity_link_guard on public.people;
drop function if exists public.people_identity_link_guard();

CREATE OR REPLACE FUNCTION public.close_crew_tool_report(p_report uuid, p_resolution text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_rep public.crew_tool_reports; v_line public.crew_tool_lines; v_assignee uuid;
begin
  perform public.assert_not_light();
  if v_org is null or v_uid is null or not public.is_active_member() then
    raise exception 'active organization required' using errcode = '42501';
  end if;
  if p_resolution not in ('replaced', 'repaired', 'written_off') then
    raise exception 'invalid resolution' using errcode = '22023';
  end if;
  select * into v_rep from public.crew_tool_reports r where r.id = p_report and r.org_id = v_org;
  if v_rep.id is null then raise exception 'tool report not found' using errcode = 'P0002'; end if;
  select * into v_line from public.crew_tool_lines l where l.id = v_rep.line_id for update;
  select * into v_rep from public.crew_tool_reports r where r.id = p_report for update;
  if v_rep.task_id is not null then select t.assignee_id into v_assignee from public.tasks t where t.id = v_rep.task_id; end if;
  -- the reporter closes nothing unless they are also the assignee or a crew manager (AC-CTR-008)
  if not (public.crew_can_manage() or v_assignee = v_uid) then
    raise exception 'CTR_NOT_ALLOWED: only the task assignee or a crew manager closes a tool report' using errcode = '42501';
  end if;
  if v_rep.reported_by = v_uid and not public.crew_can_manage() then                                   -- mut:rr_own_report
    raise exception 'CTR_OWN_REPORT: you reported this tool, so someone else closes the report' using errcode = '42501';
  end if;
  if v_rep.status <> 'open' then
    raise exception 'CTR_REPORT_CLOSED: already closed as %', v_rep.resolution using errcode = '23514', detail = v_rep.resolution;
  end if;
  if p_resolution = 'repaired' and v_rep.kind <> 'damaged' then
    raise exception 'CTR_RESOLUTION: only a damaged tool can be repaired' using errcode = '23514';
  end if;

  perform set_config('pmo.crew_tool_rpc', 'on', true);
  update public.crew_tool_reports
     set status = 'closed', resolution = p_resolution, closed_by = v_uid, closed_at = now() where id = v_rep.id;
  if p_resolution = 'written_off' then
    update public.crew_tool_lines set held_qty = held_qty - v_rep.qty where id = v_line.id;
  end if;
  if v_rep.task_id is not null then
    update public.tasks set status = 'Done', completed_at = coalesce(completed_at, now())
     where id = v_rep.task_id and status <> 'Done';
  end if;
  perform public.log_audit('crew_tool.close', v_org, v_uid, v_rep.id,
    jsonb_build_object('resolution', p_resolution, 'qty', v_rep.qty, 'kind', v_rep.kind));
  perform set_config('pmo.crew_tool_rpc', 'off', true);
end $function$
;

create or replace function public.actor_may_task_issue(p_work_order uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and (
      public.auth_role() in ('Admin','Executive','Project Manager','Finance')
      or (public.actor_holds_job_role('site_supervisor')                                                   -- mut:rr_ss_task
          and exists (select 1 from public.work_orders w
                       where w.id = p_work_order and w.org_id = public.auth_org_id()
                         and (w.responsible_person_id = auth.uid()
                              or exists (select 1 from public.work_order_crews r join public.crews c on c.id = r.crew_id
                                          where r.work_order_id = w.id and c.field_controller_id = auth.uid()))))), false)
$$;

create or replace function public.actor_may_tick_clearances(p_person uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and (public.auth_role() in ('Admin', 'Project Manager')
                  or (public.actor_holds_job_role('hr_officer')                                            -- mut:rr_hr_clear
                      and not exists (select 1 from public.people w where w.id = p_person and w.profile_id = auth.uid()))), false)  -- mut:rr_hr_clear_own
$$;

alter policy people_insert on public.people
  with check (org_id = (select public.auth_org_id()) and (select public.actor_may_write_people()));
alter policy person_clearances_insert on public.person_clearances
  with check (org_id = (select public.auth_org_id()) and public.actor_may_tick_clearances(person_id));
alter policy person_clearances_update on public.person_clearances
  using (org_id = (select public.auth_org_id()) and public.actor_may_tick_clearances(person_id))
  with check (org_id = (select public.auth_org_id()) and public.actor_may_tick_clearances(person_id));
alter policy person_clearances_delete on public.person_clearances
  using (org_id = (select public.auth_org_id()) and public.actor_may_tick_clearances(person_id));
alter policy document_types_insert on public.document_types
  with check (org_id = (select public.auth_org_id()) and public.actor_may_manage_document_types(applies_to, is_medical));
alter policy document_types_update on public.document_types
  using (org_id = (select public.auth_org_id()) and public.actor_may_manage_document_types(applies_to, is_medical))
  with check (org_id = (select public.auth_org_id()));
