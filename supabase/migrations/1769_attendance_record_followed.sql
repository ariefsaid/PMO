-- 1769_attendance_record_followed.sql -- a person can be recorded on the day as having followed another crew (no loan).
-- Restated whole from the database at head (1465): attendance_record (per-row optional followed_crew_id, ATT_FOLLOW_* checks,
-- the followed_crew_id column), phone_check_in (the person may pick any crew rostered on the work order today; a pick outside
-- their own crew is a request to follow), phone_check_in_decide (approval records the picked crew). Authority is unchanged:
-- attendance_can_record(resolved crew) for a foreman's tick; the supervisor's decision for a phone request.
-- drops: nothing removed in effect; the recordset column list and the worker_effective_crew join line are rewritten to add followed_crew_id, the phone approval query gains a crew bind, and the decide call line gains the followed crew.
-- Spec docs/specs/crew-followed.spec.md. Rollback supabase/migrations/rollback/1769_attendance_record_followed_down.sql
CREATE OR REPLACE FUNCTION public.attendance_record(p_work_order_id uuid, p_work_date date, p_source text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_backdate int;
  v_tolerance numeric;
  v_earliest date;
  v_today date;
  r record;
  v_crew uuid;
  v_follow uuid;
  v_eff uuid;
  v_fol uuid;
  v_profile uuid;
  v_status text;
  v_hours numeric;
  v_ot numeric;
  v_reason text;
  v_cur public.attendance_days;
  v_tick numeric;
  v_phone numeric;
  v_n int := 0;
  v_ok boolean;
  v_has_area boolean;
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
  select exists (select 1 from public.work_orders w
                  where w.id = p_work_order_id and w.org_id = v_org and w.area_lat is not null) into v_has_area;
  -- A check-in on a work order with an area goes through the phone check-in: phone_check_in and phone_check_in_decide
  -- mark the transaction that produced the check-in row, and attendance_record accepts that source only inside it (1465).
  if p_source = 'phone_check_in' and v_has_area
     and coalesce(current_setting('pmo.phone_check_in', true), '') = '' then
    raise exception 'PCI_PATH: clock-in on a work order with an area goes through the phone check-in'
      using errcode = '42501';
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
             as x(worker_id uuid, status text, hours numeric, overtime_hours numeric, reason text, followed_crew_id uuid) loop
    -- OD-CRW-3: the person must be in a crew rostered on this work order that day.
    -- #2704: the crew is the worker's effective crew that day (the host crew while on loan; else the placement).
    v_follow := null;
    if r.followed_crew_id is not null then
      -- 1769: the person followed another crew for the day, with no loan arranged. Recorded by the receiving crew's
      -- recorder (attendance_can_record below, on the followed crew).
      -- A phone check-in may name a followed crew only when a supervisor approves the person's request (phone_check_in_decide
      -- marks the transaction); a person never records their own follow.
      if p_source = 'phone_check_in' and (coalesce(current_setting('pmo.phone_check_in', true), '') = ''
         or exists (select 1 from public.people w where w.id = r.worker_id and w.profile_id = v_uid)) then
        raise exception 'ATT_FOLLOW_SOURCE: a phone check-in names a followed crew only when a supervisor approves it' using errcode = '23514';
      end if;
      if not exists (select 1 from public.people w where w.id = r.worker_id and w.org_id = v_org) then
        raise exception 'ATT_NOT_ROSTERED: this person is not in a crew rostered on this work order that day'
          using errcode = '23514';
      end if;
      v_eff := public.worker_effective_crew(r.worker_id, p_work_date);
      v_fol := public.worker_followed_crew(r.worker_id, p_work_date);
      if v_eff is null then
        raise exception 'ATT_FOLLOW_UNPLACED: this person is not placed in any crew that day' using errcode = '23514';
      end if;
      if exists (select 1 from public.crew_loans l
                  where l.worker_id = r.worker_id and p_work_date between l.valid_from and l.valid_to
                    and l.host_crew_id <> r.followed_crew_id) then
        raise exception 'ATT_FOLLOW_LOAN: this person is on loan to another crew that day; change the loan instead'
          using errcode = '23514';
      end if;
      if not exists (select 1 from public.crew_loans l
                      where l.worker_id = r.worker_id and p_work_date between l.valid_from and l.valid_to
                        and l.host_crew_id = r.followed_crew_id) then
        -- no loan to that crew: this is a real follow. It must name a crew other than where the person is, unless the
        -- same follow is already recorded for the day (a repeat, or the same crew on another work order).
        if v_eff = r.followed_crew_id and v_fol is distinct from r.followed_crew_id then
          raise exception 'ATT_FOLLOW_CREW: this person is already in that crew that day' using errcode = '23514';
        end if;
        if v_fol is not null and v_fol <> r.followed_crew_id then
          raise exception 'ATT_FOLLOW_CREW: this person already followed another crew that day' using errcode = '23514';
        end if;
        if not exists (select 1 from public.work_order_crews ro
                         join public.crews c on c.id = ro.crew_id and c.org_id = v_org and c.archived_at is null
                        where ro.work_order_id = p_work_order_id and ro.crew_id = r.followed_crew_id
                          and p_work_date between ro.valid_from and coalesce(ro.valid_to, 'infinity'::date)) then
          raise exception 'ATT_FOLLOW_CREW: that crew is not rostered on this work order that day' using errcode = '23514';
        end if;
        v_follow := r.followed_crew_id;
      end if;
    end if;
    select ro.crew_id, w.profile_id into v_crew, v_profile
      from public.people w
      join public.work_order_crews ro on ro.work_order_id = p_work_order_id
                                     and ro.crew_id = coalesce(v_follow, public.worker_effective_crew(w.id, p_work_date))
     where w.id = r.worker_id and w.org_id = v_org
       and p_work_date between ro.valid_from and coalesce(ro.valid_to, 'infinity'::date);
    if v_crew is null then
      raise exception 'ATT_NOT_ROSTERED: this person is not in a crew rostered on this work order that day'
        using errcode = '23514';
    end if;
    -- Authority: a phone check-in is the person's own; the other methods are the crew's recorder's.
    if p_source = 'phone_check_in' then
      -- On a work order with an area the worker's own check-in records today only: the phone check-in never back-dates (1465).
      if v_has_area and v_profile = v_uid and p_work_date <> v_today then
        raise exception 'PCI_TODAY: a phone check-in records today only' using errcode = '42501';
      end if;
      if v_profile is distinct from v_uid then
        -- #2705 allowance, carried here because 1248 re-creates attendance_record after 1212: a supervisor approving an
        -- off-area phone check-in may record it. Without public.phone_check_ins another person's check-in is refused.
        if to_regclass('public.phone_check_ins') is null then
          raise exception 'not authorized' using errcode = '42501';
        end if;
        execute 'select exists (select 1 from public.phone_check_ins q where q.status = ''approving'' and q.decided_by = $1 and q.worker_id = $2 and q.work_order_id = $3 and q.work_date = $4 and q.org_id = $5 and ($6::uuid is null or q.crew_id = $6))'
          into v_ok using v_uid, r.worker_id, p_work_order_id, p_work_date, v_org, v_follow;
        if not v_ok then
          raise exception 'not authorized' using errcode = '42501';
        end if;
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
      insert into public.attendance_days (org_id, worker_id, work_order_id, project_id, crew_id, followed_crew_id, work_date, status,
                                          hours, overtime_hours, reason, source, tick_hours, phone_hours,
                                          recorded_by, recorded_by_ids)
      values (v_org, r.worker_id, p_work_order_id, (select project_id from public.work_orders where id = p_work_order_id),
              v_crew, v_follow, p_work_date, v_status, v_hours, v_ot, v_reason, p_source,
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
               crew_id = v_crew, followed_crew_id = coalesce(v_follow, followed_crew_id), tick_hours = v_tick, phone_hours = v_phone,
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
end $function$;

CREATE OR REPLACE FUNCTION public.phone_check_in(p_work_order_id uuid, p_crew_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision, p_hours numeric DEFAULT 8, p_no_position boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_wo public.work_orders;
  v_today date;
  v_worker uuid;
  v_rostered boolean;
  v_follow boolean := false;
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
    -- 1769: not the person's own crew. They may pick any live crew rostered on this work order today: that is a request
    -- to follow it (never recorded without a supervisor's approval, which records the picked crew).
    if not exists (select 1 from public.work_order_crews ro join public.crews c on c.id = ro.crew_id
                    where ro.work_order_id = p_work_order_id and ro.crew_id = p_crew_id and c.org_id = v_org and c.archived_at is null
                      and v_today between ro.valid_from and coalesce(ro.valid_to, 'infinity'::date)) then
      raise exception 'PCI_CREW: you are not in that crew today' using errcode = '23514';
    end if;
    v_follow := true;
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
    if v_follow then
      raise exception 'PCI_FOLLOW_NO_AREA: this work order has no check-in area; ask the foreman of that crew to record you' using errcode = '23514';
    end if;
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
    -- The attendance record names this check-in row: attendance_record accepts the phone_check_in source for a work
    -- order with an area only inside the transaction that produced it (1465).
    perform set_config('pmo.phone_check_in', v_id::text, true);
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
end $function$;

CREATE OR REPLACE FUNCTION public.phone_check_in_decide(p_request_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    perform set_config('pmo.phone_check_in', v_row.id::text, true);
    perform public.attendance_record(v_row.work_order_id, v_row.work_date, 'phone_check_in',
      jsonb_build_array(jsonb_build_object('worker_id', v_row.worker_id, 'status', 'present', 'hours', v_row.hours)
        -- 1769: a picked crew other than where the person is that day is recorded as the followed crew
        || case when v_row.crew_id is not null
                 and public.worker_effective_crew(v_row.worker_id, v_row.work_date) is distinct from v_row.crew_id
                then jsonb_build_object('followed_crew_id', v_row.crew_id) else '{}'::jsonb end));
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
end $function$;
