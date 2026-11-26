-- Task roll-ups and task tree depth. Reverse with rollback/2766_task_rollups_down.sql.
-- drops: the scheduled overdue filter now requires an active task, and section task counts use the leaf rule.

create or replace function public.scheduled_report_content(
  p_kind text, p_org uuid, p_recipient uuid, p_from date, p_to date, p_locale text, p_name text
) returns table (subject text, body text)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role          text;
  v_built_in_role text;
  v_cur           text;
  v_lines         text[] := '{}';
  v_head          text;
  r               record;
begin
  select pr.role::text, pr.built_in_role into v_role, v_built_in_role
    from public.profiles pr where pr.id = p_recipient and pr.org_id = p_org;
  if v_role is null then return; end if;   -- not a member of this organisation: no figures at all
  select o.default_currency into v_cur from public.organizations o where o.id = p_org;
  v_head := p_name || E'\n' || public.scheduled_report_text(p_locale, p_kind) || E'\n' || public.scheduled_report_text(p_locale, 'period') || ': '
            || case when p_from = p_to then p_to::text else p_from::text || ' - ' || p_to::text end;

  if p_kind = 'daily_progress' then
    for r in
      select p.name as project, count(distinct d.id) as reports,
             count(distinct d.id) filter (where d.status = 'validated') as validated,
             count(distinct l2.id) as lines,
             sum(l2.frozen_amount) filter (where d.status = 'validated') as revenue,
             (v_role in ('Admin','Finance','Executive')
              or (v_role = 'Project Manager' and p.project_manager_id = p_recipient)
              or (v_built_in_role = 'project_control_manager' and public.is_active_member(p_recipient))) as may_see_revenue
        from public.daily_site_reports d
        join public.projects p on p.id = d.project_id and p.org_id = p_org
        left join public.dsr_progress_lines l2 on l2.report_id = d.id and l2.org_id = p_org
       where d.org_id = p_org and d.work_date between p_from and p_to
         and d.archived_at is null and d.superseded_at is null and d.status <> 'draft'
       group by p.id, p.name, p.project_manager_id
       order by p.name
    loop
      v_lines := v_lines || (r.project || ': ' || r.reports || ' ' || public.scheduled_report_text(p_locale, 'reports')
        || ' (' || r.validated || ' ' || public.scheduled_report_text(p_locale, 'validated') || '), '
        || r.lines || ' ' || public.scheduled_report_text(p_locale, 'lines')
        || case when r.may_see_revenue and r.revenue is not null
                then ', ' || public.scheduled_report_text(p_locale, 'revenue') || ' ' || to_char(r.revenue, 'FM999999999990.00') || ' ' || v_cur
                else '' end);
    end loop;
    if cardinality(v_lines) = 0 then v_lines := array[public.scheduled_report_text(p_locale, 'nothing_progress')]; end if;
    return query select p_name, v_head || E'\n\n' || array_to_string(v_lines, E'\n');

  elsif p_kind = 'overdue_tasks' then
    for r in
      select p.name as project, count(*) as n
        from public.tasks t
        join public.projects p on p.id = t.project_id and p.org_id = p_org
       where t.org_id = p_org and t.status <> 'Done' and t.tombstoned_at is null and t.archived_at is null and t.end_date < p_to
         and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null)   -- #2807: leaves only
       group by p.id, p.name order by p.name
    loop
      v_lines := v_lines || (r.project || ': ' || r.n || ' ' || public.scheduled_report_text(p_locale, 'overdue'));
    end loop;
    if cardinality(v_lines) = 0 then v_lines := array[public.scheduled_report_text(p_locale, 'nothing_overdue')]; end if;
    return query select p_name, v_head || E'\n\n' || array_to_string(v_lines, E'\n');
  end if;
end $$;

create or replace function public.work_order_section_rollup(p_work_order_id uuid)
  returns table (
    section_id uuid, code text, name text, location_note text, foreman_id uuid, readiness text, readiness_note text,
    sort_order integer, archived_at timestamptz,
    direct_budget numeric, indirect_budget numeric, equipment_hours numeric, crew_hours numeric,
    tasks_total integer, tasks_done integer, crews_today integer)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with s as (
    select x.id, x.code, x.name, x.location_note, x.foreman_id, x.readiness, x.readiness_note, x.sort_order, x.archived_at
      from public.work_order_sections x where x.work_order_id = p_work_order_id
  ),
  keys as (
    select s.id as sid, s.code, s.name, s.location_note, s.foreman_id, s.readiness, s.readiness_note, s.sort_order, s.archived_at from s
    union all
    select null::uuid, null, null, null, null::uuid, null, null, null::integer, null::timestamptz where exists (select 1 from s)
  ),
  plan as (
    select l.section_id as sid, l.kind, sum(l.value) as v
      from public.work_order_plan_lines l where l.work_order_id = p_work_order_id group by l.section_id, l.kind
  ),
  tk as (
    select t.section_id as sid, count(*)::integer as total, (count(*) filter (where t.status = 'Done'))::integer as done
      from public.tasks t
     where t.work_order_id = p_work_order_id and t.archived_at is null
       and not exists (
         select 1 from public.tasks c
          where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null
       )
     group by t.section_id
  ),
  cr as (
    select c.section_id as sid, count(*)::integer as n
      from public.work_order_crews c
     where c.work_order_id = p_work_order_id and (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC'))::date between c.valid_from and coalesce(c.valid_to, 'infinity'::date)
     group by c.section_id
  )
  select k.sid, k.code, k.name, k.location_note, k.foreman_id, k.readiness, k.readiness_note, k.sort_order, k.archived_at,
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'direct_budget'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'indirect_budget'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'equipment_hours'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'crew_hours'),
         coalesce((select t.total from tk t where t.sid is not distinct from k.sid), 0),
         coalesce((select t.done from tk t where t.sid is not distinct from k.sid), 0),
         coalesce((select c.n from cr c where c.sid is not distinct from k.sid), 0)
    from keys k
   order by (k.sid is null), k.sort_order, k.code
$$;

