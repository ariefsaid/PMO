-- 1690_absence_report_crew_scope.sql — an absence report is read by the person, a crew manager (Admin, Executive, Project
-- Manager), and the field controller of the crew the person is in on that report's day (worker_effective_crew: the home crew,
-- or the host crew on a loan day the host crew is on a work order). The field controller of another crew reads none.
-- Proven by supabase/tests/1690_absence_report_crew_scope.test.sql. Reverse: rollback/1690_absence_report_crew_scope_down.sql
drop policy if exists absence_reports_select on public.absence_reports;
create policy absence_reports_select on public.absence_reports for select using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and (reported_by = (select auth.uid())
       or (select public.crew_can_manage())
       or exists (select 1 from public.crews c
                   where c.org_id = absence_reports.org_id
                     and c.field_controller_id = (select auth.uid())
                     and c.id = public.worker_effective_crew(absence_reports.person_id, absence_reports.work_date))));
