-- Reverses 2260_leave_person_manager_routing.sql to the live 2042/1611 routing contract.
delete from public.notifications where message_key = 'leaveRequestPending';

drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (entered_by = (select auth.uid())
              or exists (select 1 from public.people w where w.id = person_id and w.profile_id = (select auth.uid()))
              or (select public.leave_authority(person_id))));

drop function if exists public.leave_waiting_names(uuid);
drop function if exists public.leave_authority_for_request(uuid, uuid);
drop function if exists public.leave_decider_profiles(uuid, uuid);

create or replace function public.leave_authority(p_person_id uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_active_member() and exists (
    select 1 from public.people w, public.organizations o
     where w.id = p_person_id and w.org_id = public.auth_org_id() and o.id = w.org_id
       and (public.auth_role()::text = coalesce(o.leave_approver_role, 'Admin')
            or exists (select 1 from public.profiles p where p.id = w.profile_id and p.manager_id = auth.uid())))
$$;
revoke all on function public.leave_authority(uuid) from public, anon;
grant execute on function public.leave_authority(uuid) to authenticated;

create or replace function public.leave_requestable_people()
 returns table(id uuid, name text, is_self boolean)
 language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.name, coalesce(w.profile_id = auth.uid(), false)
    from public.people w
   where public.is_active_member() and w.org_id = public.auth_org_id() and w.archived_at is null
     and (coalesce(w.profile_id = auth.uid(), false) or public.crew_can_manage()
          or exists (select 1 from public.profiles p where p.id = w.profile_id and p.manager_id = auth.uid()))
   order by 3 desc, w.name
$$;
revoke all on function public.leave_requestable_people() from public, anon;
grant execute on function public.leave_requestable_people() to authenticated;

create or replace function public.leave_request_submit(p_person_id uuid, p_type_id uuid, p_start date, p_end date, p_reason text)
 returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_person record; v_id uuid;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'LV_FORBIDDEN: not an active member' using errcode = '42501';
  end if;
  if not public.leave_enabled() then
    raise exception 'LV_DISABLED: leave requests are not switched on for this organisation' using errcode = '42501';
  end if;
  select w.id, w.profile_id into v_person from public.people w where w.id = p_person_id and w.org_id = v_org;
  if not found then raise exception 'LV_REF: the person is not in this organisation' using errcode = '23514'; end if;
  if not (coalesce(v_person.profile_id = v_uid, false) or public.crew_can_manage()
          or exists (select 1 from public.profiles p where p.id = v_person.profile_id and p.manager_id = v_uid)) then
    raise exception 'LV_FORBIDDEN: you cannot enter a request for this person' using errcode = '42501';
  end if;
  if p_end < p_start then raise exception 'LV_RANGE: the last day is before the first day' using errcode = '23514'; end if;
  begin
    insert into public.leave_requests (person_id, leave_type_id, start_date, end_date, reason, entered_by)
      values (p_person_id, p_type_id, p_start, p_end, nullif(btrim(p_reason), ''), v_uid) returning id into v_id;
  exception when exclusion_violation then
    raise exception 'LV_OVERLAP: this person already has a pending or approved request on some of these days' using errcode = '23514';
  end;
  perform public.log_audit('leave.submit', v_org, v_uid, v_id, jsonb_build_object('person_id', p_person_id));
  return v_id;
end $$;
revoke all on function public.leave_request_submit(uuid, uuid, date, date, text) from public, anon;
grant execute on function public.leave_request_submit(uuid, uuid, date, date, text) to authenticated;

drop function public.leave_requests_visible();
create function public.leave_requests_visible()
  returns table (id uuid, person_id uuid, person_name text, leave_type_id uuid, type_name text, start_date date,
                 end_date date, days integer, reason text, status text, decided_at timestamptz, decision_note text,
                 is_mine boolean, can_decide boolean, decided_by_name text, line_manager_name text, approver_role text)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select r.id, r.person_id, w.name, r.leave_type_id, t.name, r.start_date, r.end_date, (r.end_date - r.start_date + 1),
         r.reason, r.status, r.decided_at, r.decision_note,
         (r.entered_by = (select auth.uid())
            or exists (select 1 from public.people me where me.id = r.person_id and me.profile_id = (select auth.uid()))),
         (r.status = 'Pending' and public.leave_authority(r.person_id)
            and r.entered_by <> (select auth.uid())
            and not exists (select 1 from public.people me where me.id = r.person_id and me.profile_id = (select auth.uid()))),
         (select d.full_name from public.profiles d where d.id = r.decided_by),
         (select m.full_name from public.people pw join public.profiles pp on pp.id = pw.profile_id
            join public.profiles m on m.id = pp.manager_id where pw.id = r.person_id),
         (select coalesce(o.leave_approver_role, 'Admin') from public.organizations o where o.id = r.org_id)
    from public.leave_requests r
    join public.people_directory w on w.id = r.person_id
    join public.leave_types t on t.id = r.leave_type_id
   where public.leave_enabled()
   order by (r.status = 'Pending') desc, r.start_date desc, r.id
$$;
revoke all on function public.leave_requests_visible() from public, anon;
grant execute on function public.leave_requests_visible() to authenticated;

create or replace function public.leave_request_decide(p_id uuid, p_decision text, p_note text)
  returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_req public.leave_requests; v_profile uuid; v_type text; v_to uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_org is null or not public.is_active_member() then raise exception 'LV_FORBIDDEN: not an active member' using errcode = '42501'; end if;
  if p_decision not in ('Approved', 'Rejected') then raise exception 'LV_DECISION: decide Approved or Rejected' using errcode = '22023'; end if;
  select * into v_req from public.leave_requests r where r.id = p_id and r.org_id = v_org for update;
  if not found then raise exception 'LV_NOT_FOUND: no such request' using errcode = 'P0002'; end if;
  select w.profile_id into v_profile from public.people w where w.id = v_req.person_id;
  if v_req.entered_by = v_uid or coalesce(v_profile = v_uid, false) then
    raise exception 'LV_SOD: you cannot decide your own request, or one you entered' using errcode = '42501'; end if;
  if not public.leave_authority(v_req.person_id) then raise exception 'LV_FORBIDDEN: you cannot decide this request' using errcode = '42501'; end if;
  if v_req.status <> 'Pending' then raise exception 'LV_DECIDED: this request is already %', lower(v_req.status) using errcode = '23514'; end if;
  if p_decision = 'Rejected' and nullif(btrim(p_note), '') is null then raise exception 'LV_NOTE: give a reason when rejecting' using errcode = '23514'; end if;
  update public.leave_requests set status = p_decision, decided_by = v_uid, decided_at = now(),
         decision_note = nullif(btrim(p_note), '') where id = p_id;
  perform public.log_audit('leave.' || lower(p_decision), v_org, v_uid, p_id, '{}'::jsonb);
  v_to := coalesce(v_profile, v_req.entered_by);
  if v_to is not null and v_to <> v_uid then
    select t.name into v_type from public.leave_types t where t.id = v_req.leave_type_id;
    insert into public.notifications (org_id, owner_id, severity, title, body, metadata, message_key, message_params)
    values (v_org, v_to, case when p_decision = 'Approved' then 'info' else 'warning' end,
            case when p_decision = 'Approved' then 'Leave approved' else 'Leave rejected' end,
            v_type || ' · ' || v_req.start_date || ' – ' || v_req.end_date
              || case when nullif(btrim(p_note), '') is null then '' else ' · ' || btrim(p_note) end,
            jsonb_build_object('leave_request_id', p_id),
            case when p_decision = 'Approved' then 'leaveApproved' else 'leaveRejected' end,
            jsonb_build_object('type', v_type, 'from', v_req.start_date, 'to', v_req.end_date, 'note', nullif(btrim(p_note), '')));
  end if;
  return p_decision;
end $$;
revoke all on function public.leave_request_decide(uuid, text, text) from public, anon;
grant execute on function public.leave_request_decide(uuid, text, text) to authenticated;

create or replace function public.notifications_message_template_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_budget_owner name; v_leave_owner name;
begin
  if tg_op = 'UPDATE' then
    if new.message_key is distinct from old.message_key or new.message_params is distinct from old.message_params then
      raise exception 'notification message is immutable' using errcode = '42501';
    end if;
    return new;
  end if;
  select pg_get_userbyid(p.proowner) into v_budget_owner
    from pg_catalog.pg_proc p where p.oid = 'public.archive_budget_version_with_cancel_intent(uuid,boolean,uuid)'::regprocedure;
  select pg_get_userbyid(p.proowner) into v_leave_owner
    from pg_catalog.pg_proc p where p.oid = 'public.leave_request_decide(uuid,text,text)'::regprocedure;
  if current_user = v_budget_owner
     and new.metadata->>'action_required' = 'budget-archive-live-erp'
     and new.body = 'ERPNext may still be enforcing a budget for this project after this archive. Cancel the listed ERPNext Budget documents, or activate a new PMO budget.' then
    new.message_key := 'budgetArchiveWarning'; new.message_params := '{}'::jsonb;
  elsif current_user = 'service_role'
     and new.message_key in ('unassignedInvoice', 'budgetCancellationHeld', 'budgetRetryAuthorization', 'budgetPushFailed')
     and jsonb_typeof(new.message_params) = 'object' then
    null;
  elsif current_user = v_leave_owner
     and new.message_key in ('leaveApproved', 'leaveRejected')
     and jsonb_typeof(new.message_params) = 'object' then
    null;
  else
    new.message_key := 'literal'; new.message_params := jsonb_build_object('body', new.body);
  end if;
  return new;
end; $$;
