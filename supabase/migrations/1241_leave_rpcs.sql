-- 1241_leave_rpcs.sql — #2708: the only write path for leave requests, the decision with its separation of duties,
-- the visible-requests list, and the additive roster read. Spec FR-LV-002..009. Proven by leave_requests.test.sql.
--
-- ── REVERSE (also supabase/migrations/rollback/1241_leave_rpcs_down.sql) ──────────────────────────────────────
--   drop the five functions below.

create function public.leave_enabled() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select o.leave_requests_enabled from public.organizations o where o.id = public.auth_org_id()), false)
$$;
revoke all on function public.leave_enabled() from public, anon;
grant execute on function public.leave_enabled() to authenticated;

-- AC-LV-002..004. The person themselves, their line manager, or an office user (crew managers) may enter a request.
create function public.leave_request_submit(p_person_id uuid, p_type_id uuid, p_start date, p_end date, p_reason text)
  returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;
revoke all on function public.leave_request_submit(uuid, uuid, date, date, text) from public, anon;
grant execute on function public.leave_request_submit(uuid, uuid, date, date, text) to authenticated;

-- AC-LV-005..008. The decision. SECURITY: the self-decide guard (LV_SOD) holds for every role, Admin included.
create function public.leave_request_decide(p_id uuid, p_decision text, p_note text)
  returns text
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_req public.leave_requests;
  v_profile uuid;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'LV_FORBIDDEN: not an active member' using errcode = '42501';
  end if;
  if p_decision not in ('Approved', 'Rejected') then
    raise exception 'LV_DECISION: decide Approved or Rejected' using errcode = '22023';
  end if;
  select * into v_req from public.leave_requests r where r.id = p_id and r.org_id = v_org for update;
  if not found then
    raise exception 'LV_NOT_FOUND: no such request' using errcode = 'P0002';
  end if;
  select w.profile_id into v_profile from public.people w where w.id = v_req.person_id;
  if v_req.entered_by = v_uid or coalesce(v_profile = v_uid, false) then
    raise exception 'LV_SOD: you cannot decide your own request, or one you entered' using errcode = '42501';
  end if;
  if not public.leave_authority(v_req.person_id) then
    raise exception 'LV_FORBIDDEN: you cannot decide this request' using errcode = '42501';
  end if;
  if v_req.status <> 'Pending' then
    raise exception 'LV_DECIDED: this request is already %', lower(v_req.status) using errcode = '23514';
  end if;
  if p_decision = 'Rejected' and nullif(btrim(p_note), '') is null then
    raise exception 'LV_NOTE: give a reason when rejecting' using errcode = '23514';
  end if;
  update public.leave_requests set status = p_decision, decided_by = v_uid, decided_at = now(),
         decision_note = nullif(btrim(p_note), '') where id = p_id;
  perform public.log_audit('leave.' || lower(p_decision), v_org, v_uid, p_id, '{}'::jsonb);
  return p_decision;
end $$;
revoke all on function public.leave_request_decide(uuid, text, text) from public, anon;
grant execute on function public.leave_request_decide(uuid, text, text) to authenticated;

-- FR-LV-008. Pending: the person or whoever entered it, or an approver. Approved: an approver only, never for their own.
create function public.leave_request_cancel(p_id uuid)
  returns text
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_req public.leave_requests;
  v_profile uuid;
  v_own boolean;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'LV_FORBIDDEN: not an active member' using errcode = '42501';
  end if;
  select * into v_req from public.leave_requests r where r.id = p_id and r.org_id = v_org for update;
  if not found then
    raise exception 'LV_NOT_FOUND: no such request' using errcode = 'P0002';
  end if;
  select w.profile_id into v_profile from public.people w where w.id = v_req.person_id;
  v_own := v_req.entered_by = v_uid or coalesce(v_profile = v_uid, false);
  if v_req.status not in ('Pending', 'Approved') then
    raise exception 'LV_DECIDED: this request is already %', lower(v_req.status) using errcode = '23514';
  end if;
  if v_req.status = 'Pending' then
    if not (v_own or public.leave_authority(v_req.person_id)) then
      raise exception 'LV_FORBIDDEN: you cannot cancel this request' using errcode = '42501';
    end if;
  elsif v_own or not public.leave_authority(v_req.person_id) then
    raise exception 'LV_FORBIDDEN: only an approver, and not for their own leave, can cancel approved leave' using errcode = '42501';
  end if;
  update public.leave_requests set status = 'Cancelled' where id = p_id;
  perform public.log_audit('leave.cancel', v_org, v_uid, p_id, '{}'::jsonb);
  return 'Cancelled';
end $$;
revoke all on function public.leave_request_cancel(uuid) from public, anon;
grant execute on function public.leave_request_cancel(uuid) to authenticated;

-- The requests the caller may see, with names and whether they may decide each (FR-LV-011). RLS filters the rows.
create function public.leave_requests_visible()
  returns table (id uuid, person_id uuid, person_name text, leave_type_id uuid, type_name text, start_date date,
                 end_date date, days integer, reason text, status text, decided_at timestamptz, decision_note text,
                 is_mine boolean, can_decide boolean)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select r.id, r.person_id, w.name, r.leave_type_id, t.name, r.start_date, r.end_date, (r.end_date - r.start_date + 1),
         r.reason, r.status, r.decided_at, r.decision_note,
         (r.entered_by = (select auth.uid())
            or exists (select 1 from public.people me where me.id = r.person_id and me.profile_id = (select auth.uid()))),
         (r.status = 'Pending' and public.leave_authority(r.person_id)
            and r.entered_by <> (select auth.uid())
            and not exists (select 1 from public.people me where me.id = r.person_id and me.profile_id = (select auth.uid())))
    from public.leave_requests r
    join public.people_directory w on w.id = r.person_id
    join public.leave_types t on t.id = r.leave_type_id
   where public.leave_enabled()
   order by (r.status = 'Pending') desc, r.start_date desc, r.id
$$;
revoke all on function public.leave_requests_visible() from public, anon;
grant execute on function public.leave_requests_visible() to authenticated;

-- AC-LV-010. The additive roster marker: ids of people on approved leave that day. Empty while the feature is off or no
-- request exists, so the roster is unchanged. Definer so a rostering user sees the marker without seeing the request.
create function public.leave_on_date(p_date date) returns setof uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select r.person_id from public.leave_requests r
   where public.is_active_member() and public.leave_enabled() and r.org_id = public.auth_org_id()
     and r.status = 'Approved' and p_date between r.start_date and r.end_date
$$;
revoke all on function public.leave_on_date(date) from public, anon;
grant execute on function public.leave_on_date(date) to authenticated;
