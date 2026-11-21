-- 1390_incident_tasks_down.sql — reverse 1390 (#2677). Loses only the extra links; every task and the legacy task_id stay.
drop trigger if exists incident_reports_zz_mirror_task on public.incident_reports;
drop function if exists public.mirror_incident_task();
drop table if exists public.incident_tasks;
