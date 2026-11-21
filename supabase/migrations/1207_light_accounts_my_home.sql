-- 1207 (#2710): the phone home screen's one read. Own items only: assigned tasks (any project), work orders the person is rostered
-- on today (as a crew member or as the crew's field controller), issues the person reported. No price, budget or value field.
-- Rollback: supabase/migrations/rollback/1207_light_accounts_my_home_down.sql
-- Security definer so project and work-order NAMES can be shown beside own items while projects and work_orders stay unreadable
-- to a light account (1206). Every branch is keyed to auth.uid(); the caller's organisation bounds every table.
create function public.my_home() returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_today date;
begin
  if v_uid is null or v_org is null or not public.is_active_member() then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_today := public.equipment_org_today(v_org);
  return jsonb_build_object(
    'today', v_today,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'status', x.status, 'end_date', x.end_date,
                                          'project_id', x.project_id, 'project_name', x.project_name)
                       order by x.end_date nulls last, x.id)
        from (select t.id, t.name, t.status::text as status, t.end_date, t.project_id, p.name as project_name
                from public.tasks t join public.projects p on p.id = t.project_id
               where t.org_id = v_org and t.assignee_id = v_uid and t.archived_at is null
               order by t.end_date nulls last, t.id limit 200) x), '[]'::jsonb),
    'work_orders', coalesce((
      select jsonb_agg(jsonb_build_object('work_order_id', y.work_order_id, 'title', y.title, 'project_name', y.project_name,
                                          'crew_id', y.crew_id, 'crew_name', y.crew_name, 'my_worker_id', y.my_worker_id,
                                          'is_controller', y.is_controller)
                       order by y.title, y.work_order_id)
        from (select w.id as work_order_id, w.title, p.name as project_name, c.id as crew_id, c.name as crew_name,
                     (select pe.id from public.people pe where pe.profile_id = v_uid and pe.org_id = v_org limit 1) as my_worker_id,
                     (c.field_controller_id = v_uid) as is_controller
                from public.work_order_crews r
                join public.crews c on c.id = r.crew_id
                join public.work_orders w on w.id = r.work_order_id
                join public.projects p on p.id = w.project_id
               where r.org_id = v_org and v_today between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
                 and w.status::text not in ('Closed', 'Cancelled')
                 and public.light_can_see_crew(c.id)
               limit 100) y), '[]'::jsonb),
    'issues', coalesce((
      select jsonb_agg(jsonb_build_object('id', z.id, 'type', z.type, 'severity', z.severity, 'status', z.status,
                                          'incident_date', z.incident_date, 'description', z.description)
                       order by z.incident_date desc, z.id)
        from (select i.id, i.type, i.severity::text as severity, i.status::text as status, i.incident_date, i.description
                from public.incident_reports i
               where i.org_id = v_org and i.reported_by = v_uid
               order by i.incident_date desc, i.id limit 100) z), '[]'::jsonb)
  );
end $$;
revoke all on function public.my_home() from public, anon;
grant execute on function public.my_home() to authenticated;
