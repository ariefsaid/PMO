-- 1392_add_task_to_incident_down.sql — reverse 1392 (#2677).
drop function if exists public.add_task_to_incident(uuid, text, uuid, date);
