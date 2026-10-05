-- Rollback for 0232_workflow_notifications.sql
drop trigger if exists tasks_notify_assignment_trg on public.tasks;
drop trigger if exists timesheets_notify_transition_trg on public.timesheets;
drop trigger if exists procurements_notify_transition_trg on public.procurements;
drop function if exists public.notify_task_assignment();
drop function if exists public.notify_timesheet_transition();
drop function if exists public.notify_procurement_transition();
drop function if exists public.notify_workflow_user(uuid, uuid, text, text, text, text, uuid, text);
