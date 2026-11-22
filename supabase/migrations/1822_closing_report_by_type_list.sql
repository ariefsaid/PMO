-- 1822_closing_report_by_type_list.sql — issue-closing-measure (FR-ICM-009): the closing-time report groups by the kept
-- issue-type list. Restates get_issue_closing_time_report. Source body: the LATEST migration defining it, 1424, plus the one
-- line 1480 injects at database head (`perform public.assert_not_light();` after `begin`); the orchestrator verifies against
-- pg_get_functiondef. Result columns, parameters, grants and every existing behaviour are unchanged; only the label an issue
-- is grouped under changes: the type's current list label (so a rename never splits a group), falling back to the stored text.
-- drops: the two grouping expressions (type text -> list label) and the department match (exact text -> case-insensitive label); everything else is carried.
-- Proven by supabase/tests/1822_closing_report_types.test.sql. Reverse: rollback/1822_closing_report_by_type_list_down.sql (restores 1424's body).

create or replace function public.get_issue_closing_time_report(
  p_date_from date default null,
  p_date_to date default null,
  p_grouping_mode text default null
)
returns table (
  department text,
  total_issues bigint,
  closed_issues bigint,
  open_issues bigint,
  avg_closing_hours numeric,
  median_closing_hours numeric,
  overdue_issues bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid := public.auth_org_id();
  v_mode text;
begin
  perform public.assert_not_light();
  if not (select public.is_active_member()) then
    raise exception 'not an active member of this organisation' using errcode = '42501';
  end if;

  if p_grouping_mode is not null and p_grouping_mode in ('type', 'department_groups') then
    v_mode := p_grouping_mode;
  else
    select coalesce(s.grouping_mode, 'type') into v_mode
      from public.issue_closing_report_settings s
     where s.org_id = v_org_id;
    if v_mode is null then
      v_mode := 'type';
    end if;
  end if;

  if v_mode = 'department_groups' then
    return query
    with base_issues as (
      select
        i.id,
        coalesce(nullif(btrim(t.label), ''), nullif(btrim(i.type), ''), '') as type_label,
        i.status,
        i.created_at,
        i.closed_at,
        i.due_at,
        case
          when i.status = 'Closed' and i.closed_at is not null and i.created_at is not null
          then extract(epoch from (i.closed_at - i.created_at)) / 3600.0
          else null
        end as duration_hours
      from public.incident_reports i
      left join public.incident_types t on t.id = i.type_id and t.org_id = i.org_id
      where i.org_id = v_org_id
        and (p_date_from is null or i.incident_date >= p_date_from)
        and (p_date_to is null or i.incident_date <= p_date_to)
    ),
    grouped as (
      select
        b.*,
        coalesce(
          (select g.name
           from public.issue_department_groups g
           where g.org_id = v_org_id
             and exists (select 1 from unnest(g.issue_types) e where lower(btrim(e)) = lower(b.type_label))
           order by g.name
           limit 1),
          'Unassigned'
        ) as dept_name
      from base_issues b
    )
    select
      g.dept_name as department,
      count(*)::bigint as total_issues,
      count(*) filter (where g.status = 'Closed')::bigint as closed_issues,
      count(*) filter (where g.status <> 'Closed')::bigint as open_issues,
      round(avg(g.duration_hours)::numeric, 2) as avg_closing_hours,
      round((percentile_cont(0.5) within group (order by g.duration_hours))::numeric, 2) as median_closing_hours,
      count(*) filter (where g.status <> 'Closed' and g.due_at is not null and g.due_at < now())::bigint as overdue_issues
    from grouped g
    group by g.dept_name
    order by g.dept_name;
  else
    return query
    with base_issues as (
      select
        coalesce(nullif(btrim(t.label), ''), nullif(btrim(i.type), ''), 'Unassigned') as dept_name,
        i.status,
        i.due_at,
        case
          when i.status = 'Closed' and i.closed_at is not null and i.created_at is not null
          then extract(epoch from (i.closed_at - i.created_at)) / 3600.0
          else null
        end as duration_hours
      from public.incident_reports i
      left join public.incident_types t on t.id = i.type_id and t.org_id = i.org_id
      where i.org_id = v_org_id
        and (p_date_from is null or i.incident_date >= p_date_from)
        and (p_date_to is null or i.incident_date <= p_date_to)
    )
    select
      b.dept_name as department,
      count(*)::bigint as total_issues,
      count(*) filter (where b.status = 'Closed')::bigint as closed_issues,
      count(*) filter (where b.status <> 'Closed')::bigint as open_issues,
      round(avg(b.duration_hours)::numeric, 2) as avg_closing_hours,
      round((percentile_cont(0.5) within group (order by b.duration_hours))::numeric, 2) as median_closing_hours,
      count(*) filter (where b.status <> 'Closed' and b.due_at is not null and b.due_at < now())::bigint as overdue_issues
    from base_issues b
    group by b.dept_name
    order by b.dept_name;
  end if;
end;
$$;
