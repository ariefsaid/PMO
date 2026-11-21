-- Reverses 1395 (#2679). Run 1396's rollback first (it reads task_groups).
update public.record_history_config set captured = captured - 'task_group_id' where table_name = 'tasks';
drop trigger if exists tasks_guard_task_group_write on public.tasks;
drop function if exists public.guard_task_group_write();
alter table public.tasks drop constraint if exists tasks_task_group_needs_project;
alter table public.tasks drop constraint if exists tasks_task_group_id_fkey;
drop index if exists public.tasks_task_group_idx;
alter table public.tasks drop column if exists task_group_id;
drop table if exists public.task_groups;
