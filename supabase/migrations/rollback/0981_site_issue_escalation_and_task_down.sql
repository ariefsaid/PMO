-- 0981_site_issue_escalation_and_task_down.sql — reverse 0981 (#2521).
select cron.unschedule('incident-escalation');
drop function if exists public.escalate_overdue_incidents();
drop function if exists public.create_task_from_incident(uuid);
