-- 1213 (#2705): the supervisor's decision on an off-area / off-roster / no-position check-in. Approval logic, so it is database-enforced:
--   the decider must be eligible (the organisation's configured built-in role holder; with no role configured, the chosen crew's
--   field controller or anyone who may manage crews), is never the requester, belongs to the same organisation, is not a light
--   account, and decides a pending request once. Approve records attendance through attendance_record (source phone_check_in);
--   reject needs a reason and records no attendance.
-- Rollback: supabase/migrations/rollback/1213_phone_clock_in_decide_down.sql

create function public.phone_check_in_may_decide(p_request_id uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select public.is_active_member() and q.org_id = public.auth_org_id() and q.requester_id is distinct from auth.uid()
     and case when (select o.phone_check_in_supervisor_role from public.organizations o where o.id = public.auth_org_id()) is null
              then public.crew_can_manage()
                   or (q.crew_id is not null and exists (select 1 from public.crews c
                                                          where c.id = q.crew_id and c.field_controller_id = auth.uid()))
              else exists (select 1 from public.profiles p
                            where p.id = auth.uid() and p.status = 'active'
                              and p.built_in_role = (select o.phone_check_in_supervisor_role from public.organizations o
                                                      where o.id = public.auth_org_id()))
         end
    from public.phone_check_ins q where q.id = p_request_id
$$;
revoke all on function public.phone_check_in_may_decide(uuid) from public, anon, authenticated;

create function public.phone_check_in_decide(p_request_id uuid, p_approve boolean, p_reason text default null)
  returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_row public.phone_check_ins;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform public.assert_is_active_member();
  perform public.assert_not_light();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'PCI_DECISION: approve or reject' using errcode = '22023';
  end if;
  select * into v_row from public.phone_check_ins q where q.id = p_request_id and q.org_id = v_org for update;
  if v_row.id is null then
    raise exception 'check-in request not found' using errcode = 'P0002';   -- another org's id reads as absent
  end if;
  if v_row.requester_id = v_uid then
    raise exception 'PCI_SELF: you cannot decide your own check-in' using errcode = '42501';
  end if;
  if not public.phone_check_in_may_decide(v_row.id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'PCI_DECIDED: this check-in request was already decided' using errcode = '55000';
  end if;

  if p_approve then
    update public.phone_check_ins set status = 'approving', decided_by = v_uid, decided_at = now(), decision_reason = v_reason
     where id = v_row.id;
    perform public.attendance_record(v_row.work_order_id, v_row.work_date, 'phone_check_in',
      jsonb_build_array(jsonb_build_object('worker_id', v_row.worker_id, 'status', 'present', 'hours', v_row.hours)));
    update public.phone_check_ins q set status = 'approved',
           attendance_day_id = (select a.id from public.attendance_days a
                                 where a.worker_id = v_row.worker_id and a.work_order_id = v_row.work_order_id and a.work_date = v_row.work_date)
     where q.id = v_row.id;
  else
    if v_reason is null then
      raise exception 'PCI_REASON: give a reason for rejecting' using errcode = '22023';
    end if;
    update public.phone_check_ins set status = 'rejected', decided_by = v_uid, decided_at = now(), decision_reason = v_reason
     where id = v_row.id;
  end if;
  perform public.log_audit('phone_check_in.' || case when p_approve then 'approved' else 'rejected' end, v_org, v_uid, v_row.id,
            jsonb_build_object('work_order_id', v_row.work_order_id, 'worker_id', v_row.worker_id));
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'id', v_row.id);
end $$;

create function public.phone_check_in_requests()
  returns table (id uuid, work_order_id uuid, work_order_title text, worker_name text, crew_id uuid, crew_name text, work_date date,
                 hours numeric, outcome text, distance_m numeric, accuracy_m double precision, checked_in_at timestamptz)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  perform public.assert_not_light();
  return query
    select q.id, q.work_order_id, w.title, pe.name, q.crew_id, c.name, q.work_date, q.hours, q.outcome, q.distance_m, q.accuracy_m, q.checked_in_at
      from public.phone_check_ins q
      join public.work_orders w on w.id = q.work_order_id
      join public.people pe on pe.id = q.worker_id
      left join public.crews c on c.id = q.crew_id
     where q.org_id = public.auth_org_id() and q.status = 'pending' and public.phone_check_in_may_decide(q.id)
     order by q.checked_in_at, q.id
     limit 200;
end $$;

revoke all on function public.phone_check_in_decide(uuid, boolean, text), public.phone_check_in_requests() from public, anon;
grant execute on function public.phone_check_in_decide(uuid, boolean, text), public.phone_check_in_requests() to authenticated;
