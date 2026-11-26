-- Rollback of 2725: the per-row policy of 2384.
alter policy supervisor_attendance_read on public.attendance_days
  using ((select public.is_active_member()) and org_id=(select public.auth_org_id()) and public.actor_holds_job_role('site_supervisor') and public.actor_may_task_issue(work_order_id));
drop function public.supervisor_task_issue_work_orders();
