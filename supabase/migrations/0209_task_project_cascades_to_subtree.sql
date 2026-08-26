-- 0209_task_project_cascades_to_subtree.sql — moving a parent task carries its subtree with it.
--
-- OD-TASK-2 (owner, 2026-08-21): "when parent task gets transferred, from a 'default' project to
-- an 'actual' project, children task should also transfer" — yes. A subtask has no independent
-- project identity; it exists only in relation to its parent.
--
-- THE GAP (#550, pre-existing since 0140, not introduced by 0199). The guard
-- `check_tasks_parent_same_project` is `before insert or update ... for each row` bound to the row
-- CARRYING `parent_task_id` — so it fires on the CHILD, and never on the parent. Move a parent from
-- project A to project B and its children stay in A: the invariant the trigger exists to hold,
-- broken through the one path it never fires on, with no error. Low severity — 0199's select policy
-- makes both org-readable either way, 0141 excludes any task with a parent from every rollup, and
-- the org floor holds — but it produces a subtask rendered under a parent in a different project,
-- and a wrong answer to "what is in this project".
--
-- ⛔ CASCADE, NOT REFUSE. Blocking the move would fail the ordinary "file this My Tasks item into a
-- project" workflow for a reason the user cannot act on.
--
-- ⚑ WHY THIS WALKS LEVEL BY LEVEL INSTEAD OF ONE RECURSIVE UPDATE. The obvious implementation —
-- one `update … where id in (recursive descendants)` — is WRONG here, and silently so. Under READ
-- COMMITTED a statement sees the snapshot taken at statement start, so the BEFORE guard firing on a
-- GRANDCHILD reads its parent's OLD project_id (that parent is being updated by the very same
-- statement) and raises 42501. The move fails with "parent task must be in the same project" — a
-- message describing the exact state the cascade is creating. Each depth level is therefore its own
-- statement, so the next level's guard sees the previous level already moved.
--
-- ⚑ NO TRIGGER IS DROPPED OR RE-CREATED. A trigger binds its function by OID (0125's incident,
-- 0189's standing rule), so the existing `tasks_check_parent_same_project` is left strictly alone.
-- This adds a NEW, separate AFTER trigger.
--
-- MANUAL REVERSAL:
--   drop trigger if exists tasks_cascade_project_to_subtree on public.tasks;
--   drop function if exists public.cascade_task_project_to_subtree();

create or replace function public.cascade_task_project_to_subtree()
  returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_moved   integer;
  v_depth   integer := 0;
begin
  -- ⚑ THE RECURSION GUARD. Each level's UPDATE re-fires this same AFTER trigger on every row it
  -- moves. Without this the first level would start its own full cascade, and so would each of its
  -- children — exponential re-work converging on the same answer. Only the ORIGINATING statement
  -- (depth 1) walks the subtree; the cascaded writes it performs are depth >= 2 and return here.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- Walk one level at a time. `v_moved = 0` terminates at the leaves; the depth cap is a
  -- belt-and-braces stop in case a `parent_task_id` cycle ever exists — 0140 declares the column
  -- self-referential with no cycle constraint, so nothing in the schema forbids one, and an
  -- unbounded loop inside a trigger would hang the caller's transaction rather than fail it.
  loop
    v_depth := v_depth + 1;
    exit when v_depth > 32;

    update public.tasks c
       set project_id = new.project_id
      from public.tasks p
     where c.parent_task_id = p.id
       and p.project_id is not distinct from new.project_id
       and c.project_id is distinct from new.project_id
       and c.org_id = new.org_id;

    get diagnostics v_moved = row_count;
    exit when v_moved = 0;
  end loop;

  return null;
end; $$;

comment on function public.cascade_task_project_to_subtree() is
  'OD-TASK-2 / #550: a subtask follows its parent between projects. Walks the subtree one level per statement — a single recursive UPDATE trips the BEFORE guard on grandchildren, which read the pre-statement snapshot of their parent.';

-- ⚑ `of project_id` narrows the trigger to the column that matters: every other task UPDATE (a
-- status change, a rename, the ClickUp sweep writing timestamps) skips this entirely.
create trigger tasks_cascade_project_to_subtree
  after update of project_id on public.tasks
  for each row
  when (old.project_id is distinct from new.project_id)
  execute function public.cascade_task_project_to_subtree();
