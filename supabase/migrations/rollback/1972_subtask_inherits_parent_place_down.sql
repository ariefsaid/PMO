-- Reverses 1972: the sync no longer copies a parent's place. The backfilled phases and groups stay: they only
-- filled empty columns, and clearing them would move work out of its phase again.
drop trigger if exists tasks_inherit_parent_place on public.tasks;
drop function if exists public.inherit_parent_task_place();
drop function if exists public.backfill_subtask_places();
