-- Rollback of 2671: restore attendance_days_select as in 1036.
drop policy attendance_days_select on public.attendance_days;
create policy attendance_days_select on public.attendance_days for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
              or exists (select 1 from public.crews c where c.id = attendance_days.crew_id and c.field_controller_id = (select auth.uid()))
              or exists (select 1 from public.people w where w.id = attendance_days.worker_id and w.profile_id = (select auth.uid()))));
