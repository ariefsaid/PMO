-- 1414_safety_summary.sql — #2596 daily safety records: the monthly safety summary and its drill-down.
-- Spec: docs/specs/daily-safety-records.spec.md (FR-DSF-011..013; OD-DSF-3, NFR-DSF-003). Proven by
-- supabase/tests/safety_days.test.sql. Read-only; reads attendance, incidents and the safety days; writes nothing.
-- SECURITY DEFINER (a deliberate deviation from the plan's invoker): attendance rows are readable only by the roles
-- that manage crews, so an invoker read would give an Engineer a silently low figure. Every query filters on the
-- caller's organisation, a non-member is refused, and only counts and dates leave: no photo, no worker name.
--   worked hours  = hours + overtime over attendance rows that are present and locked/approved (locked_at set),
--                   by organisation-local date, in whole minutes
--   safe hours    = worked hours after the date of the project's last lost-time incident (all attendance since the
--                   start when none), up to the end of the month, summed over projects in scope
--   a figure with nothing to compute from is hidden with a reason, never shown as 0
-- Reversal: rollback/1414_safety_summary_down.sql.

create function public.get_safety_summary(p_project uuid default null, p_month date default null) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_tz text;
  v_from date;
  v_to date;
  v_worked bigint; v_safe bigint; v_locked_rows bigint; v_locked_rows_all bigint;
  v_lt int; v_rec int; v_nm bigint; v_talks int; v_complete int; v_nosafe int;
  v_hidden jsonb := '{}'::jsonb;
begin
  if not public.is_active_member() then
    raise exception 'not a member of an organisation' using errcode = '42501';
  end if;
  if p_project is not null and not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org) then
    raise exception 'project not in this organisation' using errcode = '42501';
  end if;
  select o.default_timezone into v_tz from public.organizations o where o.id = v_org;
  v_from := coalesce(date_trunc('month', p_month)::date, public.org_current_month(v_tz, now()));
  v_to := (v_from + interval '1 month')::date;   -- exclusive

  select coalesce(sum(round((a.hours + coalesce(a.overtime_hours, 0)) * 60)), 0)::bigint, count(*)
    into v_worked, v_locked_rows
    from public.attendance_days a join public.projects pr on pr.id = a.project_id
   where a.org_id = v_org and a.status = 'present' and a.locked_at is not null
     and a.work_date >= v_from and a.work_date < v_to and (p_project is null or a.project_id = p_project);

  select coalesce(sum(round((a.hours + coalesce(a.overtime_hours, 0)) * 60)), 0)::bigint, count(*)
    into v_safe, v_locked_rows_all
    from public.attendance_days a
   where a.org_id = v_org and a.status = 'present' and a.locked_at is not null and a.work_date < v_to
     and (p_project is null or a.project_id = p_project)
     and a.work_date > coalesce((select max(i.incident_date) from public.incident_reports i
                                  where i.org_id = v_org and i.project_id = a.project_id and i.lost_time
                                    and i.incident_date < v_to), '-infinity'::date);

  select count(*) filter (where i.lost_time),
         count(*) filter (where not i.lost_time and i.severity in ('Medium', 'High', 'Critical'))
    into v_lt, v_rec
    from public.incident_reports i
   where i.org_id = v_org and i.incident_date >= v_from and i.incident_date < v_to and (p_project is null or i.project_id = p_project);

  with cur as (
    select s.* from public.safety_days s
     where s.org_id = v_org and s.status = 'locked' and s.work_date >= v_from and s.work_date < v_to
       and (p_project is null or s.project_id = p_project)
       and not exists (select 1 from public.safety_days n where n.supersedes_id = s.id)
  )
  select coalesce((select sum(e.near_misses) from public.safety_officer_entries e join cur on cur.id = e.day_id), 0),
         (select count(*) from public.safety_toolbox_talks t join cur on cur.id = t.day_id),
         (select count(*) from cur where coalesce(cardinality(public.safety_day_missing(cur.id)), 0) = 0)
    into v_nm, v_talks, v_complete;

  select count(*) into v_nosafe from (
    select a.work_order_id, a.work_date from public.attendance_days a
     where a.org_id = v_org and a.status = 'present' and a.work_date >= v_from and a.work_date < v_to
       and (p_project is null or a.project_id = p_project)
     group by a.work_order_id, a.work_date
    having not exists (select 1 from public.safety_days s where s.work_order_id = a.work_order_id and s.work_date = a.work_date
                          and s.status = 'locked' and s.org_id = v_org)) x;

  if v_locked_rows = 0 then
    v_hidden := v_hidden || jsonb_build_object('worked_minutes', 'no locked or approved attendance in this month');
  end if;
  if v_locked_rows_all = 0 then
    v_hidden := v_hidden || jsonb_build_object('safe_minutes', 'no locked or approved attendance to count from');
  end if;

  return jsonb_build_object(
    'month', v_from, 'timezone', v_tz, 'project_id', p_project,
    'worked_minutes', case when v_locked_rows = 0 then null else v_worked end,
    'safe_minutes', case when v_locked_rows_all = 0 then null else v_safe end,
    'lost_time_incidents', v_lt, 'recordable_incidents', v_rec, 'near_misses', v_nm, 'toolbox_talks', v_talks,
    'complete_days', v_complete, 'days_without_record', v_nosafe, 'hidden', v_hidden);
end $$;

-- The rows behind one count: [{date, work_order_id, ref_id, label}], at most 500, newest first.
create function public.get_safety_summary_detail(p_kind text, p_project uuid default null, p_month date default null) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_tz text;
  v_from date;
  v_to date;
  v_rows jsonb;
begin
  if not public.is_active_member() then
    raise exception 'not a member of an organisation' using errcode = '42501';
  end if;
  if p_kind not in ('lost_time_incidents', 'recordable_incidents', 'days_without_record', 'complete_days', 'toolbox_talks', 'near_misses') then
    raise exception 'unknown count' using errcode = '22023';
  end if;
  if p_project is not null and not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org) then
    raise exception 'project not in this organisation' using errcode = '42501';
  end if;
  select o.default_timezone into v_tz from public.organizations o where o.id = v_org;
  v_from := coalesce(date_trunc('month', p_month)::date, public.org_current_month(v_tz, now()));
  v_to := (v_from + interval '1 month')::date;

  if p_kind in ('lost_time_incidents', 'recordable_incidents') then
    select coalesce(jsonb_agg(jsonb_build_object('date', i.incident_date, 'work_order_id', i.work_order_id, 'ref_id', i.id,
                                                 'label', i.severity::text) order by i.incident_date desc, i.id), '[]')
      into v_rows from (select * from public.incident_reports x
        where x.org_id = v_org and x.incident_date >= v_from and x.incident_date < v_to and (p_project is null or x.project_id = p_project)
          and ((p_kind = 'lost_time_incidents' and x.lost_time)
               or (p_kind = 'recordable_incidents' and not x.lost_time and x.severity in ('Medium', 'High', 'Critical')))
        order by x.incident_date desc, x.id limit 500) i;
  elsif p_kind = 'days_without_record' then
    select coalesce(jsonb_agg(jsonb_build_object('date', d.work_date, 'work_order_id', d.work_order_id, 'ref_id', null,
                                                 'label', d.present::text) order by d.work_date desc, d.work_order_id), '[]')
      into v_rows from (
        select a.work_order_id, a.work_date, count(*) as present from public.attendance_days a
         where a.org_id = v_org and a.status = 'present' and a.work_date >= v_from and a.work_date < v_to
           and (p_project is null or a.project_id = p_project)
         group by a.work_order_id, a.work_date
        having not exists (select 1 from public.safety_days s where s.work_order_id = a.work_order_id and s.work_date = a.work_date
                              and s.status = 'locked' and s.org_id = v_org)
         order by a.work_date desc, a.work_order_id limit 500) d;
  elsif p_kind = 'toolbox_talks' then
    select coalesce(jsonb_agg(jsonb_build_object('date', c.work_date, 'work_order_id', c.work_order_id, 'ref_id', c.id,
                                                 'label', c.topic) order by c.work_date desc, c.id), '[]')
      into v_rows from (
        select t.id, s.work_date, s.work_order_id, t.topic from public.safety_toolbox_talks t join public.safety_days s on s.id = t.day_id
         where s.org_id = v_org and s.status = 'locked' and s.work_date >= v_from and s.work_date < v_to
           and (p_project is null or s.project_id = p_project)
           and not exists (select 1 from public.safety_days n where n.supersedes_id = s.id)
         order by s.work_date desc, t.id limit 500) c;
  elsif p_kind = 'near_misses' then
    -- one row per officer entry that reported any; the labels add up to the count
    select coalesce(jsonb_agg(jsonb_build_object('date', c.work_date, 'work_order_id', c.work_order_id, 'ref_id', c.id,
                                                 'label', c.near_misses::text) order by c.work_date desc, c.id), '[]')
      into v_rows from (
        select e.id, s.work_date, s.work_order_id, e.near_misses from public.safety_officer_entries e join public.safety_days s on s.id = e.day_id
         where s.org_id = v_org and s.status = 'locked' and s.work_date >= v_from and s.work_date < v_to
           and (p_project is null or s.project_id = p_project)
           and not exists (select 1 from public.safety_days n where n.supersedes_id = s.id) and e.near_misses > 0
         order by s.work_date desc, e.id limit 500) c;
  else
    select coalesce(jsonb_agg(jsonb_build_object('date', c.work_date, 'work_order_id', c.work_order_id, 'ref_id', c.id,
                                                 'label', 'complete') order by c.work_date desc, c.id), '[]')
      into v_rows from (
        select s.id, s.work_date, s.work_order_id from public.safety_days s
         where s.org_id = v_org and s.status = 'locked' and s.work_date >= v_from and s.work_date < v_to
           and (p_project is null or s.project_id = p_project)
           and not exists (select 1 from public.safety_days n where n.supersedes_id = s.id)
           and coalesce(cardinality(public.safety_day_missing(s.id)), 0) = 0
         order by s.work_date desc, s.id limit 500) c;
  end if;
  return v_rows;
end $$;

revoke all on function public.get_safety_summary(uuid, date), public.get_safety_summary_detail(text, uuid, date) from public, anon;
grant execute on function public.get_safety_summary(uuid, date), public.get_safety_summary_detail(text, uuid, date) to authenticated;
