-- reverse 1690: the 1631 read policy (the field controller of any crew in the organisation)
drop policy if exists absence_reports_select on public.absence_reports;
create policy absence_reports_select on public.absence_reports for select using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and (reported_by = (select auth.uid())
       or (select public.crew_can_manage())
       or exists (select 1 from public.crews c where c.org_id = absence_reports.org_id and c.field_controller_id = (select auth.uid()))));
