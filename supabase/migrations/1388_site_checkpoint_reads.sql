-- 1388_site_checkpoint_reads.sql — #2594: the reads. Spec: FR-STC-031/032/040/041/060.
--   site_checkpoints_for_day(work order, date)       the day's checkpoints with a derived state (security invoker: RLS decides)
--   work_order_checkpoint_flag(work order, date?)    true while any checkpoint of the day is late (derived, not stored)
--   crew_start_punctuality(from, to, project?, wo?)  per crew, days the work-start checkpoint was on time (a count, never minutes)
--   site_lost_time_by_cause(from, to, project?, wo?) idle minutes by the organisation's own cause list (security definer, role gate)
-- ── REVERSE (also rollback/1388_site_checkpoint_reads_down.sql) ────────────────────────────────────────

-- State of one checkpoint at one instant. on_time and late are recorded; late and pending are unrecorded.
create function public.site_checkpoint_state(p_due_at timestamptz, p_grace smallint, p_recorded_at timestamptz, p_now timestamptz)
  returns text language sql immutable set search_path = public as $$
  select case
    when p_recorded_at is not null then case when p_recorded_at <= p_due_at + p_grace * interval '1 minute' then 'on_time' else 'late' end
    else case when p_now > p_due_at + p_grace * interval '1 minute' then 'late' else 'pending' end end
$$;
grant execute on function public.site_checkpoint_state(timestamptz, smallint, timestamptz, timestamptz) to authenticated;

create function public.site_checkpoints_for_day(p_work_order uuid, p_date date)
  returns table (id uuid, crew_id uuid, crew_name text, "position" smallint, name text, marks_work_start boolean, due_at timestamptz,
                 grace_minutes smallint, photo_required boolean, recorded_at timestamptz, recorded_by uuid, recorded_by_name text,
                 note text, photo_path text, state text)
  language sql stable security invoker set search_path = public as $$
  select c.id, c.crew_id, cr.name, c.position, c.name, c.marks_work_start, c.due_at, c.grace_minutes, c.photo_required,
         c.recorded_at, c.recorded_by, p.full_name, c.note, c.photo_path,
         public.site_checkpoint_state(c.due_at, c.grace_minutes, c.recorded_at, now())
    from public.site_checkpoints c
    join public.crews cr on cr.id = c.crew_id
    left join public.profiles p on p.id = c.recorded_by
   where c.work_order_id = p_work_order and c.work_date = p_date
   order by cr.name, c.position
$$;
grant execute on function public.site_checkpoints_for_day(uuid, date) to authenticated;

-- A work order is flagged while any of its checkpoints for the day is late, recorded late or not (FR-STC-031).
create function public.work_order_checkpoint_flag(p_work_order uuid, p_date date default null) returns boolean
  language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from public.site_checkpoints c
     where c.work_order_id = p_work_order and c.work_date = coalesce(p_date, public.site_checkpoint_today())
       and public.site_checkpoint_state(c.due_at, c.grace_minutes, c.recorded_at, now()) = 'late')
$$;
grant execute on function public.work_order_checkpoint_flag(uuid, date) to authenticated;

create function public.crew_start_punctuality(p_from date, p_to date, p_project uuid default null, p_work_order uuid default null)
  returns jsonb
  language plpgsql stable security invoker set search_path = public as $$
declare v_out jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 92 then
    raise exception 'the range is 1 to 92 days' using errcode = '22023', detail = 'range-invalid';
  end if;
  with d as (
    select c.crew_id, c.work_order_id, c.work_date, c.due_at, c.recorded_at,
           public.site_checkpoint_state(c.due_at, c.grace_minutes, c.recorded_at, now()) as st
      from public.site_checkpoints c
      join public.work_orders w on w.id = c.work_order_id
     where c.marks_work_start and c.work_date between p_from and p_to
       and (p_work_order is null or c.work_order_id = p_work_order)
       and (p_project is null or w.project_id = p_project)
  ), days as (
    -- a day still inside its grace with nothing recorded is not yet counted either way
    select d.*, case when d.st = 'pending' then null when d.st = 'late' and d.recorded_at is null then 'not_started' else d.st end as status
      from d where d.st <> 'pending'
  ), per_crew as (
    select y.crew_id, cr.name as crew_name, count(*)::int as days, count(*) filter (where y.status = 'on_time')::int as on_time,
           jsonb_agg(jsonb_build_object('work_date', y.work_date, 'work_order_id', y.work_order_id, 'due_at', y.due_at,
             'recorded_at', y.recorded_at, 'status', y.status,
             'minutes_late', case when y.recorded_at is null then null else greatest(0, floor(extract(epoch from (y.recorded_at - y.due_at)) / 60))::int end)
             order by y.work_date desc) as day_rows
      from days y join public.crews cr on cr.id = y.crew_id
     group by y.crew_id, cr.name
  ), ranked as (
    select pc.*, round(pc.on_time::numeric / pc.days, 4) as share, row_number() over (order by round(pc.on_time::numeric / pc.days, 4), pc.crew_name, pc.crew_id) as rn
      from per_crew pc
  )
  select jsonb_build_object(
           'from', p_from, 'to', p_to,
           'truncated', exists (select 1 from ranked where rn > 200),
           'crews', coalesce((select jsonb_agg(jsonb_build_object('crew_id', r.crew_id, 'crew_name', r.crew_name, 'days', r.days,
                      'on_time', r.on_time, 'share_on_time', r.share, 'day_rows', r.day_rows) order by r.rn)
                      from ranked r where r.rn <= 200), '[]'::jsonb))
    into v_out;
  return v_out;
end; $$;
grant execute on function public.crew_start_punctuality(date, date, uuid, uuid) to authenticated;

create function public.site_lost_time_by_cause(p_from date, p_to date, p_project uuid default null, p_work_order uuid default null)
  returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_role user_role := public.auth_role(); v_uid uuid := auth.uid(); v_out jsonb;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  if not public.is_active_member() or v_role is null or v_role not in ('Admin', 'Executive', 'Engineer', 'Project Manager') then
    raise exception 'lost time by cause is for Admin, Executive, Engineer and project managers' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 92 then
    raise exception 'the range is 1 to 92 days' using errcode = '22023', detail = 'range-invalid';
  end if;
  with r as (
    select d.id from public.daily_site_reports d join public.projects p on p.id = d.project_id
     where d.org_id = v_org and d.archived_at is null and d.status in ('submitted', 'validated') and d.superseded_at is null
       and d.work_date between p_from and p_to
       and (p_project is null or d.project_id = p_project) and (p_work_order is null or d.work_order_id = p_work_order)
       and (v_role in ('Admin', 'Executive', 'Engineer') or p.project_manager_id = v_uid)
  ), by_cause as (
    select ir.id as reason_id, ir.label, (ir.archived_at is not null) as archived, sum(ip.minutes)::int as minutes
      from public.dsr_idle_periods ip
      join r on r.id = ip.report_id
      join public.dsr_idle_reasons ir on ir.id = ip.reason_id and ir.org_id = v_org
     group by ir.id, ir.label, ir.archived_at
  )
  select jsonb_build_object(
           'from', p_from, 'to', p_to,
           'total_minutes', coalesce((select sum(minutes) from by_cause), 0)::int,
           'report_count', (select count(*) from r)::int,
           'rows', coalesce((select jsonb_agg(jsonb_build_object('reason_id', b.reason_id, 'label', b.label, 'archived', b.archived,
                      'minutes', b.minutes) order by b.minutes desc, b.label) from by_cause b), '[]'::jsonb))
    into v_out;
  return v_out;
end; $$;
revoke all on function public.site_lost_time_by_cause(date, date, uuid, uuid) from public, anon;
grant execute on function public.site_lost_time_by_cause(date, date, uuid, uuid) to authenticated;
