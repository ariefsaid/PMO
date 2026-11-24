-- 1980_my_home_visible_crews_once.sql -- the phone home reads the caller's crews once, not once per rostered crew of the org.
-- drops: my_home replaces its light_can_see_crew(c.id) roster filter with the same condition written in place (the crew is led by the caller, or the caller is placed in it today). Nothing else changes.
-- my_home filtered every live work-order roster row of the organisation with light_can_see_crew(c.id): a security-definer SQL
-- function, so never inlined and planned again on every call (about 0.8 ms each). With 300 rostered crews that was 230 ms of a
-- 250 ms home read, for every field user and foreman, on every open of the phone home (measured, perf-1124 load run).
-- The condition is now written in place: the crew is led by the caller, or the caller's own person record is placed in it today.
-- That is light_can_see_crew's body (1205) with its auth_org_id(), auth.uid() and equipment_org_today(c.org_id) replaced by
-- v_org, v_uid and v_today, which this function already holds and which are the same values (c.org_id = v_org is required
-- by the crew's own condition). The same rows come back; nothing else changes.
-- Source: my_home as defined in 1552 (the head definition), one condition changed.
-- Rollback: supabase/migrations/rollback/1980_my_home_visible_crews_once_down.sql

create or replace function public.my_home() returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_today date;
  v_worker uuid;
begin
  if v_uid is null or v_org is null or not public.is_active_member() then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_today := public.equipment_org_today(v_org);
  select pe.id into v_worker from public.people pe where pe.profile_id = v_uid and pe.org_id = v_org limit 1;
  return jsonb_build_object(
    'today', v_today,
    'decider_role', (select o.phone_check_in_supervisor_role from public.organizations o where o.id = v_org),
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
                                          'is_controller', y.is_controller, 'has_area', y.has_area, 'check_in', y.check_in)
                       order by y.title, y.work_order_id)
        from (select w.id as work_order_id, w.title, p.name as project_name, c.id as crew_id, c.name as crew_name,
                     v_worker as my_worker_id,
                     (c.field_controller_id = v_uid) as is_controller, (w.area_lat is not null) as has_area,
                     -- 1552: what became of today's clock-in here, so the home can say so (the latest request today, else today's attendance)
                     coalesce(
                       (select case when q.status in ('recorded', 'approved') then jsonb_build_object('state', 'clocked_in', 'at', coalesce(q.decided_at, q.checked_in_at))
                                    when q.status in ('pending', 'approving') then jsonb_build_object('state', 'pending', 'at', q.checked_in_at, 'outcome', q.outcome)
                                    else jsonb_build_object('state', 'rejected', 'at', q.decided_at, 'reason', q.decision_reason) end
                          from public.phone_check_ins q
                         where q.worker_id = v_worker and q.work_order_id = w.id and q.work_date = v_today
                         order by q.checked_in_at desc, q.id limit 1),
                       (select jsonb_build_object('state', 'clocked_in', 'at', a.recorded_at)
                          from public.attendance_days a
                         where a.worker_id = v_worker and a.work_order_id = w.id and a.work_date = v_today
                           and a.status = 'present' and a.phone_hours is not null)) as check_in
                from public.work_order_crews r
                join public.crews c on c.id = r.crew_id
                join public.work_orders w on w.id = r.work_order_id
                join public.projects p on p.id = w.project_id
               where r.org_id = v_org and v_today between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
                 and w.status::text not in ('Closed', 'Cancelled')
                 and c.org_id = v_org
                 and (c.field_controller_id = v_uid
                      or exists (select 1 from public.crew_members m join public.people pw on pw.id = m.worker_id
                                  where m.crew_id = c.id and pw.profile_id = v_uid
                                    and v_today between m.valid_from and coalesce(m.valid_to, 'infinity'::date)))
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
