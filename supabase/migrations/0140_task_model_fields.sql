-- 0123_task_model_fields.sql — OD-INT-9: extend public.tasks with description, priority,
-- parent_task_id (subtasks) and archived_at, all nullable.
--
-- Reversibility: pre-prod via `supabase db reset`. Manual reverse block (forward-only if promoted):
--   drop trigger  if exists tasks_check_parent_same_project on public.tasks;
--   drop function if exists public.check_tasks_parent_same_project();
--   drop index    if exists public.tasks_parent_task_id_idx;
--   alter table public.tasks drop constraint if exists tasks_parent_not_self;
--   alter table public.tasks drop column if exists archived_at;
--   alter table public.tasks drop column if exists parent_task_id;
--   alter table public.tasks drop column if exists priority;
--   alter table public.tasks drop column if exists description;
--   drop type if exists public.task_priority;
--   -- 0093's enforce_assignee_status_only() reverts with it (see that migration's own reverse block).
--
-- Why priority is a PMO enum, not ClickUp's raw 1-4 (OD-INT-9): ADR-0055 keeps PMO vendor-neutral;
-- the ClickUp<->PMO priority map is a fixed 4-value constant in clickup/mapping.ts (not built here —
-- schema/types only, per the task brief).
--
-- description/priority/parent_task_id/archived_at are fields ClickUp OWNS (map to ClickUp task
-- fields description, priority, parent, archived) — so 0093's column-pin trigger
-- (enforce_assignee_status_only) must treat them like name/status, NOT as enhancement columns
-- (milestone_id). This migration extends that trigger's pinned-field list in both the
-- externally-owned branch AND the assignee-self-status branch (an assignee may still only change
-- status, now including these four columns too — consistent with the existing "only status" rule,
-- not a behavior change for any pre-existing column).
--
-- Subtask rollup rule (OD-INT-9, binding, NOT implemented here — issue #5): only
-- parent_task_id is null tasks participate in milestone %, delivery_pct, S-curve and Gantt. This
-- migration adds the column + FK + index only; get_project_milestones / get_projects_delivery are
-- left untouched, so a subtask will currently double-count alongside its parent until #5 lands.

-- §1 — task_priority enum + the four nullable columns.
create type public.task_priority as enum ('Urgent','High','Normal','Low');

alter table public.tasks add column description text;
alter table public.tasks add column priority task_priority;
alter table public.tasks add column parent_task_id uuid references public.tasks(id) on delete cascade;
alter table public.tasks add column archived_at timestamptz;

-- §2 — a task cannot be its own parent.
alter table public.tasks add constraint tasks_parent_not_self check (parent_task_id <> id);

-- §3 — index for the rollup exclusion + parent lookups (issue #5 will query WHERE parent_task_id is
-- null / = X against this).
create index tasks_parent_task_id_idx on public.tasks (parent_task_id);

-- §4 — same-project invariant (mirrors 0043 incident_reports/projects pattern): a subtask must live
-- in the SAME project as its parent. A plain FK bypasses RLS/business rules, so without this a
-- parent_task_id could point at a task in a different project (even a different org's task is
-- already blocked by the FK's own RLS-independent scan — but SAME-org/DIFFERENT-project is not).
-- BEFORE INSERT OR UPDATE so every write path is constrained; 42501 (uniform, no existence leak),
-- matching 0043's convention.
create or replace function public.check_tasks_parent_same_project()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.parent_task_id is not null
     and (select t.project_id from public.tasks t where t.id = new.parent_task_id)
         is distinct from new.project_id
  then
    raise exception 'parent task must be in the same project' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger tasks_check_parent_same_project
  before insert or update on public.tasks
  for each row execute function public.check_tasks_parent_same_project();

-- §5 — extend the 0093 column-pin trigger: description/priority/parent_task_id/archived_at are
-- ClickUp-owned native fields, not enhancement columns. Branch (b) externally-owned: pin them like
-- name/status for every non-service-role user. Branch (c) not externally-owned: an assignee may
-- still only change status (now also excluding these four from the assignee's self-edit).
-- Branch (a) service-role bypass and every other line are byte-for-byte unchanged from 0093.
create or replace function public.enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' and public.domain_externally_owned(new.org_id, 'tasks') then
    return new;
  end if;
  if public.domain_externally_owned(new.org_id, 'tasks') then
    if new.name           is distinct from old.name
       or new.status         is distinct from old.status
       or new.assignee_id    is distinct from old.assignee_id
       or new.project_id     is distinct from old.project_id
       or new.org_id         is distinct from old.org_id
       or new.start_date     is distinct from old.start_date
       or new.end_date       is distinct from old.end_date
       or new.id             is distinct from old.id
       or new.created_at     is distinct from old.created_at
       or new.description    is distinct from old.description
       or new.priority       is distinct from old.priority
       or new.parent_task_id is distinct from old.parent_task_id
       or new.archived_at    is distinct from old.archived_at
    then
      raise exception 'task native fields are read-only while tasks are externally-owned'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if auth_role() in ('Admin','Executive','Project Manager','Finance') then
    return new;
  end if;
  if new.name           is distinct from old.name
     or new.assignee_id    is distinct from old.assignee_id
     or new.project_id     is distinct from old.project_id
     or new.org_id         is distinct from old.org_id
     or new.start_date     is distinct from old.start_date
     or new.end_date       is distinct from old.end_date
     or new.id             is distinct from old.id
     or new.created_at     is distinct from old.created_at
     or new.description    is distinct from old.description
     or new.priority       is distinct from old.priority
     or new.parent_task_id is distinct from old.parent_task_id
     or new.archived_at    is distinct from old.archived_at
  then
    raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
  end if;
  return new;
end; $$;
