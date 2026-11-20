-- 1026_site_issue_log_columns_down.sql — reverse 0979 (#2521). Drops the issue columns; incident rows themselves stay.
drop policy if exists incident_reports_update_assignee on public.incident_reports;
drop trigger if exists incident_reports_zz_issue_guard on public.incident_reports;
drop function if exists public.guard_incident_issue_fields();
drop index if exists public.incident_reports_overdue_idx;
drop index if exists public.incident_reports_assignee_idx;
drop index if exists public.incident_reports_work_order_idx;
alter table public.incident_reports
  drop column if exists task_id, drop column if exists escalated_at, drop column if exists close_note,
  drop column if exists closed_by, drop column if exists closed_at, drop column if exists due_at,
  drop column if exists action, drop column if exists assignee_id, drop column if exists work_order_id;
