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
--
-- ⛔ AND THE EXISTS WAS DOING A **THIRD** JOB THAT NOBODY WROTE DOWN. `projects_select` carries
-- `is_active_member()`, so an OFFBOARDED member — `auth_role()` reads `profiles.role` with NO status
-- filter — saw no project, failed the EXISTS, and was refused. The `project_id is null` disjunct
-- deletes that subquery, and with it the only standing check on the write path: a disabled PM
-- holding an unexpired token could INSERT project-less tasks. Found by the #525 security audit,
-- which built the probe; the earlier draft of this comment identified two of the three jobs and
-- generalised a single-threat mutation to all of them.
--
-- So standing is now STATED on all four policies rather than inherited from a subquery that may or
-- may not run. This is the migration's own thesis applied to itself: an answer that falls out of a
-- NULL comparison is not a decision.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
drop policy tasks_insert on public.tasks;
drop policy tasks_update on public.tasks;
drop policy tasks_delete on public.tasks;
drop policy tasks_update_own_status on public.tasks;

create policy tasks_insert on public.tasks for insert
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id()))
    and not public.task_domain_externally_owned(project_id));

create policy tasks_update on public.tasks for update
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id())))
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id())));

create policy tasks_delete on public.tasks for delete
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = tasks.project_id and p.org_id = auth_org_id()))
    and not public.task_domain_externally_owned(project_id));

create policy tasks_update_own_status on public.tasks for update
  using (org_id = auth_org_id() and public.is_active_member() and assignee_id = (select auth.uid())
    and not public.task_domain_externally_owned(project_id))
  with check (org_id = auth_org_id() and public.is_active_member() and assignee_id = (select auth.uid())
    and not public.task_domain_externally_owned(project_id));


-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚑ NOT FIXED HERE, and the attempt is worth recording: the pin is a DENY-LIST, so every column
-- added to `tasks` since 0016 is assignee-writable by default — `milestone_id`, `tombstoned_at`,
-- `source_updated_at`. An Engineer assignee can point their task at ANOTHER project's milestone and
-- move that project's delivery percentage. Adding `milestone_id` to the list was tried and REVERTED:
-- it breaks `seed.sql`, because the pin's first branch tests `auth_role() in (…)` and a server-side
-- writer with no JWT answers NULL, so legitimate owner writes fall through to the assignee branch.
-- The real fix is inverting the deny-list to an allowlist WITH a server-authority exemption — its
-- own ticket, its own diff, its own mutation battery. Pre-existing and not armed by this change.
--
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — the parenting guard, which THIS MIGRATION made vacuous and must therefore fix in the same
-- file (FR-FCT-022/023: the reconciliation of the NULL cases is ONE change, not two).
--
-- ⛔ `0140:57-59` compares `parent.project_id is distinct from new.project_id`. With BOTH sides NULL
-- that is FALSE, so the guard does not fire — and `project_id` could not be NULL until §1, which
-- means §1 is what armed it. The FK alone does not save us: it is an unqualified reference to
-- `tasks(id)` and does not consult `org_id`.
--
-- The rule the guard has always meant is "a subtask belongs with its parent". Stated for both cases:
--   • both have a project  → the projects must match (0140's rule, unchanged)
--   • either has none      → they must at least be in the SAME ORG
-- The org check is not a weaker fallback bolted on; it is the floor that was previously implied by
-- the project comparison and is now stated, because the project comparison can no longer imply it.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.check_tasks_parent_same_project()
  returns trigger language plpgsql set search_path = public as $$
declare
  v_parent_project uuid;
  v_parent_org     uuid;
  v_found          boolean;
begin
  if new.parent_task_id is null then
    return new;
  end if;
  -- One read, and it must be the OWNER's read: this trigger is invoker-rights, so a parent the
  -- caller cannot SEE would otherwise return NULL for both columns and look like a project-less
  -- same-org parent. `found` distinguishes "no such row" from "a row with NULLs".
  select t.project_id, t.org_id, true
    into v_parent_project, v_parent_org, v_found
    from public.tasks t where t.id = new.parent_task_id;

  if not coalesce(v_found, false) then
    raise exception 'parent task must be in the same project' using errcode = '42501';
  end if;

  -- ⚑ THE ORG FLOOR — always checked, whatever the projects say. Before §1 this was implied: a
  -- non-null project comparison could not pass across orgs because two orgs cannot share a project.
  -- With NULLs on both sides that implication is gone, so the floor is stated.
  --
  -- ⚑ MUTATION-VERIFIED, and stated precisely because the easy claim is wrong: the floor and the
  -- `not found` branch above are REDUNDANT for the cross-org threat — removing either alone leaves
  -- AC-FCT-019 green, because an invisible parent yields both "no row" and a NULL org. Removing
  -- BOTH reddens it. So neither is individually load-bearing and the pair is; do not delete one on
  -- the evidence that the suite still passes. They fail closed for different reasons — one on
  -- visibility, one on identity — and a future change that makes the parent visible (a wider SELECT
  -- policy, a definer reader) would leave only the floor standing.
  if v_parent_org is distinct from new.org_id then
    raise exception 'parent task must be in the same project' using errcode = '42501';
  end if;

  -- 0140's rule, unchanged, for the case it was written for.
  if v_parent_project is distinct from new.project_id then
    raise exception 'parent task must be in the same project' using errcode = '42501';
  end if;
  return new;
end; $$;
-- ⚑ NO TRIGGER IS RE-CREATED. `tasks_check_parent_same_project` (0140:66) binds to this function by
-- OID and `create or replace` keeps it. A drop-and-recreate would leave a duplicate under a new name
-- and a changed firing order — 0125's incident, and 0189's standing rule.
