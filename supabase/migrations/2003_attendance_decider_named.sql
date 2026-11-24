-- 2003_attendance_decider_named.sql — walk 24 Nov: the report's hours by person said which figure stands and why, but not who decided
-- it (FR-PAY-004 "record who decided"; the decider was stored, never read back). attendance_report_day_hours is restated from 1932
-- (the latest) with ONE addition: the second record carries decided_by_name, the decider's name read inside the caller's organisation.
-- The same roles read it as before; no new reader.
-- drops: the second record's object literal gains a key (its closing line changes); nothing else changes.
-- Proven by supabase/tests/1932_second_record_not_own_day.test.sql (decider named).
-- Rollback: supabase/migrations/rollback/2003_attendance_decider_named_down.sql.

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
                        'standing', s.standing, 'decided_at', s.decided_at, 'decision_reason', s.decision_reason,
                        'decided_by_name', (select p.full_name from public.profiles p where p.id = s.decided_by and p.org_id = v_org)) end,
               'undecided', public.attendance_day_undecided(w.id, v_wo, v_date),
               'mine', auth.uid() = any (coalesce(a.recorded_by_ids, '{}') || coalesce(s.recorded_by_ids, '{}')),
               'own', coalesce(w.profile_id = auth.uid(), false))
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
