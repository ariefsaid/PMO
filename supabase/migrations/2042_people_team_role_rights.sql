-- 2042_people_team_role_rights.sql — the HR Officer and HR Manager job roles' people rights, by job-role key (access levels unchanged).
-- HR Officer (held key): adds and edits people in the register (the form and the import: both write through people_insert and
-- people_update); reads and ticks a person's cleared-for-site checklist, never their own; enters a leave request for any worker;
-- reads every timesheet and its entries, to review them. It approves no timesheet (transition_timesheet is unchanged).
-- HR Manager (held key): adds and edits the organisation's non-medical person document types (their recipients) and sets the
-- document warning days. A medical type, and every equipment type, stays with the Admin.
-- Unchanged: the manager-link rule (1930: only an Admin or the people team sets a manager, only an Admin names themselves); marking a
-- person as left (Admin only, people_archive_admin_only); medical documents stay behind the medical right (their RLS, 1535).
-- Each right reads ONE gate: actor_may_write_people, actor_may_tick_clearances, actor_may_enter_leave_for_others,
-- actor_may_review_timesheets, actor_may_manage_document_types. Each starts with today's rule.
-- Restated from the live definitions: leave_requestable_people (1243), leave_request_submit (1241), set_document_warning_days (0972,
-- with the field-account guard 1530 added to its body); the policies from 1035, 1236, 0646 and 0970 as pg_policies holds them.
-- drops: the crew-manager test in the two leave functions and the Admin-only test in set_document_warning_days, each now the gate.
-- Proven by supabase/tests/2042_people_team_role_rights.test.sql. Rollback: rollback/2042_people_team_role_rights_down.sql

-- ── §1 the gates ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create function public.actor_may_write_people() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and (public.auth_role() in ('Admin', 'Project Manager')
                  or public.actor_holds_job_role('hr_officer')), false)                                   -- mut:rr_hr_people
$$;
create function public.actor_may_tick_clearances(p_person uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and (public.auth_role() in ('Admin', 'Project Manager')
                  or (public.actor_holds_job_role('hr_officer')                                            -- mut:rr_hr_clear
                      and not exists (select 1 from public.people w where w.id = p_person and w.profile_id = auth.uid()))), false)  -- mut:rr_hr_clear_own
$$;
create function public.actor_may_enter_leave_for_others() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.crew_can_manage() or public.actor_holds_job_role('hr_officer'), false)            -- mut:rr_hr_leave
$$;
create function public.actor_may_review_timesheets() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and public.actor_holds_job_role('hr_officer'), false)         -- mut:rr_hr_sheets
$$;
create function public.actor_may_manage_document_types(p_applies_to text, p_medical boolean) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and (public.auth_role() = 'Admin'
                  or (public.actor_holds_job_role('hr_manager')                                            -- mut:rr_hrm_types
                      and p_applies_to = 'person' and not coalesce(p_medical, false))), false)
$$;
comment on function public.actor_may_write_people() is 'People register writes: Admin, Project Manager, or the HR Officer job role.';
comment on function public.actor_may_tick_clearances(uuid) is
  'Cleared-for-site checklist: Admin, Project Manager, or the HR Officer job role for anyone but themselves.';
comment on function public.actor_may_enter_leave_for_others() is 'Leave for another worker: a crew manager or the HR Officer job role.';
comment on function public.actor_may_review_timesheets() is 'Reads every timesheet to review it: the HR Officer job role (approval is unchanged).';
comment on function public.actor_may_manage_document_types(text, boolean) is
  'Document types: Admin; or the HR Manager job role for a non-medical person type (warning days: pass person, false).';
revoke all on function public.actor_may_write_people(), public.actor_may_tick_clearances(uuid), public.actor_may_enter_leave_for_others(),
  public.actor_may_review_timesheets(), public.actor_may_manage_document_types(text, boolean) from public, anon;
grant execute on function public.actor_may_write_people(), public.actor_may_tick_clearances(uuid), public.actor_may_enter_leave_for_others(),
  public.actor_may_review_timesheets(), public.actor_may_manage_document_types(text, boolean) to authenticated, service_role;

-- ── §2 people register ───────────────────────────────────────────────────────────────────────────────────────────────────────────
alter policy people_insert on public.people
  with check (org_id = (select public.auth_org_id()) and (select public.actor_may_write_people()));
alter policy people_update on public.people
  using (org_id = (select public.auth_org_id()) and (select public.actor_may_write_people()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

-- ── §3 cleared-for-site checklist ────────────────────────────────────────────────────────────────────────────────────────────────
alter policy person_clearances_select on public.person_clearances
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Project Manager', 'Finance', 'Executive')
              or (select public.actor_holds_job_role('hr_officer'))));
alter policy clearance_items_select on public.clearance_items
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Project Manager', 'Finance', 'Executive')
              or (select public.actor_holds_job_role('hr_officer'))));  -- mut:rr_hr_items
alter policy person_clearances_insert on public.person_clearances
  with check (org_id = (select public.auth_org_id()) and public.actor_may_tick_clearances(person_id));
alter policy person_clearances_update on public.person_clearances
  using (org_id = (select public.auth_org_id()) and public.actor_may_tick_clearances(person_id))
  with check (org_id = (select public.auth_org_id()) and public.actor_may_tick_clearances(person_id));
alter policy person_clearances_delete on public.person_clearances
  using (org_id = (select public.auth_org_id()) and public.actor_may_tick_clearances(person_id));

-- ── §4 timesheets: the HR Officer reads them; nothing else changes ────────────────────────────────────────────────────────────────
alter policy timesheets_select on public.timesheets
  using (org_id = (select public.auth_org_id())
         and (user_id = (select auth.uid())
              or (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
              or exists (select 1 from public.profiles p where p.id = timesheets.user_id and p.manager_id = (select auth.uid()))
              or (select public.actor_may_review_timesheets()))
         and (select public.is_active_member()));
alter policy timesheet_entries_select on public.timesheet_entries
  using (org_id = (select public.auth_org_id())
         and exists (select 1 from public.timesheets t
                      where t.id = timesheet_entries.timesheet_id
                        and (t.user_id = (select auth.uid())
                             or (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
                             or exists (select 1 from public.profiles p where p.id = t.user_id and p.manager_id = (select auth.uid()))
                             or (select public.actor_may_review_timesheets())))
         and (select public.is_active_member()));

-- ── §5 document types and warning days ───────────────────────────────────────────────────────────────────────────────────────────
alter policy document_types_insert on public.document_types
  with check (org_id = (select public.auth_org_id()) and public.actor_may_manage_document_types(applies_to, is_medical));
alter policy document_types_update on public.document_types
  using (org_id = (select public.auth_org_id()) and public.actor_may_manage_document_types(applies_to, is_medical))
  with check (org_id = (select public.auth_org_id()));

-- ── §6 leave on behalf of a worker ───────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.leave_requestable_people()
 RETURNS TABLE(id uuid, name text, is_self boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select w.id, w.name, coalesce(w.profile_id = auth.uid(), false)
    from public.people w
   where public.is_active_member() and w.org_id = public.auth_org_id() and w.archived_at is null
     and (coalesce(w.profile_id = auth.uid(), false) or public.actor_may_enter_leave_for_others()
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
  if not (coalesce(v_person.profile_id = v_uid, false) or public.actor_may_enter_leave_for_others()
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
  if not public.actor_may_manage_document_types('person', false) then
    raise exception 'only an Admin or the HR Manager sets the document warning days' using errcode = '42501';
  end if;
  if p_days is null or cardinality(p_days) not between 1 and 5 or exists (select 1 from unnest(p_days) z where z is null or z not between 1 and 365) then
    raise exception 'warning days: 1 to 5 values, each 1 to 365' using errcode = '22023';
  end if;
  update public.organizations set document_warning_days = (select array_agg(distinct z order by z desc) from unnest(p_days) z)
   where id = public.auth_org_id();
end $function$
;
