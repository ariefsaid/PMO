-- Reverses 2042_people_team_role_rights.sql: the live bodies and policies from before it; drops the five gates.

CREATE OR REPLACE FUNCTION public.leave_requestable_people()
 RETURNS TABLE(id uuid, name text, is_self boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select w.id, w.name, coalesce(w.profile_id = auth.uid(), false)
    from public.people w
   where public.is_active_member() and w.org_id = public.auth_org_id() and w.archived_at is null
     and (coalesce(w.profile_id = auth.uid(), false) or public.crew_can_manage()
          or exists (select 1 from public.profiles p where p.id = w.profile_id and p.manager_id = auth.uid()))
   order by 3 desc, w.name
$function$
;

CREATE OR REPLACE FUNCTION public.leave_request_submit(p_person_id uuid, p_type_id uuid, p_start date, p_end date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_person record;
  v_id uuid;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'LV_FORBIDDEN: not an active member' using errcode = '42501';
  end if;
  if not public.leave_enabled() then
    raise exception 'LV_DISABLED: leave requests are not switched on for this organisation' using errcode = '42501';
  end if;
  select w.id, w.profile_id into v_person from public.people w where w.id = p_person_id and w.org_id = v_org;
  if not found then
    raise exception 'LV_REF: the person is not in this organisation' using errcode = '23514';
  end if;
  if not (coalesce(v_person.profile_id = v_uid, false) or public.crew_can_manage()
          or exists (select 1 from public.profiles p where p.id = v_person.profile_id and p.manager_id = v_uid)) then
    raise exception 'LV_FORBIDDEN: you cannot enter a request for this person' using errcode = '42501';
  end if;
  if p_end < p_start then
    raise exception 'LV_RANGE: the last day is before the first day' using errcode = '23514';
  end if;
  begin
    insert into public.leave_requests (person_id, leave_type_id, start_date, end_date, reason, entered_by)
      values (p_person_id, p_type_id, p_start, p_end, nullif(btrim(p_reason), ''), v_uid) returning id into v_id;
  exception when exclusion_violation then
    raise exception 'LV_OVERLAP: this person already has a pending or approved request on some of these days'
      using errcode = '23514';
  end;
  perform public.log_audit('leave.submit', v_org, v_uid, v_id, jsonb_build_object('person_id', p_person_id));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_document_warning_days(p_days integer[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'admin only' using errcode = '42501'; end if;
  if p_days is null or cardinality(p_days) not between 1 and 5 or exists (select 1 from unnest(p_days) z where z is null or z not between 1 and 365) then
    raise exception 'warning days: 1 to 5 values, each 1 to 365' using errcode = '22023';
  end if;
  update public.organizations set document_warning_days = (select array_agg(distinct z order by z desc) from unnest(p_days) z)
   where id = public.auth_org_id();
end $function$
;

alter policy people_insert on public.people
  with check ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and ((select public.auth_role()) = any (array['Admin'::user_role, 'Project Manager'::user_role])));
alter policy people_update on public.people
  using ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and ((select public.auth_role()) = any (array['Admin'::user_role, 'Project Manager'::user_role])))
  with check ((org_id = (select public.auth_org_id())) and (select public.is_active_member()));
alter policy person_clearances_select on public.person_clearances
  using ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and ((select public.auth_role()) = any (array['Admin'::user_role, 'Project Manager'::user_role, 'Finance'::user_role, 'Executive'::user_role])));
alter policy clearance_items_select on public.clearance_items
  using ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and ((select public.auth_role()) = any (array['Admin'::user_role, 'Project Manager'::user_role, 'Finance'::user_role, 'Executive'::user_role])));
alter policy person_clearances_insert on public.person_clearances
  with check ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and ((select public.auth_role()) = any (array['Admin'::user_role, 'Project Manager'::user_role])));
alter policy person_clearances_update on public.person_clearances
  using ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and ((select public.auth_role()) = any (array['Admin'::user_role, 'Project Manager'::user_role])))
  with check (org_id = (select public.auth_org_id()));
alter policy person_clearances_delete on public.person_clearances
  using ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and ((select public.auth_role()) = any (array['Admin'::user_role, 'Project Manager'::user_role])));
alter policy timesheets_select on public.timesheets
  using ((org_id = (select public.auth_org_id())) and ((user_id = (select auth.uid())) or ((select public.auth_role()) = any (array['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role]))
         or (exists (select 1 from public.profiles p where p.id = timesheets.user_id and p.manager_id = (select auth.uid()))))
         and (select public.is_active_member()));
alter policy timesheet_entries_select on public.timesheet_entries
  using ((org_id = (select public.auth_org_id())) and (exists (select 1 from public.timesheets t where t.id = timesheet_entries.timesheet_id
         and ((t.user_id = (select auth.uid())) or ((select public.auth_role()) = any (array['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role]))
              or (exists (select 1 from public.profiles p where p.id = t.user_id and p.manager_id = (select auth.uid())))))) and (select public.is_active_member()));
alter policy document_types_insert on public.document_types
  with check ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and ((select public.auth_role()) = 'Admin'::user_role));
alter policy document_types_update on public.document_types
  using ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and ((select public.auth_role()) = 'Admin'::user_role))
  with check (org_id = (select public.auth_org_id()));
drop function public.actor_may_manage_document_types(text, boolean);
drop function public.actor_may_review_timesheets();
drop function public.actor_may_enter_leave_for_others();
drop function public.actor_may_tick_clearances(uuid);
drop function public.actor_may_write_people();
