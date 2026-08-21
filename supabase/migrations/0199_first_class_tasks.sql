-- 0199_first_class_tasks.sql — #525: a task may exist before anything owns it.
--
-- Spec: docs/specs/first-class-tasks.spec.md (FR-FCT-001..015). Decision: #462 (DD-TASK-2).
-- Prerequisite for the meeting module (#526) — a meeting persists action items that become tasks,
-- and a task that must name a project cannot be one.
--
-- ⛔ WHY THIS IS ONE FILE AND NOT A CAUTIOUS SEQUENCE OF SMALL ONES. The defect this migration
-- exists to remove is the **disagreement between** the column, the CHECK, the ownership predicate,
-- the four policies and the two trigger bodies. Changing some and not others IS the failure mode,
-- not a careful step toward the fix. So: one file, all of it, or none of it.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⛔ THE DEFECT, stated precisely, because "the policies disagree" understates it twice.
--
-- With `project_id is null`, `tasks_insert` / `tasks_update` / `tasks_delete` (0146:47-61) all deny
-- through `exists (select 1 from projects p where p.id = tasks.project_id …)` — an EXISTS over a
-- NULL id matches no row — while `tasks_update_own_status` (0146:63-67) passes, because
-- `project_domain_externally_owned(null,'tasks')` is `false` for the same accidental reason.
--
--   (1) THE LOCK-OUT IS SILENT. `tasks_update`/`tasks_delete` deny via `using`, which HIDES the row.
--       A hidden row makes the statement a 0-row no-op, not an error, and `updateTask`/`deleteTask`/
--       `archiveTask` (src/lib/db/tasks.ts:211-212, 249-253, 269-271) inspect only `error`. So a
--       project-less task would be undeletable and unarchivable, and the UI would report it saved.
--       Only INSERT fails loudly. ⚑ This is why the pgTAP oracle asserts the ROW COUNT and not just
--       `lives_ok` — `lives_ok` alone passes against the broken policy set.
--
--   (2) THE ASSIGNEE POLICY BECOMES THE WIDER DOOR. A PM who IS the assignee passes
--       `tasks_update_own_status`, then hits the write-role early return at 0146:98-100 and gets a
--       FULL STRUCTURE EDIT — on a row an unassigned PM cannot touch at all. The narrow policy would
--       out-scope the broad one.
--
-- Neither is reachable today because the column is NOT NULL. Making it nullable is what arms them,
-- which is why every part moves in this one migration.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual reverse, in order:
--   -- re-run 0146 §1-§3 verbatim (predicate, four policies, two trigger bodies);
--   alter table public.tasks drop constraint if exists tasks_milestone_needs_project;
--   delete from public.tasks where project_id is null;   -- or give them one
--   alter table public.tasks alter column project_id set not null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the column, and the ONE invariant a project-less task must still obey.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.tasks alter column project_id drop not null;

-- ⚑ FR-FCT-004. Found by the spec pass, recorded nowhere before it: EVERY server-side rollup joins
-- tasks through `milestone_id`, never `project_id` (0023:68,95 · 0026:33 · 0033:167 · 0141:42,76 ·
-- 0145:42,77). Without this CHECK a project-less task carrying a borrowed milestone id would MOVE A
-- PROJECT'S DELIVERY PERCENTAGE from outside that project — silently, and the number still renders.
--
-- ⚑ The FK deliberately KEEPS `on delete cascade` (FR-FCT-002). `on delete set null` would quietly
-- convert the tasks of a deleted project into "unassigned work" in My Tasks. A project-less task is
-- one that was NEVER given a project — never one orphaned by a deletion. If the owner wants the
-- other answer it is a one-line change here plus a decision recorded on #525.
alter table public.tasks
  add constraint tasks_milestone_needs_project
  check (milestone_id is null or project_id is not null);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — ONE ownership predicate whose answer for a project-less row is DECLARED, not incidental.
--
-- 0146's `project_domain_externally_owned(project_id,'tasks')` returns false for a NULL project only
-- because `p.id = null` matches no row — the same accident that produces the disagreement above. A
-- task with no project is by definition not inside any ClickUp-bound project, so `false` is also the
-- RIGHT answer; the change is that it is now the STATED one, and a reader can tell the difference.
--
-- ⚑ Deliberately NOT `DD-TASK-2` §3's prescribed "resolve via the task's own org" fix. That reverts
-- 0146's own change (FR-IEM-010..013) and would make EVERY project-less task read-only in any
-- ClickUp-connected org — i.e. exactly where meeting action items will live. The diagnosis (one
-- cause, three call sites) is right; the prescription is not.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.task_domain_externally_owned(p_project_id uuid)
  returns boolean language sql stable security invoker set search_path = public as $$
  -- A task with NO project cannot be inside an externally-owned one. Stated, not inferred from a
  -- NULL comparison that happens to match nothing.
  select p_project_id is not null
     and public.project_domain_externally_owned(p_project_id, 'tasks')
$$;
revoke all     on function public.task_domain_externally_owned(uuid) from public;
grant  execute on function public.task_domain_externally_owned(uuid) to authenticated;
grant  execute on function public.task_domain_externally_owned(uuid) to service_role;
comment on function public.task_domain_externally_owned(uuid) is
  '#525 FR-FCT-014: the SINGLE ownership predicate for a task. Returns false for a project-less task '
  'BY DECLARATION — 0146''s form returned false only because an EXISTS over a NULL id matches no row, '
  'and that accident is what made the four write policies disagree.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — the four policies, now agreeing. The parent-org guard is UNCHANGED for project-carrying rows
-- (FR-FCT-012) — it is expressed as "if there is a project, it must be in my org", which is the same
-- rule the EXISTS encoded, minus the accidental denial of the no-project case.
--
-- ⚑ `and p.org_id = auth_org_id()` inside the EXISTS is DEFENCE IN DEPTH, not the sole guard, and it
-- stays for that reason. The subquery runs as the CALLER, so `projects_select` RLS already hides
-- another org's project and the EXISTS fails on visibility alone — verified by mutation: removing
-- the clause does not redden the cross-org oracle. Two layers is the point; do not "simplify" it to
-- one on the grounds that a test still passes.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
drop policy tasks_insert on public.tasks;
drop policy tasks_update on public.tasks;
drop policy tasks_delete on public.tasks;
drop policy tasks_update_own_status on public.tasks;

create policy tasks_insert on public.tasks for insert
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id()))
    and not public.task_domain_externally_owned(project_id));

create policy tasks_update on public.tasks for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id())))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id())));

create policy tasks_delete on public.tasks for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id()))
    and not public.task_domain_externally_owned(project_id));

create policy tasks_update_own_status on public.tasks for update
  using (org_id = auth_org_id() and assignee_id = (select auth.uid())
    and not public.task_domain_externally_owned(project_id))
  with check (org_id = auth_org_id() and assignee_id = (select auth.uid())
    and not public.task_domain_externally_owned(project_id));


-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — both trigger bodies, 0146 §3's VERBATIM with exactly one substitution: the ownership
-- predicate. Every column list, every early return, every message is byte-preserved — the messages
-- in particular are asserted verbatim by existing pgTAP, and this migration is not the place to
-- change behaviour that is already correct.
--
-- ⚑ Why they must move in THIS file rather than a follow-up: with a NULL project,
-- `project_domain_externally_owned` returned false by accident, so both bodies silently took their
-- not-externally-owned branch. `enforce_assignee_status_only`'s column pin then still applied, but
-- for a reason nobody had decided — and `stamp_task_completed_at`'s service-role bypass evaluated
-- false, so a ClickUp mirror write would have had its explicitly-supplied `completed_at`
-- OVERWRITTEN from `status`, with no error. Latent today only because `mintMirror` throws on a
-- missing project. Making the column nullable is what arms it.
create or replace function public.enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     and public.task_domain_externally_owned(new.project_id) then
    return new;
  end if;
  if public.task_domain_externally_owned(new.project_id) then
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

create or replace function public.stamp_task_completed_at() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     and public.task_domain_externally_owned(new.project_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'Done' then now() else null end;
  elsif new.status = 'Done' and old.status is distinct from 'Done' then
    new.completed_at := now();
  elsif new.status is distinct from 'Done' and old.status = 'Done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end $$;
