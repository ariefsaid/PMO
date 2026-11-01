-- 0434_task_reminders_down.sql — reverse of 0434 (#1639).
drop function if exists public.send_task_reminders(uuid[]);
drop function if exists public.preview_task_reminders(uuid[]);
drop function if exists public.task_reminder_check(uuid, uuid, uuid);
drop function if exists public.task_reminder_daily_cap();
drop function if exists public.task_reminder_window();
drop table if exists public.task_reminders;
