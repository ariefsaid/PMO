-- 1424_issue_closing_report.sql — #2678: Closing-time report for issues by department.
-- Spec: docs/specs/closing-time-report.spec.md; Plan: docs/plans/2026-11-21-closing-time-report.md.
-- Reversible: supabase/migrations/rollback/1424_issue_closing_report_down.sql.
-- Not a money path.

-- §1. Settings table
create table public.issue_closing_report_settings (
  org_id        uuid primary key references public.organizations(id) on delete cascade,
  enabled       boolean not null default false,
  grouping_mode text not null default 'type' check (grouping_mode in ('type', 'department_groups')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) default auth.uid()
);

alter table public.issue_closing_report_settings enable row level security;
alter table public.issue_closing_report_settings force row level security;

create policy issue_closing_report_settings_select on public.issue_closing_report_settings
  for select using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

create policy issue_closing_report_settings_insert on public.issue_closing_report_settings
  for insert with check (
    org_id = (select public.auth_org_id())
    and (select public.is_active_member())
    and (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager')
  );

create policy issue_closing_report_settings_update on public.issue_closing_report_settings
  for update using (
    org_id = (select public.auth_org_id())
    and (select public.is_active_member())
    and (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager')
  ) with check (
    org_id = (select public.auth_org_id())
  );

create trigger issue_closing_report_settings_stamp_org_id
  before insert on public.issue_closing_report_settings
  for each row execute function public.stamp_org_id();

-- §2. Department groups table
create table public.issue_department_groups (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  issue_types text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index issue_department_groups_org_name_unique
  on public.issue_department_groups (org_id, lower(btrim(name)));

create index issue_department_groups_org_idx
  on public.issue_department_groups (org_id);

alter table public.issue_department_groups enable row level security;
alter table public.issue_department_groups force row level security;

create policy issue_department_groups_select on public.issue_department_groups
  for select using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

create policy issue_department_groups_insert on public.issue_department_groups
  for insert with check (
    org_id = (select public.auth_org_id())
    and (select public.is_active_member())
    and (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager')
  );

create policy issue_department_groups_update on public.issue_department_groups
  for update using (
    org_id = (select public.auth_org_id())
    and (select public.is_active_member())
    and (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager')
  ) with check (
    org_id = (select public.auth_org_id())
  );

create policy issue_department_groups_delete on public.issue_department_groups
  for delete using (
    org_id = (select public.auth_org_id())
    and (select public.is_active_member())
    and (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager')
  );

create trigger issue_department_groups_stamp_org_id
  before insert on public.issue_department_groups
  for each row execute function public.stamp_org_id();

-- §3. Aggregation RPC: get_issue_closing_time_report
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
        i.type,
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
             and b.type = any(g.issue_types)
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
        coalesce(nullif(btrim(i.type), ''), 'Unassigned') as dept_name,
        i.status,
        i.due_at,
        case
          when i.status = 'Closed' and i.closed_at is not null and i.created_at is not null
          then extract(epoch from (i.closed_at - i.created_at)) / 3600.0
          else null
        end as duration_hours
      from public.incident_reports i
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

-- §4. Grants
revoke all on function public.get_issue_closing_time_report(date, date, text) from public, anon;
grant execute on function public.get_issue_closing_time_report(date, date, text) to authenticated;
grant execute on function public.get_issue_closing_time_report(date, date, text) to service_role;

revoke all on table public.issue_closing_report_settings from public, anon;
grant select, insert, update on public.issue_closing_report_settings to authenticated;
grant all on public.issue_closing_report_settings to service_role;

revoke all on table public.issue_department_groups from public, anon;
grant select, insert, update, delete on public.issue_department_groups to authenticated;
grant all on public.issue_department_groups to service_role;
