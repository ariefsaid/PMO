-- Restores the database-date bodies from 1036 and 1041.
create or replace function public.attendance_record(p_work_order_id uuid, p_work_date date, p_source text, p_rows jsonb)
  returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_backdate int;
  v_tolerance numeric;
  v_earliest date;
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
  v_earliest := current_date - v_backdate;
  if p_work_date is null or p_work_date > current_date then
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
      if v_profile is distinct from v_uid then
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

create or replace function public.dsr_validation_queue()
returns table (report_id uuid, project_id uuid, work_order_id uuid, work_order_label text, work_date date, author_id uuid,
               author_name text, submitted_at timestamptz, total_revenue numeric, unrated_lines integer, age_days integer,
               waiting_for_validator boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.dsr_require_member();
  return query
  select d.id, d.project_id, d.work_order_id, coalesce(w.wo_number || ' · ', '') || w.title, d.work_date, d.author_id,
         a.full_name, d.submitted_at,
         coalesce((select sum(public.dsr_line_amount(l.quantity, v.rate)) from public.dsr_progress_lines l
                   left join lateral public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date) v on true
                   where l.report_id = d.id), 0),
         (select count(*)::integer from public.dsr_progress_lines l
           where l.report_id = d.id and not exists (select 1 from public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date))),
         greatest(0, (current_date - d.work_date) - 1),
         not exists (select 1 from public.profiles pr join public.projects p on p.id = d.project_id
                      where pr.org_id = d.org_id and pr.status = 'active' and pr.id <> d.author_id
                        and (pr.role in ('Admin','Finance') or (pr.role = 'Project Manager' and p.project_manager_id = pr.id)))
    from public.daily_site_reports d
    join public.work_orders w on w.id = d.work_order_id
    left join public.profiles a on a.id = d.author_id
   where d.org_id = public.auth_org_id() and d.status = 'submitted' and d.archived_at is null
     and public.dsr_may_validate(d.project_id)
   order by d.submitted_at, d.id
   limit 500;
end $$;
