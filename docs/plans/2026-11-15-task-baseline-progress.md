# Task baseline and percent complete implementation plan

> Planning artifact. Follow Orca dispatch and TDD; do not implement before the spec is signed off.

**Goal:** baseline dates drawn behind Gantt bars, plus percent complete with a display rollup.
**Spec:** `docs/specs/task-baseline-progress.spec.md`. **Migration:** `NNNN_task_baseline_progress.sql` (number on request; recheck
`git ls-tree -r --name-only origin/dev supabase/migrations`), rollback `rollback/NNNN_task_baseline_progress_down.sql`.

**Constraints:** no change to `get_project_milestones`/`get_projects_delivery` (OD-INT-9); no critical path; DB work under
`scripts/with-db-lock.sh`; local gate per CLAUDE.md (touched tests only).

## Tasks (each 2-5 min: red, green, rerun)

1. [ ] `supabase/tests/task_baseline_progress.test.sql` (AC-001, 005, 008, 011): bad pairs, percent bounds, unchanged milestone
   RPC output, Viewer denied. Run red: `scripts/with-db-lock.sh supabase test db supabase/tests/task_baseline_progress.test.sql`.
2. [ ] Migration `NNNN`: `alter table tasks add column baseline_start date, add column baseline_end date, add column percent_complete smallint;`
   with checks `tasks_baseline_pair` (`(baseline_start is null) = (baseline_end is null)` and `baseline_end >= baseline_start`)
   and `tasks_percent_range` (`percent_complete between 0 and 100`). Rollback drops the checks then the columns.
3. [ ] Extend `enforce_assignee_status_only` (copy the live body, edit only the assignee branch): assignee may change
   `percent_complete`, still not baseline (per Q2). Externally-owned branch unchanged (columns not pinned). Pgtap case added.
4. [ ] RPC `set_project_baseline(p_project_id uuid, p_reset boolean default false) returns table(set_count int, skipped_count int)`
   — security invoker, task-write role check, updates dated non-archived tasks (`baseline_start is null or p_reset`).
   pgTAP for AC-002/003. Grant to `authenticated`, revoke from `anon`.
5. [ ] Regenerate types (`npm run types` equivalent in repo) and extend `TaskPatch`/`updateTask` in `pmo-portal/src/lib/db/tasks.ts`
   with `baseline_start`, `baseline_end`, `percent_complete`; add `setProjectBaseline(projectId, reset)` and repository wrapper.
6. [ ] `pmo-portal/src/lib/tasks/taskProgress.ts` + test (AC-006/007): `effectivePercent(task)` and `rolledUpPercent(parent, subtasks)`
   (duration-weighted when dated, else equal).
7. [ ] `src/lib/gantt/reuiModel.ts`: pass `baselineStart` (start day) / `baselineEnd` (inclusive end + one day, like bars), and
   `progress` to each event; test `reuiModel.baseline.test.ts` incl. drag leaving baseline (AC-009).
8. [ ] `ProjectGantt.tsx` + `TasksTab.tsx`: variance column ("+3d"; i18n en/id; sr text, AC-010); Set/Reset baseline action gated by
   `usePermission` with `ConfirmDialog` for reset; percent field in the task form via `TextField`. Tests under `__tests__/`.
9. [ ] e2e `e2e/AC-TBP-020-baseline-journey.spec.ts`: set baseline, drag a bar, see baseline stay and "+Nd". Run `scripts/e2e-local.sh AC-TBP-020`.
10. [ ] Gates: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, `node scripts/affected-e2e.mjs`,
    `scripts/ux-proof.sh` on the project plan route. Update roadmap #1571 and `docs/glossary.md` (baseline, percent complete).

## Traceability

| AC | Layer | Test |
|---|---|---|
| 001, 005, 008, 011 | pgTAP | `task_baseline_progress.test.sql` |
| 002, 003 | pgTAP + Vitest | same; `TasksTab.baseline.test.tsx` |
| 004 | Vitest | `TasksTab.baseline.test.tsx` |
| 006, 007 | Vitest | `taskProgress.test.ts` |
| 009, 010 | Vitest | `reuiModel.baseline.test.ts`, `ProjectGantt.baseline.test.tsx` |
| journey | e2e | `AC-TBP-020-baseline-journey.spec.ts` |

## Owner questions

1. Percent entry free 0-100 or steps of 10? Recommend: free integer.
2. May an assignee set their own task's percent? Recommend: yes for percent, no for baseline.
3. Baseline whole project only, or per task too? Recommend: both.
