-- 2671_attendance_manager_reads_reports.sql -- the manager recorded on a person reads that person's attendance rows (#2882, OD-R1125-1).
-- Without it the manager who marks a report (2670) could not see the mark on screen. Restates attendance_days_select (1036) with one more branch.
-- drops: nothing removed; one OR branch added.
-- Rollback supabase/migrations/rollback/2671_attendance_manager_reads_reports_down.sql
drop policy attendance_days_select on public.attendance_days;
create policy attendance_days_select on public.attendance_days for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
              or exists (select 1 from public.crews c where c.id = attendance_days.crew_id and c.field_controller_id = (select auth.uid()))
              or exists (select 1 from public.people w where w.id = attendance_days.worker_id and w.profile_id = (select auth.uid()))
              or exists (select 1 from public.people w where w.id = attendance_days.worker_id and w.manager_id = (select auth.uid())))); -- mut:manager_reads_reports
