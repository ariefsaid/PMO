-- 2725 -- the site supervisor's attendance read decides the work orders once per query, not once per row (#2922).
-- supervisor_attendance_read called actor_may_task_issue(work_order_id) for every attendance row (about 0.7 ms each, so
-- 0.6 s for one work order's cost lines). The new set function holds the same supervisor rule as actor_may_task_issue, once;
-- the policy tests membership in it. Who sees which row does not change. Managers already read every row through attendance_days_select.
-- Rollback supabase/migrations/rollback/2725_attendance_supervisor_read_once_down.sql
create function public.supervisor_task_issue_work_orders() returns setof uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light(); -- a field account is refused by body (2711); the policy never reaches it, its job-role test comes first
  return query
  select w.id
    from (select public.native_org_today(public.auth_org_id()) as today,
                 coalesce(public.is_active_member() and public.actor_holds_job_role('site_supervisor'), false) as ok) t
    join public.work_orders w on t.ok and w.org_id = public.auth_org_id()
   where t.today between coalesce(w.start_date, '-infinity'::date) and coalesce(w.end_date, 'infinity'::date)
     and (w.responsible_person_id = auth.uid()
          or exists (select 1 from public.work_order_crews r join public.crews c on c.id = r.crew_id and c.org_id = r.org_id
                      where r.work_order_id = w.id and r.org_id = w.org_id and c.field_controller_id = auth.uid()
                        and t.today between r.valid_from and coalesce(r.valid_to, 'infinity'::date)));
end $$;
revoke all on function public.supervisor_task_issue_work_orders() from public, anon;
grant execute on function public.supervisor_task_issue_work_orders() to authenticated, service_role;

alter policy supervisor_attendance_read on public.attendance_days
  using ((select public.is_active_member()) and org_id = (select public.auth_org_id())
         and (select public.actor_holds_job_role('site_supervisor'))
         and work_order_id in (select public.supervisor_task_issue_work_orders())); -- mut:site_attendance_member
