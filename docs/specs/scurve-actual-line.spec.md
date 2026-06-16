# Feature: S-Curve Actual Progress Line

**Spec ID:** SCA  
**Status:** Draft — 2026-06-16  
**Plan source (locked decisions):** `docs/plans/2026-06-16-scurve-actual-line.md`  
**Replaces:** `OBS-SCA-001` (the single "actual to date" dot)

---

## Glossary

**Actual progress (S-curve):** The cumulative weighted percentage of scope completed by a given
calendar date, computed per the hybrid rule: task-tracked milestones contribute at task
`completed_at` (or `due_date` proxy when `completed_at` is absent but the task is Done); manually
overridden milestones (`input_pct` set) and task-less milestones contribute their `input_pct` at the
milestone `target_date`. All proxy dates are clamped ≤ today. The series endpoint at `asOf` equals
`actualToDate` by construction.

**Hybrid source rule:** Per-milestone selection of the completion-date signal:
- *Has tasks AND no `input_pct` override* → task-level granularity: each Done task contributes
  `w · (1 / total_tasks)` to the actual at `completed_at` (real) or `due_date` (proxy, clamped ≤ today).
- *Has `input_pct` override OR no tasks* → milestone-level: contributes `w · input_pct` placed at
  `target_date` (proxy, clamped ≤ today).

**Backfill date:** A proxy date (task `due_date` or milestone `target_date`) used for currently-Done
tasks/milestones that predate migration `0034`. These are estimates, not recorded history.

**Monotone planned line:** The existing S-curve planned series — smooth/monotone, one point per dated
milestone, rising from 0% to 100%.

---

## Job Story

> When I am reviewing a project's delivery health on the S-curve chart,
> I want to see a cumulative actual-progress line that rises over time alongside the planned line,
> so I can immediately spot schedule slippage or acceleration without manually cross-referencing
> individual task statuses.

---

## Overview

Today the S-curve chart shows a planned cumulative line (one point per dated milestone) and a
**single dot** representing "actual to date" — because `effective_pct` is a snapshot value with no
historical record (`OBS-SCA-001`). This feature replaces that dot with a **real multi-point actual
line**, stepping up at each task's completion date (or a proxy for legacy/override cases), plotted
against the existing planned line.

The implementation adds `tasks.completed_at` (server-stamped, trigger-enforced), extends
`buildSCurve` to accept task data and emit a stepped actual series, and re-renders
`ProjectSCurve` with the second `<Line>`. A chart caveat discloses that dates before today's live
start are estimated.

---

## Observed / Legacy Behaviour Being Replaced

### OBS-SCA-001: Single actual dot
The S-curve chart currently emits exactly one `actual`-valued point in the `SCurvePoint[]` array:
`{ date: asOf, actual: actualToDate }`. All other points carry `actual: null`. The chart therefore
renders a lone dot, not a connected line, when the actual line has only one data point.

---

## Functional Requirements

### FR-SCA-001: `completed_at` column
The `tasks` table shall store a `completed_at timestamptz` column, nullable, representing the
server-recorded instant the task most recently entered `Done` status.

### FR-SCA-002: Server-enforced trigger — into-Done stamps
When a task's `status` is set to `'Done'` (INSERT or UPDATE), the system shall set `completed_at =
now()` via a `BEFORE INSERT OR UPDATE` trigger on the `tasks` table (`stamp_task_completed_at`).

### FR-SCA-003: Server-enforced trigger — leaving-Done clears
When a task's `status` changes away from `'Done'` (UPDATE only), the system shall set
`completed_at = null` via the same trigger.

### FR-SCA-004: Server-enforced trigger — non-status updates preserve
While a task's `status` remains unchanged in an UPDATE that touches other columns, the system shall
leave `completed_at` unmodified.

### FR-SCA-005: Server-enforced trigger — INSERT-as-Done stamps
When a task is INSERTed with `status = 'Done'`, the system shall set `completed_at = now()`.

### FR-SCA-006: Backfill for existing Done tasks
When migration `0034` is applied, the system shall backfill `completed_at` on all existing rows
where `status = 'Done'` using `COALESCE(due_date::timestamptz, updated_at)` as the best available
proxy.

### FR-SCA-007: DAL type update
The `TaskWithRefs` TypeScript type and the `tasks` SELECT in `src/lib/db/tasks.ts` shall include
`completed_at: string | null` so all consumers (Tasks list, Gantt, S-curve) receive the field.

### FR-SCA-008: Actual series — hybrid source computation
When `buildSCurve(milestones, asOf, tasks?)` is called with a non-empty `tasks` array, the system
shall emit actual `SCurvePoint` entries by applying the hybrid source rule:
- For each milestone with tasks and no `input_pct` override: one point per Done task, placed at
  `completed_at` (real) **else** `due_date` (proxy), both clamped to `asOf`. Contribution =
  `w · (1 / total_tasks_in_milestone)` each.
- For each milestone with an `input_pct` override or no tasks: one point placed at `target_date`
  clamped to `asOf`. Contribution = `w · input_pct / 100 · 100`.
- `actual(d) = round2(Σ contributions by date d / totalWeight)`.

### FR-SCA-009: Actual series — monotone guarantee
The system shall emit actual points in ascending date order and accumulate contributions so that the
`actual` value is non-decreasing across the series (cumulative sum, never less than the prior point).

### FR-SCA-010: Actual series — endpoint equals headline gauge
The last actual point's value at `asOf` shall equal `actualToDate` (the weight-weighted rollup of
current `effective_pct` across all milestones) within floating-point `round2` precision.

### FR-SCA-011: Actual series — single-point fallback
While `buildSCurve` is called with an empty or absent `tasks` array, the system shall emit exactly
one actual point at `asOf` valued `actualToDate`, matching the current `OBS-SCA-001` behavior (no
crash, no fabricated history).

### FR-SCA-012: Chart — render two distinct lines
When `ProjectSCurve` receives ≥2 actual points from `buildSCurve`, the system shall render:
- A dashed `<Line type="monotone">` for `planned` (existing style, unchanged).
- A solid `<Line type="linear">` for `actual` — connected over its real date coordinates,
  visually distinct from the single-dot fallback.

### FR-SCA-013: Chart — drop lone-dot path when series ≥2
While the actual series contains ≥2 points, the system shall suppress the single large dot
rendering (the `dot={{ r: 4 }}` on the actual `<Line>`) in favour of the connected-line rendering.

### FR-SCA-014: Chart — backfill caveat
The system shall display a chart sub-caption: "Completion dates before today are estimated;
live tracking starts now." This caveat replaces the current `OBS-SCA-001` honesty caption
("Actual reflects current progress as of today; historical actuals are not yet tracked.").

### FR-SCA-015: Chart — `aria-label` summary reflects line
The `<figure aria-label>` summary shall describe both lines, e.g. "Project S-curve: actual
to date N%, plan expected M% by today."  (This requirement already holds; re-confirmed binding
when both lines are present.)

### FR-SCA-016: Planned line unchanged
The planned line (`type="monotone"`, dashed, unchanged data source) shall not be affected by this
feature in shape, style, or data.

---

## Non-Functional Requirements

### NFR-SCA-001: Actual endpoint invariant
The actual series' final point value at `asOf` MUST equal `actualToDate` (the current headline
gauge shown in the `<figcaption>`) within `round2` precision. A drift between the line endpoint and
the gauge is a correctness bug.

### NFR-SCA-002: Backfill-date caveat (honesty)
Backfilled dates (task `due_date`, milestone `target_date`) are estimates, not recorded history. The
chart MUST carry a visible caveat disclosing this (FR-SCA-014). The caveat MUST be removed or
updated once all data points on-screen originate from real `completed_at` values (future milestone).

### NFR-SCA-003: Server-enforced trigger (ADR-0019)
`completed_at` MUST be set and cleared by the DB trigger, not the application. Client-side writes
to this column MUST be prevented (column default + trigger overwrite is sufficient; the RLS write
policy need not expose it).

### NFR-SCA-004: Performance — no extra round-trip
`ProjectSCurve` already loads tasks through the project-detail page. Passing the already-loaded
`tasks` into `buildSCurve` MUST NOT add any new network request (NFR-SC-PERF-001 preserved).

### NFR-SCA-005: Pure builder
`buildSCurve` MUST remain a pure function (no side effects, deterministic, no I/O). Passing the
same arguments twice MUST produce byte-identical output.

### NFR-SCA-006: RLS unaffected
The migration adding `completed_at` and the trigger MUST NOT alter the existing RLS policies on
`tasks`. The trigger runs with definer rights only to stamp the column; it MUST NOT bypass or
widen the `tasks_write` policy.

### NFR-SCA-007: Typecheck zero errors
After the DAL change (FR-SCA-007), `npm run typecheck` MUST report zero errors. All consumers of
`TaskWithRefs` must compile without casts.

---

## Acceptance Criteria

### AC-SCA-001: Rising actual line on a project with completed tasks
**Owning test layer:** Unit (Vitest — `sCurve.test.ts`)

```
Given a delivery project with ≥2 tasks that are status='Done' (different completion dates),
  each assigned to weighted milestones (no input_pct override),
When buildSCurve(milestones, asOf, tasks) is called,
Then the returned SCurveModel contains ≥2 SCurvePoints where actual is non-null,
  and the actual values form a strictly rising (or equal) sequence,
  and the last actual value equals actualToDate.
```

### AC-SCA-002: Actual value at asOf equals the headline gauge
**Owning test layer:** Unit (Vitest — `sCurve.test.ts`)

```
Given milestones with a mix of Done and in-progress tasks across multiple weights,
When buildSCurve(milestones, asOf, tasks) is called,
Then the actual value of the final point (at asOf) equals model.actualToDate
  (within round2 floating-point precision),
  matching the value shown in the <figcaption> gauge.
```

### AC-SCA-003: No crash — project with no completed tasks renders a single actual point
**Owning test layer:** Unit (Vitest — `sCurve.test.ts`)

```
Given a delivery project whose tasks all have status != 'Done'
  (and no milestones have input_pct),
When buildSCurve(milestones, asOf, tasks) is called,
Then the returned points array contains exactly one SCurvePoint where actual is non-null
  (at asOf with value 0 or actualToDate),
  and buildSCurve does not throw.
```

### AC-SCA-004: Hybrid source — manual override milestone uses target_date
**Owning test layer:** Unit (Vitest — `sCurve.test.ts`)

```
Given a milestone M1 (weight=2, input_pct=60, target_date='2025-03-01')
  and a milestone M2 (weight=2, no input_pct, 1 Done task with due_date='2025-04-01'),
When buildSCurve([M1, M2], '2026-06-16', tasks) is called,
Then the actual series contains a point at or near '2025-03-01' carrying M1's weighted contribution,
  a point at or near '2025-04-01' carrying M2's task contribution,
  and both are clamped to ≤ asOf.
```

### AC-SCA-005: Hybrid source — task-less milestone uses target_date with input_pct=0
**Owning test layer:** Unit (Vitest — `sCurve.test.ts`)

```
Given a milestone with weight=1, no tasks, no input_pct (effective_pct=0), target_date='2025-06-01',
When buildSCurve([milestone], '2026-06-16', []) is called,
Then the actual series contains one point at '2025-06-01' (clamped ≤ asOf) with actual value 0,
  and actualToDate equals 0.
```

### AC-SCA-006: Proxy dates clamped to asOf
**Owning test layer:** Unit (Vitest — `sCurve.test.ts`)

```
Given a Done task with due_date='2027-12-31' (future) and asOf='2026-06-16',
When buildSCurve is called with this task,
Then the task's actual contribution is placed at asOf (not at the future due_date).
```

### AC-SCA-007: Trigger stamps completed_at on status→Done
**Owning test layer:** Integration (pgTAP — `supabase/tests/0034_task_completed_at.test.sql`)

```
Given a task with status='To Do',
When UPDATE tasks SET status='Done' WHERE id=<task_id>,
Then SELECT completed_at FROM tasks WHERE id=<task_id> returns a non-null timestamptz
  approximately equal to now().
```

### AC-SCA-008: Trigger clears completed_at on leaving Done
**Owning test layer:** Integration (pgTAP — `supabase/tests/0034_task_completed_at.test.sql`)

```
Given a task with status='Done' (completed_at already set),
When UPDATE tasks SET status='In Progress' WHERE id=<task_id>,
Then SELECT completed_at FROM tasks WHERE id=<task_id> returns NULL.
```

### AC-SCA-009: Trigger preserves completed_at on non-status update
**Owning test layer:** Integration (pgTAP — `supabase/tests/0034_task_completed_at.test.sql`)

```
Given a Done task with completed_at set to T,
When UPDATE tasks SET title='new title' WHERE id=<task_id> (status unchanged),
Then SELECT completed_at FROM tasks WHERE id=<task_id> returns T (unchanged).
```

### AC-SCA-010: Trigger stamps completed_at on INSERT-as-Done
**Owning test layer:** Integration (pgTAP — `supabase/tests/0034_task_completed_at.test.sql`)

```
Given no prior tasks for a milestone,
When INSERT INTO tasks (status, ...) VALUES ('Done', ...),
Then SELECT completed_at FROM tasks WHERE id=<new_id> returns a non-null timestamptz.
```

### AC-SCA-011: Re-entering Done re-stamps a fresh completed_at
**Owning test layer:** Integration (pgTAP — `supabase/tests/0034_task_completed_at.test.sql`)

```
Given a task that was Done (completed_at=T1), then moved to 'In Progress' (completed_at=NULL),
When UPDATE tasks SET status='Done' WHERE id=<task_id>,
Then SELECT completed_at FROM tasks WHERE id=<task_id> returns a non-null timestamptz T2
  where T2 >= T1.
```

### AC-SCA-012: Chart renders two visually distinct lines
**Owning test layer:** Unit/RTL (Vitest — `ProjectSCurve.test.tsx`)

```
Given a project with ≥2 Done tasks at different dates,
When ProjectSCurve renders with real milestones + tasks data,
Then the rendered LineChart contains two <Line> elements:
  one with strokeDasharray set (planned — dashed),
  one without strokeDasharray (actual — solid),
  and the actual <Line> dataKey is 'actual'.
```

### AC-SCA-013: Backfill caveat is visible
**Owning test layer:** Unit/RTL (Vitest — `ProjectSCurve.test.tsx`)

```
Given ProjectSCurve renders with at least one actual data point,
When the component renders,
Then the DOM contains the text "Completion dates before today are estimated"
  (or its localized equivalent per FR-SCA-014).
```

### AC-SCA-014: End-to-end — completing a task moves the actual line
**Owning test layer:** E2E (Playwright — `e2e/AC-SCA-014-actual-line-moves.spec.ts`)

```
Given a delivery project open in the browser with at least one In-Progress task on the Timeline tab,
  and the S-curve shows no actual line (0 completions),
When the user changes that task's status to 'Done',
  and navigates to the project's Delivery > S-curve view,
Then the S-curve renders a visible actual line with ≥2 points
  (the new completion plus any prior Done tasks),
  and the line endpoint value matches the "Actual to date" gauge displayed in the legend.
```

---

## Error Handling

| Condition | Behaviour |
|---|---|
| `totalWeight === 0` (no weighted milestones) | `buildSCurve` returns `{ points: [], actualToDate: 0, plannedToDate: null }` — `ChartFrame` shows the empty state ("No dated milestones yet"), no crash. |
| No dated milestones (all undated) | Same as above — `points: []`, empty state. |
| Task `due_date` or milestone `target_date` is `NULL` for a Done task/override milestone | That task/milestone is skipped in the actual series; it still contributes to `actualToDate` (the denominator is `totalWeight`, not the dated count). |
| Future proxy date (> `asOf`) | Clamped to `asOf` before plotting (FR-SCA-008, AC-SCA-006). |
| DB trigger fails (unexpected) | Postgres rolls back the `tasks` UPDATE/INSERT; the application receives a constraint error and surfaces it through the existing `classifyMutationError` path. `completed_at` is never left in an inconsistent state. |
| `tasks` array provided but all tasks are non-Done | `buildSCurve` emits the single-point fallback (FR-SCA-011, AC-SCA-003); no crash. |

---

## Out of Scope

- Storing `completed_at` on milestones directly (task-level granularity suffices per plan decision 1).
- Milestone-level actual history (e.g. storing `effective_pct` per date). Deferred — the hybrid
  rule makes the actual series derivable client-side from task data.
- Removing the backfill caveat automatically once real data accrues (future milestone; would require
  tracking the first real `completed_at` per project vs. migration date).
- Color-differentiating planned vs. actual (DESIGN.md single-blue identity — style difference
  only: dashed vs. solid).
- Adversarial red-team / launch-gate security review (per ADR-0030 §E, this is a per-PR review,
  not a launch gate).

---

## Implementation TODO

### DB / Migration
- [ ] `supabase/migrations/0034_task_completed_at.sql` — ADD COLUMN `completed_at timestamptz`;
      trigger fn `stamp_task_completed_at()` (into-Done → `now()`, leaving-Done → `null`);
      backfill with `COALESCE(due_date::timestamptz, updated_at)` for existing Done rows.
- [ ] `supabase/tests/0034_task_completed_at.test.sql` — pgTAP: into-Done stamps; Done→In-Progress
      clears; non-status UPDATE preserves; INSERT-as-Done stamps; re-enter-Done re-stamps.
      Verify: `supabase test db`.

### DAL
- [ ] `src/lib/db/tasks.ts` — add `completed_at: string | null` to `TaskWithRefs`; include in
      the SELECT used by `getTasks` / `getTasksForProject`. Verify: `npm run typecheck` zero errors.

### Pure builder
- [ ] `src/lib/delivery/sCurve.ts` — extend `buildSCurve(milestones, asOf, tasks?)` signature;
      implement hybrid source rule; emit monotone actual series; keep single-point fallback
      when tasks absent/empty.
- [ ] `src/lib/delivery/sCurve.test.ts` — unit tests covering AC-SCA-001 through AC-SCA-006;
      monotonicity assertion; endpoint-equals-gauge; empty-completion fallback; clamping.

### Component
- [ ] `pages/project-detail/ProjectSCurve.tsx` — thread project tasks into `buildSCurve`;
      render actual `<Line type="linear">` (solid, no `strokeDasharray`) when ≥2 actual points;
      suppress lone-dot `dot={{ r: 4 }}` when series ≥2; update backfill caveat text (FR-SCA-014).
- [ ] `ProjectSCurve.test.tsx` — RTL tests covering AC-SCA-012 (two distinct lines) and
      AC-SCA-013 (caveat visible).
- [ ] Cosmetic tidy: de-dupe right-edge axis tick collision (duplicate "16 Jun '26"/"30 Jun")
      via `minTickGap` tuning (noted in the plan).

### E2E
- [ ] `e2e/AC-SCA-014-actual-line-moves.spec.ts` — complete a task, verify actual line appears
      and endpoint matches the gauge.

### Review & Ship
- [ ] Spec review (`spec-reviewer`) — verify ACs against this SDD.
- [ ] Code-quality review (`code-quality-reviewer`).
- [ ] Security audit (`security-auditor`) — confirm trigger cannot be bypassed; RLS on `tasks`
      unaffected; `completed_at` not writable via RLS policy (NFR-SCA-003/006).
- [ ] PR — migration `0034` + FE changes; gates production promote (owner-directed).

---

## Open Questions

None — all design decisions are resolved and locked in `docs/plans/2026-06-16-scurve-actual-line.md`.

---

## Traceability

| AC | Owning Layer | File |
|---|---|---|
| AC-SCA-001 | Unit (Vitest) | `src/lib/delivery/sCurve.test.ts` |
| AC-SCA-002 | Unit (Vitest) | `src/lib/delivery/sCurve.test.ts` |
| AC-SCA-003 | Unit (Vitest) | `src/lib/delivery/sCurve.test.ts` |
| AC-SCA-004 | Unit (Vitest) | `src/lib/delivery/sCurve.test.ts` |
| AC-SCA-005 | Unit (Vitest) | `src/lib/delivery/sCurve.test.ts` |
| AC-SCA-006 | Unit (Vitest) | `src/lib/delivery/sCurve.test.ts` |
| AC-SCA-007 | Integration (pgTAP) | `supabase/tests/0034_task_completed_at.test.sql` |
| AC-SCA-008 | Integration (pgTAP) | `supabase/tests/0034_task_completed_at.test.sql` |
| AC-SCA-009 | Integration (pgTAP) | `supabase/tests/0034_task_completed_at.test.sql` |
| AC-SCA-010 | Integration (pgTAP) | `supabase/tests/0034_task_completed_at.test.sql` |
| AC-SCA-011 | Integration (pgTAP) | `supabase/tests/0034_task_completed_at.test.sql` |
| AC-SCA-012 | Unit/RTL (Vitest) | `pages/project-detail/ProjectSCurve.test.tsx` |
| AC-SCA-013 | Unit/RTL (Vitest) | `pages/project-detail/ProjectSCurve.test.tsx` |
| AC-SCA-014 | E2E (Playwright) | `e2e/AC-SCA-014-actual-line-moves.spec.ts` |
