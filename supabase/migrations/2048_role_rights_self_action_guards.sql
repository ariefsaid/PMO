-- 2048_role_rights_self_action_guards.sql — separation of duties on the job-role rights of 2041 and 2042.
-- A crew tool report: nobody writes off a report they made, a crew manager included; replacing or repairing stays open to
-- the reporter. A task from an issue: the Site Supervisor's crew counts only while its roster on the work order is current
-- (the same date rule as the Storekeeper's tools gate). The cleared-for-site checklist: a Project Manager, like the HR Officer,
-- never ticks the checklist of their own person record; an Admin stays exempt so an organisation with one Admin is never stuck.
-- A person's identity link (people.profile_id): no one but an Admin changes it on a row that is, or would become, their own,
-- so the own-record test above cannot be stepped around by unlinking first. Creating a person row is unchanged.
-- The 2042 people-team policies also state active membership in the policy text, as every other permissive policy on those
-- tables does (their gates already require it).
-- Restated from 2041 (close_crew_tool_report, actor_may_task_issue) and 2042 (actor_may_tick_clearances).
-- drops: the crew-manager exemption from the own-report refusal, and the refusal for a reporter's own replace or repair
-- (the reporter may now close those); the Project Manager's exemption from the own-record checklist test.
-- Proven by supabase/tests/2048_role_rights_self_action_guards.test.sql. Rollback: rollback/2048_role_rights_self_action_guards_down.sql

-- ── §1 crew tool reports ─────────────────────────────────────────────────────────────────────────────────────────────────────────
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
  -- nobody writes off a report they made, a crew manager included; replacing or repairing stays open to the reporter (2048)
  if v_rep.reported_by = v_uid and p_resolution = 'written_off' then                                     -- mut:rr_own_writeoff
    raise exception 'CTR_OWN_REPORT: you reported this tool, so someone else writes it off' using errcode = '42501';
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

-- ── §2 tasks from an issue ───────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.actor_may_task_issue(p_work_order uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and (
      public.auth_role() in ('Admin','Executive','Project Manager','Finance')
      or (public.actor_holds_job_role('site_supervisor')                                                   -- mut:rr_ss_task
          and exists (select 1 from public.work_orders w
                       where w.id = p_work_order and w.org_id = public.auth_org_id()
                         and (w.responsible_person_id = auth.uid()
                              or exists (select 1 from public.work_order_crews r join public.crews c on c.id = r.crew_id
                                          where r.work_order_id = w.id and c.field_controller_id = auth.uid()
                                            and public.native_org_today(r.org_id) between r.valid_from                -- mut:rr_ss_task_current
                                                and coalesce(r.valid_to, 'infinity'::date)))))), false)
$$;

-- ── §3 the cleared-for-site checklist ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.actor_may_tick_clearances(p_person uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  -- An Admin is exempt from the own-record test: an organisation with one Admin must still be able to clear that Admin.
  select coalesce(public.is_active_member() and (public.auth_role() = 'Admin'                                     -- mut:rr_clear_own_all
                  or ((public.auth_role() = 'Project Manager' or public.actor_holds_job_role('hr_officer'))     -- mut:rr_hr_clear
                      and not exists (select 1 from public.people w where w.id = p_person and w.profile_id = auth.uid()))), false)  -- mut:rr_hr_clear_own
$$;

-- ── §4 the identity link ─────────────────────────────────────────────────────────────────────────────────────────────────────────
create function public.people_identity_link_guard() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  -- Definers and the service role write as their owner, not as a signed-in caller.
  if current_user <> 'authenticated' then return new; end if;
  if new.profile_id is not distinct from old.profile_id then return new; end if;
  if coalesce(public.auth_role() = 'Admin', false) then return new; end if;
  if new.profile_id = auth.uid() or old.profile_id = auth.uid() then                                         -- mut:rr_identity_self
    raise exception 'PPL_PROFILE_SELF: only an Admin can link or unlink their own person record' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.people_identity_link_guard() from public, anon, authenticated;

create trigger people_identity_link_guard before update of profile_id on public.people
  for each row execute function public.people_identity_link_guard();

-- ── §5 the people-team policies state active membership in the policy itself (as every permissive policy on these tables does) ──
alter policy people_insert on public.people
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_may_write_people()));
alter policy person_clearances_insert on public.person_clearances
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.actor_may_tick_clearances(person_id));
alter policy person_clearances_update on public.person_clearances
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.actor_may_tick_clearances(person_id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.actor_may_tick_clearances(person_id));
alter policy person_clearances_delete on public.person_clearances
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.actor_may_tick_clearances(person_id));
alter policy document_types_insert on public.document_types
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.actor_may_manage_document_types(applies_to, is_medical));
alter policy document_types_update on public.document_types
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.actor_may_manage_document_types(applies_to, is_medical))
  with check (org_id = (select public.auth_org_id()));
