-- 1972_subtask_inherits_parent_place.sql — #2807 review follow-up: a subtask sits in its parent's phase and group.
--
-- Since 1970 only leaves count, so a subtask with no phase and no group moved its work out of the parent's
-- phase (the parent stopped counting there and the subtask counted nowhere). The app already gives a new
-- subtask its parent's place; this closes the two remaining gaps:
--   1. A task the task-tool sync writes (no signed-in user) with a parent and no phase or group takes the
--      parent's phase and group, on insert and when its parent is set later. Signed-in writes are untouched:
--      the app places subtasks itself, and the manager-only group rule (guard_task_group_write) keeps its say.
--   2. A one-time backfill: every live subtask with NO phase and NO group takes its nearest placed ancestor's.
--      A subtask placed somewhere explicitly is never overwritten.
-- Reverse: rollback/1972_subtask_inherits_parent_place_down.sql (drops the trigger; the backfill stays, as
-- it only fills empty columns).

create or replace function public.inherit_parent_task_place()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_task_id is null or new.milestone_id is not null or new.task_group_id is not null
     or auth.uid() is not null then
    return new;
  end if;
  select p.milestone_id, p.task_group_id into new.milestone_id, new.task_group_id
    from public.tasks p where p.id = new.parent_task_id and p.org_id = new.org_id;
  return new;
end; $$;
revoke all on function public.inherit_parent_task_place() from public, anon, authenticated;

create trigger tasks_inherit_parent_place
  before insert or update of parent_task_id on public.tasks
  for each row execute function public.inherit_parent_task_place();

-- The backfill: nearest ancestor that has a phase or a group (depth-capped, so a loop already in the data ends).
-- A function so the pgTAP proof runs the very statement this migration runs; no client may call it.
create or replace function public.backfill_subtask_places()
  returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with recursive up(sub, anc, depth) as (
    select t.id, t.parent_task_id, 1
      from public.tasks t
     where t.parent_task_id is not null and t.milestone_id is null and t.task_group_id is null
       and t.archived_at is null and t.tombstoned_at is null
    union all
    select up.sub, a.parent_task_id, up.depth + 1
      from up join public.tasks a on a.id = up.anc
     where a.milestone_id is null and a.task_group_id is null and a.parent_task_id is not null and up.depth < 64
  ),
  placed as (
    select distinct on (up.sub) up.sub, a.milestone_id, a.task_group_id
      from up join public.tasks a on a.id = up.anc
     where a.milestone_id is not null or a.task_group_id is not null
     order by up.sub, up.depth
  )
  update public.tasks t
     set milestone_id = placed.milestone_id, task_group_id = placed.task_group_id
    from placed
   where t.id = placed.sub;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;
revoke all on function public.backfill_subtask_places() from public, anon, authenticated;

select public.backfill_subtask_places();
