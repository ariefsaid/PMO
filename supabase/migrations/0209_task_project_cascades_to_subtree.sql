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
  v_frontier  uuid[] := array[new.id];
  v_depth     integer := 0;
  v_stranded  integer;
begin
  -- ⚑ THE RECURSION GUARD. Each level's UPDATE re-fires this same AFTER trigger on every row it
  -- moves. Without it the first level would start its own full cascade, and so would each of its
  -- children. Only the ORIGINATING statement (depth 1) walks the subtree.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- ⛔ ROOTED AT `new.id`, VIA THE FRONTIER. The first version of this loop had no reference to
  -- `new.id` at all: it matched any child whose parent already sat in the destination project, so
  -- ONE task moving into a project swept every inconsistent parent/child pair in the org into it —
  -- rows leaving their board with no user action and nothing attributing it. The repair direction
  -- was chosen by whoever next wrote into that project. `v_frontier` starts at the moved row and
  -- carries forward only the ids actually written, so the walk cannot leave this subtree.
  loop
    v_depth := v_depth + 1;
    if v_depth > 32 then
      -- ⚑ RAISE, never `exit`. Silently stopping at 32 leaves the deeper rows behind — the exact
      -- split this migration exists to close, reintroduced by its own safety valve.
      raise exception 'task subtree is deeper than 32 levels; the project move was aborted rather than left half applied'
        using errcode = '54001';
    end if;

    -- ⚑ `milestone_id` IS CLEARED ON THE WAY. Since 0202 the FK is composite
    -- `(project_id, milestone_id) -> project_milestones(project_id, id)`, so carrying a milestone
    -- of the OLD project into the new one raises a raw 23503 and aborts the whole move — making a
    -- parent with a milestone-grouped subtask PERMANENTLY unmovable, behind an error message about
    -- deleting referenced records. A milestone of the old project has no meaning in the new one, so
    -- the grouping is dropped and the move proceeds, which is what OD-TASK-2 requires.
    with moved as (
      update public.tasks c
         set project_id   = new.project_id,
             milestone_id = null
       where c.parent_task_id = any (v_frontier)
         and c.project_id is distinct from new.project_id
         -- ⚑ DEFENCE IN DEPTH, AND NOT PROVABLE BY TEST — stated so nobody deletes it on the
         -- evidence that the suite stays green. Removing this line leaves all 9 oracles passing,
         -- because the frontier is rooted at `new.id` and a cross-org row can never enter it:
         -- 0199's org floor refuses a cross-org parent/child pair in the first place. So the
         -- rooting is what actually holds the tenancy boundary here, and this is the second lock
         -- on it — load-bearing only if a future change ever widens the frontier. Same reasoning
         -- 0199 records for its own floor and `not found` branch, which are likewise individually
         -- removable and jointly necessary.
         and c.org_id = new.org_id
      returning c.id
    )
    select coalesce(array_agg(id), '{}'::uuid[]) into v_frontier from moved;

    exit when coalesce(array_length(v_frontier, 1), 0) = 0;
  end loop;

  -- ⛔ THE CASCADE IS `security invoker`, SO ITS UPDATE IS SUBJECT TO RLS — and an UPDATE that
  -- matches no rows is a SILENT no-op. A mover who may edit the parent but not a descendant (it was
  -- created by someone else, or they hold only the assignee's status-only right) got `UPDATE 1`,
  -- no error, and a split tree: precisely the defect #550 exists to close, reproduced by its fix.
  -- Worse, the stranded subtask then rejected even a status change for EVERYONE, because the BEFORE
  -- guard now sees a parent in another project — surfacing to the user as "ask an administrator",
  -- which is false.
  --
  -- This is a TABLE invariant, not a per-actor one, so the honest outcome is a refusal that names
  -- what happened. The check is cheap and reliable: `tasks_select` is org-wide, so the function can
  -- SEE the strays it was not allowed to write.
  with recursive descendants as (
    select t.id, t.project_id, 1 as depth
      from public.tasks t
     where t.parent_task_id = new.id
    union all
    select t.id, t.project_id, d.depth + 1
      from public.tasks t
      join descendants d on t.parent_task_id = d.id
     where d.depth < 32
  )
  select count(*) into v_stranded
    from descendants
   where project_id is distinct from new.project_id;

  if coalesce(v_stranded, 0) > 0 then
    raise exception 'this task has % subtask(s) you are not allowed to move; a subtask must stay with its parent, so move or detach them first', v_stranded
      using errcode = '42501';
  end if;

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
