# Task groups roll up to a milestone

Issue #2679 (OD-SCOPE-12, map #2516). Status: **Approved 2026-11-21; built**. Size S. Not money path. Settings: none.
Plan: `docs/plans/2026-11-21-task-group-milestone-rollup.md`. Migrations: 1395, 1396.

**Job story.** When tasks are grouped, I want the group's progress to roll up to a milestone, so the milestone
reflects its tasks.

## 1. AS-IS (cited against origin/dev)

- A milestone is `project_milestones` (`0023_delivery_milestones.sql`): per project, `weight`, nullable `input_pct`.
  Shown to users as **Phase** (DD-VOCAB-1).
- Today's only "grouping" of tasks is `tasks.milestone_id` (OD-DEL-3: two levels, milestone to tasks; Tasks tab
  groups by milestone, FR-DEL-014) and `tasks.parent_task_id` (subtasks, `0140`). **No separate task group exists**
  (searched: `docs/decisions.md`, specs, plans, `supabase/migrations`, `pmo-portal/src/lib/db`; the only hits for
  "task group" are an unrelated integrations checklist and this ticket's OD-SCOPE-12 line).
- Calculated % rule (OD-DEL-4, live bodies: `get_project_milestones` in `0145`, `get_projects_delivery` in
  `1142`): done / total over tasks with `milestone_id = milestone`, `parent_task_id is null`, `archived_at is null`;
  null when none; effective % = input, else calculated, else 0. A milestone's project share is weight-weighted
  (OD-DEL-5).
- A task's milestone must belong to the task's own project (`0202`, composite FK).

## 2. Decision

A group is a **new, small, per-project record** because none exists to reuse (OQ-TGM-1 confirms). It is the only new
entity: `task_groups (id, org_id, project_id, name, milestone_id null, sort_order, archived_at)` and a nullable
`tasks.task_group_id`. No nesting, no group progress of its own beyond what is derived.

## 3. Roll-up rule (plain)

A task **counts toward milestone M** when it is top-level (no parent), not archived, and either
(a) its own `milestone_id` is M (today's rule), or (b) its group is linked to M.
A task is counted once per milestone even if both (a) and (b) hold. Calculated % of M = done counted tasks / counted
tasks, null when none; "Done" is `status = 'Done'`. Effective % and the weighted project share are unchanged.
A group's own progress, shown on the group, is done / total of its top-level, non-archived tasks.

**Unchanged case:** a milestone with no linked group counts exactly (a) only, i.e. today's result, to the digit.
Tasks that sit in a group which is not linked to a milestone count only through their own `milestone_id`, as today.
Unlinking a group (or archiving it) returns its milestone to rule (a) alone. Archiving or deleting a group never
deletes its tasks (FK `on delete set null`).

## 4. Requirements (EARS)

- **FR-TGM-001** The system shall let an authorised user create, rename, archive and delete a task group in a project.
- **FR-TGM-002** When a user assigns a task to a group, the system shall require the group and the task to be in the
  same project (`22023`/`42501`, uniform, as `0202`).
- **FR-TGM-003** When a user links a group to a milestone, the system shall require the milestone to be in the
  group's project. A group links to at most one milestone; a milestone may have many groups.
- **FR-TGM-004** Where a milestone has at least one active linked group, the calculated % shall follow section 3 rule
  (a) or (b), de-duplicated.
- **FR-TGM-005** Where a milestone has no active linked group, `get_project_milestones` and `get_projects_delivery`
  shall return exactly what they return today.
- **FR-TGM-006** The roll-up shall be one pure function `milestoneProgress(tasks, groups)` in
  `pmo-portal/src/lib/delivery/milestoneRollup.ts`, mirrored by the SQL, with a parity test over shared fixtures.
- **FR-TGM-007** While the caller is not Admin or Project Manager, the system shall give no create, edit, link or
  assign affordance, and the database shall refuse the write (OD-DEL-7). An assignee or creator Engineer shall not be able to
  change `task_group_id`: on update the existing column allow-lists (0355 body of `enforce_assignee_status_only`)
  already exclude it; on insert a new trigger (`guard_task_group_write`, 1395) refuses it. Executive keeps the same
  task write as for `milestone_id` (the group table itself is Admin and Project Manager only).
- **FR-TGM-008** Every read and write shall be scoped to the caller's organisation (RLS, `org_id` stamped by default).
- **FR-TGM-009** All new text shall exist in English and Bahasa Indonesia; the word is "Task group".

## 5. Acceptance criteria

- **AC-TGM-001 (pgTAP)** Given a milestone M with 2 direct tasks (1 Done) and no linked group, when
  `get_project_milestones` and `get_projects_delivery` run, then M reads 50% and the project share is identical to the
  values before this migration.
- **AC-TGM-002 (pgTAP)** Given a group G linked to M with 3 tasks (2 Done), then M's task count is 5 and its
  calculated % is 60 (3 Done of 5).
- **AC-TGM-003 (pgTAP)** Given a task that is directly on M and also in G (linked to M), then it counts once.
- **AC-TGM-004 (pgTAP)** Given G unlinked, or archived, then M returns to its direct tasks only. Subtasks and
  archived tasks of G never count.
- **AC-TGM-005 (pgTAP)** Given a task in project A and a group of project B (or a milestone of B for the group), then
  the write is refused.
- **AC-TGM-006 (pgTAP)** Given Project Manager and Admin, groups can be created and linked; given Engineer (also as
  task assignee), Finance, Executive, the write is refused and `task_group_id` is unchanged.
- **AC-TGM-007 (pgTAP)** Given a second organisation, its groups and tasks never read or move the first organisation's
  milestone, and a group id from org B cannot be linked from org A.
- **AC-TGM-008 (Unit)** `milestoneProgress` returns the section 3 results for: no group (equals today), group only,
  overlap, archived/subtask/ungrouped, empty (null), all done (100).
- **AC-TGM-009 (Unit)** TS and SQL parity: the same fixtures give the same percentages.
- **AC-TGM-010 (Unit, RTL)** The task group manager (and the task form's group select) is offered only to a user who
  `can()` edit a milestone, and renders nothing for anyone else while the project has no group. The rolled-up phase
  % itself comes from the database (AC-TGM-002), so the milestone strip needs no change.

## 6. Out of scope

Nested groups, group weights, drag to reorder, group-level due dates, a Gantt row per group, any billing meaning
(milestones stay progress-only, OD-BILL-1).

## 7. Owner questions

- **OQ-TGM-1 (DECIDED: new record, approved)** No task group exists today; confirm a new per-project group record (recommended) rather than treating a
  parent task with subtasks as the group. Subtasks never move a percentage (OD-INT-9), so a parent-task group would
  change that rule.
- **OQ-TGM-2 (DECIDED: union rule, approved)** A task directly on milestone A whose group is linked to milestone B counts toward both (the union
  rule). Recommended; the alternative (group link wins) would change today's counts for tasks that carry both.

## 8. Built as (deviations noted)

- `tasks.task_group_id` is deliberately left out of the generated `tasks` Row type so existing task fixtures stay
  valid; code reads it through `WithTaskGroup` (`src/lib/db/taskGroups.ts`).
- Group CRUD rides on the existing milestone repository (`repositories.milestone.*TaskGroup*`) instead of a new
  aggregate key, so the repository registry tests stay unchanged.
- The Tasks tab is unchanged for a project with no group: the manager opens from the toolbar overflow menu ("Task groups", managers only) and stays until a group exists.
- Rename of a group is not offered in the panel (create, link, archive, delete only); `updateTaskGroup` supports it.
