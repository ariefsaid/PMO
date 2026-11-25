-- 2670_attendance_manager_may_record.sql -- the manager on a person's record may mark that person present or absent (#2882, OD-R1125-1).
-- Restated whole from the latest definition (1769): attendance_record. Only change: the non-phone authority line also accepts the
-- manager recorded on the person (people.manager_id = the caller); the crew's recorder keeps the right.
-- drops: nothing removed; one condition widened.
-- Rollback supabase/migrations/rollback/2670_attendance_manager_may_record_down.sql
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
                    and l.host_crew_id <> r.followed_crew_id
                    and exists (select 1 from public.work_order_crews hr   -- 1630: a loan counts only on a day the host crew is on a work order
                                 where hr.crew_id = l.host_crew_id
                                   and p_work_date between hr.valid_from and coalesce(hr.valid_to, 'infinity'::date))) then
        raise exception 'ATT_FOLLOW_LOAN: this person is on loan to another crew that day; change the loan instead'
          using errcode = '23514';
      end if;
      if not exists (select 1 from public.crew_loans l
                      where l.worker_id = r.worker_id and p_work_date between l.valid_from and l.valid_to
                        and l.host_crew_id = r.followed_crew_id
                        and exists (select 1 from public.work_order_crews hr   -- 1630: a loan counts only on a day the host crew is on a work order
                                     where hr.crew_id = l.host_crew_id
                                       and p_work_date between hr.valid_from and coalesce(hr.valid_to, 'infinity'::date))) then
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
        -- A follow does not stand beside a day already recorded for the person on another work order; a crew manager may
        -- (they settle the two records).
        if not public.crew_can_manage() and exists (
             select 1 from public.attendance_days a
              where a.worker_id = r.worker_id and a.work_date = p_work_date and a.work_order_id <> p_work_order_id
                and a.status = 'present' and a.followed_crew_id is distinct from r.followed_crew_id) then
          raise exception 'ATT_FOLLOW_RECORDED: this person is already recorded present on another work order that day' using errcode = '23514';
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
    if v_crew is null and p_source = 'phone_check_in' then
      -- 1551: a crew's Foreman is rostered through the crew he leads, not as a member of it. His own phone check-in, and the
      -- supervisor's decision on it, record him against that crew (the one the check-in named; else the first he leads there).
      select ro.crew_id, w.profile_id into v_crew, v_profile
        from public.people w
        join public.crews c on c.field_controller_id = w.profile_id and c.org_id = v_org
        join public.work_order_crews ro on ro.work_order_id = p_work_order_id and ro.crew_id = c.id
       where w.id = r.worker_id and w.org_id = v_org
         and p_work_date between ro.valid_from and coalesce(ro.valid_to, 'infinity'::date)
         and (coalesce(current_setting('pmo.phone_check_in_crew', true), '') = ''
              or c.id::text = current_setting('pmo.phone_check_in_crew', true))      -- mut:foreman_crew
       order by c.id limit 1;
    end if;
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
    elsif not (public.attendance_can_record(v_crew)
               or exists (select 1 from public.people pm where pm.id = r.worker_id and pm.org_id = v_org and pm.manager_id = v_uid)) then  -- mut:manager_may_record
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
end $$;
