-- Reverse of 1932: the 1701 bodies.
create or replace function public.attendance_second_record(p_work_order_id uuid, p_work_date date, p_rows jsonb)
  returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_backdate int;
  v_today date;
  v_week date;
  v_profile uuid;
  v_day public.attendance_days;
  v_cur public.attendance_second_records;
  v_status text; v_hours numeric; v_ot numeric;
  v_n int := 0;
  r record;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.attendance_second_record_may_enter() then
    raise exception 'ATT_SECOND_ROLE: your role does not enter second records' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'ATT_ROWS: name between 1 and 200 people' using errcode = '22023';
  end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;
  select o.attendance_backdate_days into v_backdate from public.organizations o where o.id = v_org;
  v_today := public.equipment_org_today(v_org);
  if p_work_date is null or p_work_date > v_today then
    raise exception 'ATT_DATE_FUTURE: attendance cannot be recorded for a future date' using errcode = '23514';
  end if;
  if p_work_date < v_today - v_backdate then
    raise exception 'ATT_DATE_WINDOW: the earliest date open for attendance is %', to_char(v_today - v_backdate, 'YYYY-MM-DD')
      using errcode = '23514';
  end if;
  v_week := date_trunc('week', p_work_date::timestamp)::date;

  for r in select * from jsonb_to_recordset(p_rows)
             as x(worker_id uuid, status text, hours numeric, overtime_hours numeric, note text) loop
    -- The person must be in a crew rostered on this work order that day (the crew they are in that day, host crew on loan).
    select w.profile_id into v_profile
      from public.people w
      join public.work_order_crews ro on ro.work_order_id = p_work_order_id
                                     and ro.crew_id = public.worker_effective_crew(w.id, p_work_date)
     where w.id = r.worker_id and w.org_id = v_org
       and p_work_date between ro.valid_from and coalesce(ro.valid_to, 'infinity'::date);
    if not found then
      raise exception 'ATT_NOT_ROSTERED: this person is not in a crew rostered on this work order that day' using errcode = '23514';
    end if;
    v_status := r.status;
    if v_status is null or v_status not in ('present', 'absent') then
      raise exception 'ATT_STATUS: unknown attendance status' using errcode = '22023';
    end if;
    if v_status = 'present' then
      if r.hours is null or r.hours not between 0 and 24 or coalesce(r.overtime_hours, 0) not between 0 and 24 then
        raise exception 'ATT_HOURS: a present person needs hours' using errcode = '22023';
      end if;
      v_hours := r.hours; v_ot := r.overtime_hours;
    else
      v_hours := null; v_ot := null;
    end if;

    perform pg_advisory_xact_lock(hashtextextended('att-week:' || r.worker_id::text || ':' || v_week::text, 0));
    -- Same fence as the attendance itself: a submitted or approved week changes only through the correction path.
    if exists (select 1 from public.attendance_days a
                where a.worker_id = r.worker_id and a.work_date between v_week and v_week + 6
                  and (a.submitted_at is not null or a.locked_at is not null))
       or (v_profile is not null and exists (
            select 1 from public.timesheets t where t.user_id = v_profile and t.org_id = v_org
              and t.week_start_date = v_week and t.status <> 'Draft')) then
      raise exception 'ATT_SUBMITTED: this week is submitted; return it through the timesheet correction path to change it'
        using errcode = '55000';
    end if;
    -- Nobody gives a second opinion on a day they recorded themselves.
    select * into v_day from public.attendance_days a
     where a.worker_id = r.worker_id and a.work_order_id = p_work_order_id and a.work_date = p_work_date;
    if v_day.id is not null and v_uid = any (v_day.recorded_by_ids) then
      raise exception 'ATT_SECOND_SAME_PERSON: you recorded this day; a second record comes from someone else' using errcode = '42501';
    end if;
    select * into v_cur from public.attendance_second_records s
     where s.worker_id = r.worker_id and s.work_order_id = p_work_order_id and s.work_date = p_work_date for update;
    if v_cur.id is null then
      insert into public.attendance_second_records (org_id, worker_id, work_order_id, work_date, status, hours, overtime_hours, note, recorded_by_ids)
      values (v_org, r.worker_id, p_work_order_id, p_work_date, v_status, v_hours, v_ot, nullif(btrim(r.note), ''), array[v_uid]);
    else
      if v_cur.decided_at is not null then
        raise exception 'ATT_DECIDED: this day is already decided' using errcode = '55000';
      end if;
      update public.attendance_second_records
         set status = v_status, hours = v_hours, overtime_hours = v_ot, note = nullif(btrim(r.note), ''), recorded_at = now(),
             recorded_by_ids = case when v_uid = any (recorded_by_ids) then recorded_by_ids else recorded_by_ids || v_uid end
       where id = v_cur.id;
    end if;
    v_n := v_n + 1;
    v_cur := null; v_day := null;
  end loop;
  perform public.log_audit('attendance.second_record', v_org, v_uid, p_work_order_id,
            jsonb_build_object('work_date', p_work_date, 'rows', p_rows));
  return v_n;
end $$;
revoke all on function public.attendance_second_record(uuid, date, jsonb) from public, anon;
grant execute on function public.attendance_second_record(uuid, date, jsonb) to authenticated;

create or replace function public.attendance_second_record_decide(p_worker_id uuid, p_work_order_id uuid, p_work_date date,
                                                       p_stand text, p_reason text)
  returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_day public.attendance_days;
  v_sec public.attendance_second_records;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_stand is null or p_stand not in ('day', 'second') then
    raise exception 'ATT_DECIDE_STAND: choose the site report figure or the second record' using errcode = '22023';
  end if;
  select * into v_sec from public.attendance_second_records s
   where s.worker_id = p_worker_id and s.work_order_id = p_work_order_id and s.work_date = p_work_date and s.org_id = v_org for update;
  if v_sec.id is null then
    raise exception 'second record not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('att-week:' || p_worker_id::text || ':' ||
            date_trunc('week', p_work_date::timestamp)::date::text, 0));
  select * into v_day from public.attendance_days a
   where a.worker_id = p_worker_id and a.work_order_id = p_work_order_id and a.work_date = p_work_date for update;
  -- SECURITY (SoD) FIRST: whoever recorded the day or the second record never decides between them, whatever their role.
  if v_uid = any (v_sec.recorded_by_ids) or (v_day.id is not null and v_uid = any (v_day.recorded_by_ids)) then
    raise exception 'ATT_DECIDE_SAME_PERSON: you recorded one of these figures; someone else decides' using errcode = '42501';
  end if;
  if not public.attendance_second_record_may_decide() then
    raise exception 'ATT_DECIDER_ROLE: your role does not decide which hours stand' using errcode = '42501';
  end if;
  if v_sec.decided_at is not null then
    raise exception 'ATT_DECIDED: this day is already decided' using errcode = '55000';
  end if;
  if v_day.id is null then
    raise exception 'ATT_NO_DAY: the site report figure for this day is not recorded yet' using errcode = '23514';
  end if;
  if v_day.locked_at is not null or v_day.submitted_at is not null or exists (
       select 1 from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
        where e.id = v_day.timesheet_entry_id and t.status <> 'Draft') then
    raise exception 'ATT_SUBMITTED: this week is submitted; return it through the timesheet correction path to change it'
      using errcode = '55000';
  end if;
  if not public.attendance_day_undecided(p_worker_id, p_work_order_id, p_work_date) then
    raise exception 'ATT_NOT_DISAGREEING: the two records agree, nothing to decide' using errcode = '23514';
  end if;
  if v_reason is null then
    raise exception 'ATT_DECIDE_REASON: say why this figure stands' using errcode = '22023';
  end if;

  -- The decision marker tells the reopen trigger (1702) this change of the day's figure is the decision itself.
  perform set_config('pmo.pay_time_decide', 'on', true);
  update public.attendance_days a
     set status = case when p_stand = 'second' then v_sec.status else a.status end,
         hours = case when p_stand = 'second' then v_sec.hours else a.hours end,
         overtime_hours = case when p_stand = 'second' then v_sec.overtime_hours else a.overtime_hours end,
         -- The decider wrote the standing figure, and when the second record stands its author(s) wrote it too: all of them join the
         -- day's recorders, so the approval separation (attendance_decide_week, the timesheet trigger) refuses each of them.
         recorded_by_ids = (select array_agg(distinct x) from unnest(a.recorded_by_ids || v_uid
                              || case when p_stand = 'second' then v_sec.recorded_by_ids else '{}'::uuid[] end) x)
   where a.id = v_day.id;
  perform set_config('pmo.pay_time_decide', 'off', true);
  update public.attendance_second_records
     set standing = p_stand, decided_by = v_uid, decided_at = now(), decision_reason = v_reason
   where id = v_sec.id;
  perform public.log_audit('attendance.second_record_decide', v_org, v_uid, p_work_order_id,
            jsonb_build_object('worker_id', p_worker_id, 'work_date', p_work_date, 'stand', p_stand, 'reason', v_reason));
end $$;
revoke all on function public.attendance_second_record_decide(uuid, uuid, date, text, text) from public, anon;
grant execute on function public.attendance_second_record_decide(uuid, uuid, date, text, text) to authenticated;

create or replace function public.attendance_report_day_hours(p_report uuid)
  returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.dsr_require_member();
  v_wo uuid; v_date date; v_detail boolean;
  v_enter boolean := public.attendance_second_record_may_enter();
  v_decide boolean := public.attendance_second_record_may_decide();
begin
  perform public.assert_not_light();
  select d.work_order_id, d.work_date into v_wo, v_date
    from public.daily_site_reports d where d.id = p_report and d.org_id = v_org;
  if v_wo is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  v_detail := v_enter or v_decide or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance');
  if not v_detail then
    return jsonb_build_object('detail', false, 'may_enter', false, 'may_decide', false, 'workers', '[]'::jsonb);
  end if;
  return jsonb_build_object('detail', true, 'may_enter', v_enter, 'may_decide', v_decide, 'work_order_id', v_wo, 'work_date', v_date,
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'worker_id', w.id, 'name', w.name,
               'day', case when a.id is null then null else jsonb_build_object(
                        'status', a.status, 'hours', a.hours, 'overtime_hours', a.overtime_hours, 'source', a.source) end,
               'second', case when s.id is null then null else jsonb_build_object(
                        'status', s.status, 'hours', s.hours, 'overtime_hours', s.overtime_hours, 'note', s.note,
                        'standing', s.standing, 'decided_at', s.decided_at, 'decision_reason', s.decision_reason) end,
               'undecided', public.attendance_day_undecided(w.id, v_wo, v_date),
               'mine', auth.uid() = any (coalesce(a.recorded_by_ids, '{}') || coalesce(s.recorded_by_ids, '{}')))
             order by w.name, w.id)
        from public.people w
        left join public.attendance_days a on a.worker_id = w.id and a.work_order_id = v_wo and a.work_date = v_date and a.org_id = v_org
        left join public.attendance_second_records s on s.worker_id = w.id and s.work_order_id = v_wo and s.work_date = v_date and s.org_id = v_org
       where w.org_id = v_org
         and (a.id is not null or s.id is not null
              or w.id in (select m.worker_id from public.crew_members m
                            join public.work_order_crews ro on ro.crew_id = m.crew_id and ro.work_order_id = v_wo
                           where v_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
                             and v_date between ro.valid_from and coalesce(ro.valid_to, 'infinity'::date)))), '[]'::jsonb));
end $$;
revoke all on function public.attendance_report_day_hours(uuid) from public, anon;
grant execute on function public.attendance_report_day_hours(uuid) to authenticated;
