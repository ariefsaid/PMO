-- 1212 (#2705): the phone check-in. ONE security-definer RPC reads the work-order area, computes the distance in SQL (haversine, no
-- PostGIS) from the position it received, and decides; the client never sends an "inside" flag.
-- Rollback: supabase/migrations/rollback/1212_phone_clock_in_rpc_down.sql (restores attendance_record from 1110).
-- Light accounts (#2710) call this RPC: it deliberately does NOT call assert_not_light().
--   inside + rostered .... attendance via attendance_record (source phone_check_in) + a `recorded` position row
--   outside / not rostered / no position ... a `pending` request for the supervisor (1213); no attendance
--   no area .............. attendance via attendance_record exactly as before; no position is read or stored
--   area set, no position yet ... returns status 'needs_position' and writes nothing (the phone then reads its position once)
-- Stored lat/lng are rounded to 5 decimals (about 1 m); the distance test uses the unrounded input.

create function public.geo_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
  returns double precision language sql immutable parallel safe as $$
  select 2 * 6371008.8 * asin(least(1.0, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;
revoke all on function public.geo_distance_m(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.geo_distance_m(double precision, double precision, double precision, double precision) to authenticated;

create function public.phone_check_in(p_work_order_id uuid, p_crew_id uuid, p_lat double precision, p_lng double precision,
                                      p_accuracy double precision, p_hours numeric default 8, p_no_position boolean default false)
  returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_wo public.work_orders;
  v_today date;
  v_worker uuid;
  v_rostered boolean;
  v_dist double precision;
  v_outcome text;
  v_id uuid;
  v_existing public.phone_check_ins;
  v_row jsonb;
begin
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_wo from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org;
  if v_wo.id is null then
    raise exception 'work order not found' using errcode = 'P0002';   -- another org's id reads as absent
  end if;
  if p_hours is null or p_hours < 0 or p_hours > 24 then
    raise exception 'ATT_HOURS: hours run from 0 to 24' using errcode = '22023';
  end if;
  v_today := public.equipment_org_today(v_org);
  select pe.id into v_worker from public.people pe where pe.profile_id = v_uid and pe.org_id = v_org limit 1;
  if v_worker is null then
    raise exception 'PCI_NO_PERSON: this account is not in the workforce register' using errcode = '23514';
  end if;
  if p_crew_id is not null and not exists (
       select 1 from public.crew_members m
        where m.crew_id = p_crew_id and m.worker_id = v_worker and m.org_id = v_org
          and v_today between m.valid_from and coalesce(m.valid_to, 'infinity'::date)) then
    raise exception 'PCI_CREW: you are not in that crew today' using errcode = '23514';
  end if;
  v_rostered := exists (
    select 1 from public.crew_members m
      join public.work_order_crews ro on ro.crew_id = m.crew_id and ro.work_order_id = p_work_order_id
     where m.worker_id = v_worker and m.org_id = v_org and (p_crew_id is null or m.crew_id = p_crew_id)
       and v_today between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
       and v_today between ro.valid_from and coalesce(ro.valid_to, 'infinity'::date));
  v_row := jsonb_build_array(jsonb_build_object('worker_id', v_worker, 'status', 'present', 'hours', p_hours));

  -- No area: exactly today's path; no position is read or stored.
  if v_wo.area_lat is null then
    perform public.attendance_record(p_work_order_id, v_today, 'phone_check_in', v_row);
    return jsonb_build_object('status', 'recorded', 'outcome', 'no_area');
  end if;

  if p_no_position then
    v_outcome := 'no_position';
  else
    if p_lat is null and p_lng is null and p_accuracy is null then
      return jsonb_build_object('status', 'needs_position');
    end if;
    if p_lat is null or p_lng is null or p_accuracy is null
       or p_lat in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
       or p_lng in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
       or p_accuracy in ('NaN'::double precision, 'Infinity'::double precision)
       or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_accuracy <= 0 then
      raise exception 'PCI_POSITION: the position is missing or not valid' using errcode = '22023';
    end if;
    v_dist := public.geo_distance_m(v_wo.area_lat, v_wo.area_lng, p_lat, p_lng);   -- the unrounded input
    v_outcome := case when v_dist > v_wo.area_radius_m then 'outside'
                      when not v_rostered then 'not_rostered' else 'inside' end;
  end if;

  if v_outcome = 'inside' then
    insert into public.phone_check_ins (org_id, work_order_id, worker_id, requester_id, crew_id, work_date, hours, lat, lng,
                                        accuracy_m, distance_m, outcome, status)
    values (v_org, p_work_order_id, v_worker, v_uid, p_crew_id, v_today, p_hours, round(p_lat::numeric, 5)::double precision,
            round(p_lng::numeric, 5)::double precision, p_accuracy, round(v_dist::numeric, 1), 'inside', 'recorded')
    returning id into v_id;
    perform public.attendance_record(p_work_order_id, v_today, 'phone_check_in', v_row);
    update public.phone_check_ins q
       set attendance_day_id = (select a.id from public.attendance_days a
                                 where a.worker_id = v_worker and a.work_order_id = p_work_order_id and a.work_date = v_today)
     where q.id = v_id;
    return jsonb_build_object('status', 'recorded', 'outcome', 'inside', 'id', v_id, 'distance_m', round(v_dist::numeric, 1));
  end if;

  -- Outside, not rostered, or no position: one pending request per person, work order and day; no attendance yet.
  select * into v_existing from public.phone_check_ins q
   where q.worker_id = v_worker and q.work_order_id = p_work_order_id and q.work_date = v_today and q.status in ('pending', 'approving');
  if v_existing.id is not null then
    return jsonb_build_object('status', 'pending', 'outcome', v_existing.outcome, 'id', v_existing.id);
  end if;
  insert into public.phone_check_ins (org_id, work_order_id, worker_id, requester_id, crew_id, work_date, hours, lat, lng,
                                      accuracy_m, distance_m, outcome, status)
  values (v_org, p_work_order_id, v_worker, v_uid, p_crew_id, v_today, p_hours,
          case when v_dist is null then null else round(p_lat::numeric, 5)::double precision end,
          case when v_dist is null then null else round(p_lng::numeric, 5)::double precision end,
          case when v_dist is null then null else p_accuracy end,
          case when v_dist is null then null else round(v_dist::numeric, 1) end, v_outcome, 'pending')
  returning id into v_id;
  perform public.log_audit('phone_check_in.requested', v_org, v_uid, v_id, jsonb_build_object('outcome', v_outcome, 'work_order_id', p_work_order_id));
  return jsonb_build_object('status', 'pending', 'outcome', v_outcome, 'id', v_id,
                            'distance_m', case when v_dist is null then null else round(v_dist::numeric, 1) end);
end $$;
revoke all on function public.phone_check_in(uuid, uuid, double precision, double precision, double precision, numeric, boolean) from public, anon;
grant execute on function public.phone_check_in(uuid, uuid, double precision, double precision, double precision, numeric, boolean) to authenticated;

-- attendance_record: see the header below.
-- Source: attendance_record as defined in 1110_field_org_today.sql (latest definition). Exactly one hunk differs: the phone_check_in
-- authority test (marked #2705). Rollback restores the 1110 body verbatim.
create or replace function public.attendance_record(p_work_order_id uuid, p_work_date date, p_source text, p_rows jsonb)
  returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_backdate int;
  v_tolerance numeric;
  v_earliest date;
  v_today date;
  r record;
  v_crew uuid;
  v_profile uuid;
  v_status text;
  v_hours numeric;
  v_ot numeric;
  v_reason text;
  v_cur public.attendance_days;
  v_tick numeric;
  v_phone numeric;
  v_n int := 0;
begin
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('phone_check_in', 'roster_tick', 'manual_correction') then
    raise exception 'ATT_SOURCE: unknown attendance source' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'ATT_ROWS: name between 1 and 200 people' using errcode = '22023';
  end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then
    raise exception 'work order not found' using errcode = 'P0002';   -- SECURITY: another org's id reads as absent
  end if;
  -- AC-CRW-013 / FR-CRW-013: not in the future, not before the organisation's back-date limit.
  select o.attendance_backdate_days, o.attendance_conflict_tolerance_hours into v_backdate, v_tolerance
    from public.organizations o where o.id = v_org;
  v_today := public.equipment_org_today(v_org);
  v_earliest := v_today - v_backdate;
  if p_work_date is null or p_work_date > v_today then
    raise exception 'ATT_DATE_FUTURE: attendance cannot be recorded for a future date' using errcode = '23514';
  end if;
  if p_work_date < v_earliest then
    raise exception 'ATT_DATE_WINDOW: the earliest date open for attendance is %', to_char(v_earliest, 'YYYY-MM-DD')
      using errcode = '23514';
  end if;

  for r in select * from jsonb_to_recordset(p_rows)
             as x(worker_id uuid, status text, hours numeric, overtime_hours numeric, reason text) loop
    -- OD-CRW-3: the person must be in a crew rostered on this work order that day.
    select m.crew_id, w.profile_id into v_crew, v_profile
      from public.crew_members m
      join public.people w on w.id = m.worker_id
      join public.work_order_crews ro on ro.crew_id = m.crew_id and ro.work_order_id = p_work_order_id
     where m.worker_id = r.worker_id and w.org_id = v_org
       and p_work_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
       and not exists (select 1 from public.crew_members n   -- the newer (host-crew) placement wins the day
                        where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                          and p_work_date between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
       and p_work_date between ro.valid_from and coalesce(ro.valid_to, 'infinity'::date);
    if v_crew is null then
      raise exception 'ATT_NOT_ROSTERED: this person is not in a crew rostered on this work order that day'
        using errcode = '23514';
    end if;
    -- Authority: a phone check-in is the person's own; the other methods are the crew's recorder's.
    if p_source = 'phone_check_in' then
      -- #2705 (the ONLY change from 1110): a supervisor may record a phone check-in for another person, but only while that
      -- person's off-area request is in the transient 'approving' state set by phone_check_in_decide for this very caller.
      if v_profile is distinct from v_uid and not exists (
           select 1 from public.phone_check_ins q
            where q.status = 'approving' and q.decided_by = v_uid and q.worker_id = r.worker_id
              and q.work_order_id = p_work_order_id and q.work_date = p_work_date and q.org_id = v_org) then
        raise exception 'not authorized' using errcode = '42501';
      end if;
    elsif not public.attendance_can_record(v_crew) then
      raise exception 'not authorized' using errcode = '42501';
    end if;

    v_status := r.status;
    v_reason := nullif(btrim(r.reason), '');
    if v_status is null or v_status not in ('present', 'absent', 'leave', 'off_rotation') then
      raise exception 'ATT_STATUS: unknown attendance status' using errcode = '22023';
    end if;
    -- AC-CRW-006 / FR-CRW-010: a person off rotation is present only with a reason.
    if v_status = 'present' and v_reason is null and public.worker_off_rotation(r.worker_id, p_work_date) then
      raise exception 'ATT_OFF_ROTATION: this person is off rotation that day; give a reason to mark them present'
        using errcode = '23514';
    end if;
    if v_status = 'present' then
      if r.hours is null then
        raise exception 'ATT_HOURS: a present person needs hours' using errcode = '22023';
      end if;
      v_hours := r.hours; v_ot := r.overtime_hours;
    else
      v_hours := null; v_ot := null;
    end if;

    -- Serialize entry with week generation and approval, including first-time days.
    perform pg_advisory_xact_lock(hashtextextended('att-week:' || r.worker_id::text || ':' ||
      date_trunc('week', p_work_date::timestamp)::date::text, 0));
    select * into v_cur from public.attendance_days a
     where a.worker_id = r.worker_id and a.work_order_id = p_work_order_id and a.work_date = p_work_date
     for update;
    if v_cur.id is null then
      if exists (select 1 from public.attendance_days a
                  where a.worker_id = r.worker_id
                    and a.work_date between date_trunc('week', p_work_date::timestamp)::date
                                        and date_trunc('week', p_work_date::timestamp)::date + 6
                    and (a.submitted_at is not null or a.locked_at is not null))
         or (v_profile is not null and exists (
              select 1 from public.timesheets t where t.user_id = v_profile and t.org_id = v_org
                and t.week_start_date = date_trunc('week', p_work_date::timestamp)::date and t.status <> 'Draft')) then
        raise exception 'ATT_SUBMITTED: this week is submitted; return it through the timesheet correction path to change it'
          using errcode = '55000';
      end if;
      insert into public.attendance_days (org_id, worker_id, work_order_id, project_id, crew_id, work_date, status,
                                          hours, overtime_hours, reason, source, tick_hours, phone_hours,
                                          recorded_by, recorded_by_ids)
      values (v_org, r.worker_id, p_work_order_id, (select project_id from public.work_orders where id = p_work_order_id),
              v_crew, p_work_date, v_status, v_hours, v_ot, v_reason, p_source,
              case when p_source = 'roster_tick' then coalesce(v_hours, 0) end,
              case when p_source = 'phone_check_in' then coalesce(v_hours, 0) end,
              v_uid, array[v_uid]);
    else
      if v_cur.locked_at is not null then
        raise exception 'ATT_LOCKED: approved attendance cannot be changed; correct it through the timesheet correction path'
          using errcode = '55000';
      end if;
      -- FR-CRW-017: once the week is submitted, change goes through the correction path, never a silent edit.
      if v_cur.submitted_at is not null or exists (
           select 1 from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
            where e.id = v_cur.timesheet_entry_id and t.status <> 'Draft') then
        raise exception 'ATT_SUBMITTED: this week is submitted; return it through the timesheet correction path to change it'
          using errcode = '55000';
      end if;
      if p_source = 'manual_correction' or p_source = v_cur.source
         or (v_cur.source = 'manual_correction') then
        -- Same method again, or an office correction: the new values stand and any conflict is settled.
        v_tick := case when p_source = 'roster_tick' then coalesce(v_hours, 0) else v_cur.tick_hours end;
        v_phone := case when p_source = 'phone_check_in' then coalesce(v_hours, 0) else v_cur.phone_hours end;
        update public.attendance_days
           set status = v_status, hours = v_hours, overtime_hours = v_ot, reason = v_reason, source = p_source,
               crew_id = v_crew, tick_hours = v_tick, phone_hours = v_phone,
               needs_review = case when p_source = 'manual_correction' then false
                                   else v_tick is not null and v_phone is not null and abs(v_tick - v_phone) > v_tolerance end,
               recorded_by = v_uid, recorded_at = now(),
               recorded_by_ids = case when v_uid = any(recorded_by_ids) then recorded_by_ids else recorded_by_ids || v_uid end
         where id = v_cur.id;
      else
        -- AC-CRW-008 / OQ-CRW-2: the other method on the same day. Neither wins: keep one record, keep both hours,
        -- and flag it when they differ by more than the organisation's tolerance.
        v_tick := case when p_source = 'roster_tick' then coalesce(v_hours, 0) else v_cur.tick_hours end;
        v_phone := case when p_source = 'phone_check_in' then coalesce(v_hours, 0) else v_cur.phone_hours end;
        update public.attendance_days
           set tick_hours = v_tick, phone_hours = v_phone,
               needs_review = v_tick is not null and v_phone is not null and abs(v_tick - v_phone) > v_tolerance,
               recorded_by = v_uid, recorded_at = now(),
               recorded_by_ids = case when v_uid = any(recorded_by_ids) then recorded_by_ids else recorded_by_ids || v_uid end
         where id = v_cur.id;
      end if;
    end if;
    v_n := v_n + 1;
    v_cur := null;
  end loop;

  perform public.log_audit('attendance.record', v_org, v_uid, p_work_order_id,
            jsonb_build_object('work_date', p_work_date, 'source', p_source, 'rows', p_rows));
  return v_n;
end $$;
