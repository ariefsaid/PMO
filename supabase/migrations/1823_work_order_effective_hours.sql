-- 1823_work_order_effective_hours.sql — issue-closing-measure (FR-ICM-010..012): effective working hours of a work order per day.
-- worked = the validated daily site report's site day (total_minutes, start to end); stopped = the sum of its idle periods
-- (dsr_idle_periods, captured today); effective = worked minus stopped, never below 0. Nothing new is captured.
-- Eligible reports: validated, not superseded, not archived (the same rule as work_order_idle_cost, 1256).
-- SECURITY INVOKER: the caller's own row security on daily_site_reports / dsr_idle_periods decides what is returned, so another
-- organisation's work order returns nothing. Read-only, stores nothing, not a money path.
-- Proven by supabase/tests/1823_effective_hours.test.sql. Reverse: rollback/1823_work_order_effective_hours_down.sql.
create function public.get_work_order_effective_hours(p_work_order uuid, p_from date, p_to date)
returns table (work_date date, worked_minutes integer, stopped_minutes integer, effective_minutes integer, has_times boolean)
language plpgsql stable security invoker set search_path = public, pg_temp
as $$
begin
  if p_work_order is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'EFFH_RANGE: choose a work order and a valid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 365 then
    raise exception 'EFFH_RANGE_TOO_LONG: choose a range of at most 366 days' using errcode = '22023';
  end if;
  return query
  select d.work_date,
         d.total_minutes,
         coalesce(sum(ip.minutes), 0)::integer,
         case when d.total_minutes is null then null
              else greatest(d.total_minutes - coalesce(sum(ip.minutes), 0), 0)::integer end,
         d.total_minutes is not null
    from public.daily_site_reports d
    left join public.dsr_idle_periods ip on ip.report_id = d.id
   where d.work_order_id = p_work_order
     and d.work_date between p_from and p_to
     and d.status = 'validated' and d.superseded_at is null and d.archived_at is null
   group by d.id, d.work_date, d.total_minutes
   order by d.work_date;
end $$;
revoke all on function public.get_work_order_effective_hours(uuid, date, date) from public, anon;
grant execute on function public.get_work_order_effective_hours(uuid, date, date) to authenticated, service_role;
