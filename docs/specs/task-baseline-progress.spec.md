# Task baseline dates and percent complete

Issue #1574 (map #791). Status: **Draft, 2026-11-15** — awaiting owner sign-off of §8. Executor on sign-off: Orca
worker per `docs/orca-dispatch.md` (plan `docs/plans/2026-11-15-task-baseline-progress.md`). Migration: `NNNN`
(number on request). No money path, no SoD change, no new role.

**Job story.** When I run a project plan, I want to freeze what we promised for each task and see the live dates and
progress drawn against it, so that I can tell at a glance which tasks have slipped and how far along the work is.

## 1. AS-IS (shipped, cited against `origin/dev`)

- `tasks` carries `status` (`To Do`/`In Progress`/`Done`/`Blocked`, `0001_init_schema.sql:23`), `start_date`,
  `end_date`, `parent_task_id` (`0140_task_model_fields.sql`). It has **no** baseline columns and **no** percent field.
- Phase (milestone) percent is derived server-side: Done top-level tasks / top-level tasks, or the entered
  `input_pct` (`get_project_milestones`, `0141_subtask_rollup_exclusion.sql`). **OD-INT-9 (binding): subtasks never move
  a phase or project percentage.** Project `delivery_pct` rolls up from phases.
- The Gantt (`pmo-portal/pages/project-detail/ProjectGantt.tsx`, model `src/lib/gantt/reuiModel.ts`) draws one bar per
  top-level dated task; dragging calls `taskPatchFromRange` and saves via `onReschedule`. The vendored Gantt
  component already accepts per-bar `progress` (0-100) and `baselineStart`/`baselineEnd` (`gantt-types.tsx`); the app
  passes neither.
- The column-pin trigger `enforce_assignee_status_only` (live body `0355_finance_task_scope.sql:39`; introduced by
  `0016`, last reshaped before that by `0206_tasks_meeting_parent.sql:69`) restricts non-managers to status changes,
  and pins every native field while tasks are externally owned.
- `scripts/prior-art.sh` finds no prior ruling on baseline or task percent (sources searched: ADRs, migrations,
  hooks, decisions, issues; absence is not proof).

## 2. Scope

In: baseline start/end per task; a "Set baseline" action; baseline drawn behind each bar; task percent complete
(manual, with a status-derived default); rollup of percent to parent tasks for display. Out: critical path (the
ticket excludes it in v1), resource levelling, baseline history/versions, per-task weights, any change to phase or
project `delivery_pct` (OD-INT-9 stands).

## 3. Terms

- **Baseline**: the planned start/end frozen for a task at a point in time. Stored, never derived.
- **Percent complete**: 0-100 integer. **Effective percent** = the entered value if set; else 100 when status is
  Done, else 0.
- **Rolled-up percent** (display only): for a task with subtasks, the mean of its subtasks' effective percents,
  duration-weighted where both dates exist, else equally weighted.

## 4. Functional requirements (EARS)

### Baseline
- **FR-001** The system shall store a nullable `baseline_start` and `baseline_end` date on each task, with
  `baseline_end >= baseline_start` when both are set and neither set without the other.
- **FR-002** When a user with task-write authority chooses "Set baseline" on a project, the system shall copy each
  dated, non-archived task's current `start_date`/`end_date` into its baseline in one transaction.
- **FR-003** While a task already has a baseline, the system shall not overwrite it unless the user confirms
  "Reset baseline" for that task or project.
- **FR-004** Where a task has no dates, the system shall leave its baseline empty and report how many tasks were skipped.
- **FR-005** The system shall let a user with task-write authority clear a task's baseline.

### Percent complete
- **FR-006** The system shall store a nullable `percent_complete` integer 0-100 on each task.
- **FR-007** When a task's status becomes Done and no percent was entered, the effective percent shall read 100;
  a task entered at a percent and later moved to Done keeps its entry until set to 100 by the user.
- **FR-008** The system shall compute a parent task's rolled-up percent from its subtasks as defined in §3.
- **FR-009** The system shall not change phase percent, project `delivery_pct`, the S-curve or any figure that
  OD-INT-9 governs (subtasks and this field never move them).

### Presentation
- **FR-010** The Gantt shall draw each baselined bar's baseline window behind it and its effective/rolled-up percent
  as the bar's progress fill.
- **FR-011** The task list and Gantt row shall show the variance in days between actual and baseline end
  ("+3d", "-1d"), and nothing for a task with no baseline.
- **FR-012** While a bar is dragged or resized, the baseline shall stay fixed.
- **FR-013** Every new label shall be translated (en, id) and the variance shall be exposed to assistive tech as text.

### Authority
- **FR-014** Baseline and percent writes shall follow the existing task-write policy (`can('update','task',ctx)`;
  RLS authority). The enhancement columns shall be free of the externally-owned pin (like `milestone_id`) unless the
  owner rules otherwise (Q2).
- **FR-015** The system shall not let a role without task-write change baseline.

## 5. Non-functional

- **NFR-001** Existing tasks read as no baseline and effective percent from status; no backfill.
- **NFR-002** Set-baseline for a project of 2,000 tasks completes in one statement.
- **NFR-003** Rollups are computed in the client model from already-fetched rows; no new RPC.
- **NFR-004** Reversible migration; `org_id` seam unchanged (new columns inherit the row's RLS).

## 6. Acceptance criteria

- **AC-001** (FR-001) Given a task, When baseline_end is before baseline_start, or only one is set, Then the write
  is rejected by the database.
- **AC-002** (FR-002, FR-004) Given a project with 3 dated and 1 undated task, When Set baseline runs, Then 3 tasks
  hold their current dates as baseline and the result reports 1 skipped.
- **AC-003** (FR-003) Given a baselined task, When Set baseline runs again without confirmation, Then its baseline is
  unchanged; with Reset confirmed, it takes the current dates.
- **AC-004** (FR-005) Given a baselined task, When Clear baseline is chosen, Then both baseline dates are null.
- **AC-005** (FR-006) Given a task, When percent is 101 or -1, Then the write is rejected.
- **AC-006** (FR-007) Given an untouched Done task, Then effective percent is 100; Given a task entered at 40 then
  marked Done, Then it shows 40 until edited.
- **AC-007** (FR-008) Given a parent with two subtasks at 100 and 0 (equal duration), Then the parent shows 50.
- **AC-008** (FR-009) Given tasks with percents set, Then `get_project_milestones` and `get_projects_delivery`
  return the same values as before.
- **AC-009** (FR-010, FR-012) Given a baselined task, When the Gantt renders, Then a baseline window and a progress
  fill appear; When the bar is dragged, Then the baseline window does not move.
- **AC-010** (FR-011, FR-013) Given a task ending 3 days after baseline, Then "+3d" shows with a text alternative;
  a task with no baseline shows no variance.
- **AC-011** (FR-014, FR-015) Given a role without task-write (e.g. Viewer), Then Set baseline and percent controls
  are absent, and a direct write is denied by RLS (pgTAP).

## 7. Traceability (owning layer, ADR-0010)

| AC | Layer | Test |
|---|---|---|
| 001, 005, 008, 011 | pgTAP | `supabase/tests/task_baseline_progress.test.sql` |
| 002, 003, 004 | pgTAP (RPC) + Vitest (confirm dialog) | same file; `TasksTab.baseline.test.tsx` |
| 006, 007 | Vitest | `src/lib/tasks/taskProgress.test.ts` |
| 009, 010 | Vitest (model + component) | `src/lib/gantt/__tests__/reuiModel.baseline.test.ts`, `ProjectGantt.baseline.test.tsx` |
| journey | Playwright (one) | `e2e/AC-TBP-020-baseline-journey.spec.ts` |

## 8. Open questions (recommended default each)

1. Percent entry: free 0-100, or steps of 10? **Recommend free integer.**
2. May an assignee set their own task's percent (status-only today)? **Recommend yes for percent, no for baseline.**
3. Baseline scope: whole project at once only, or per task as well? **Recommend both.**
