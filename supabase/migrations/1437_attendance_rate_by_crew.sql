-- 1437_attendance_rate_by_crew.sql — #2706: attendance rate per crew and period, against the organisation's target.
-- Spec: docs/specs/attendance-rate.spec.md (FR-ATR-004..012). Plan: docs/plans/2026-11-21-attendance-rate.md.
-- Reverse: supabase/migrations/rollback/1437_attendance_rate_by_crew_down.sql.
--
-- One read over data that already exists (crews, placements, roster, attendance_days). It adds no row and no write
-- path; the only setting is 1436's organisations.attendance_target_rate.
--
-- The rate's meaning, fixed here so every reader agrees:
--   expected    distinct (person, date) of people placed in the crew that date while the crew was rostered on at least
--               one work order that date. The newest placement covering the date wins, exactly as work_order_roster
--               reads it, and a person counts once even when the crew serves two work orders that day.
--   present     member-days whose attendance for that date says present (present on any of the day's work orders).
--   absent      member-days whose record says absent (and none says present).
--   leave / off_rotation
--               excused: member-days with that record and neither present nor absent; removed from the denominator.
--   no record   expected - present - absent - leave - off_rotation, floored at 0: nobody recorded the day.
--   rate        present * 100 / (expected - leave - off_rotation), two decimals; empty when the denominator is 0.
--
-- The timezone: dates are plain calendar dates, as recorded. The caller's period is the period it asked for.

create or replace function public.attendance_rate_by_crew(p_from date, p_to date)
returns table (
  crew_id           uuid,
  crew_code         text,
  crew_name         text,
  expected_days     integer,
  present_days      integer,
  absent_days       integer,
  leave_days        integer,
  off_rotation_days integer,
  no_record_days    integer,
  countable_days    integer,
  rate              numeric,
  target_rate       numeric,
  meets_target      boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_org uuid := public.auth_org_id();
  v_target numeric;
begin
  -- FR-ATR-010: the roles that read the whole organisation's attendance (attendance_days_select, 1036). A crew-level
  -- reader would see a rate built from rows they cannot read, so they are refused rather than handed a partial figure.
  if auth.uid() is null or v_org is null or not public.is_active_member()
     or public.auth_role()::text not in ('Admin', 'Executive', 'Project Manager', 'Finance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- FR-ATR-009 / NFR-ATR-002: inclusive, ordered and bounded.
  if p_from is null or p_to is null then
    raise exception 'ATT_RATE_RANGE: choose a start and an end date' using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'ATT_RATE_RANGE: the end date is before the start date' using errcode = '22023';
  end if;
  if p_to - p_from > 365 then
    raise exception 'ATT_RATE_RANGE: a period holds at most 366 days' using errcode = '22023';
  end if;

  select o.attendance_target_rate into v_target from public.organizations o where o.id = v_org;

  return query
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ), expected as (
    select distinct c.id as crew_id, d.d as day, m.worker_id
      from public.crews c
      join public.work_order_crews r
        on r.crew_id = c.id and r.org_id = v_org
      join days d
        on d.d between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
      join public.crew_members m
        on m.crew_id = c.id and m.org_id = v_org
       and d.d between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
       and not exists (select 1 from public.crew_members n
                        where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                          and d.d between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
     where c.org_id = v_org
  ), member_day as (
    -- One status per (crew, person, day): presence on any of that day's work orders counts as attended.
    select e.crew_id, e.worker_id, e.day,
           case
             when bool_or(a.status = 'present') then 'present'
             when bool_or(a.status = 'absent') then 'absent'
             when bool_or(a.status = 'leave') then 'leave'
             when bool_or(a.status = 'off_rotation') then 'off_rotation'
             else 'none'
           end as status
      from expected e
      left join public.attendance_days a
        on a.org_id = v_org
       and a.worker_id = e.worker_id
       and a.work_date = e.day
     group by e.crew_id, e.worker_id, e.day
  ), counted as (
    select crew_id,
           count(*)::integer as expected_days,
           count(*) filter (where status = 'present')::integer as present_days,
           count(*) filter (where status = 'absent')::integer as absent_days,
           count(*) filter (where status = 'leave')::integer as leave_days,
           count(*) filter (where status = 'off_rotation')::integer as off_rotation_days
      from member_day
     group by crew_id
  ), totals as (
    select crew_id, expected_days, present_days, absent_days, leave_days, off_rotation_days,
           greatest(expected_days - leave_days - off_rotation_days, 0) as countable_days,
           greatest(expected_days - present_days - absent_days - leave_days - off_rotation_days, 0) as no_record_days
      from counted
  ), in_scope as (
    -- A live crew always appears; an archived crew only when the period holds something of its own (FR-ATR-011).
    select c.id, c.code, c.name
      from public.crews c
     where c.org_id = v_org and c.archived_at is null
    union
    select c.id, c.code, c.name
      from public.crews c
      join totals t on t.crew_id = c.id
     where c.org_id = v_org
    union
    select c.id, c.code, c.name
      from public.crews c
      join public.attendance_days a on a.crew_id = c.id
     where c.org_id = v_org and a.org_id = v_org and a.work_date between p_from and p_to
  )
  select s.id, s.code, s.name,
         coalesce(t.expected_days, 0),
         coalesce(t.present_days, 0),
         coalesce(t.absent_days, 0),
         coalesce(t.leave_days, 0),
         coalesce(t.off_rotation_days, 0),
         coalesce(t.no_record_days, 0),
         coalesce(t.countable_days, 0),
         case when coalesce(t.countable_days, 0) > 0
              then round(coalesce(t.present_days, 0) * 100.0 / t.countable_days, 2) end,
         v_target,
         case when v_target is null or coalesce(t.countable_days, 0) = 0 then null
              else round(coalesce(t.present_days, 0) * 100.0 / t.countable_days, 2) >= v_target end
    from in_scope s
    left join totals t on t.crew_id = s.id
   order by s.code, s.name, s.id;
end $$;

revoke all on function public.attendance_rate_by_crew(date, date) from public, anon;
grant execute on function public.attendance_rate_by_crew(date, date) to authenticated;
