# Plan — S-curve real "actual" line (final build plan)

**Feature:** `scurve-actual-line` · **Spec:** `docs/specs/scurve-actual-line.spec.md` (signed) ·
**ADR:** `docs/adr/0032-scurve-actual-series.md` · **Date:** 2026-06-16

Replace the single "actual to date" dot (`OBS-SCA-001`) with a real cumulative actual line over time,
plotted against the existing planned line. Adds `tasks.completed_at` (server-trigger-stamped),
extends the pure `buildSCurve` with a hybrid actual series, re-renders `ProjectSCurve`. **TDD: every
behaviour task writes the failing test first.** Gates the owner-directed production promote
(migration `0034` ships then; prod is parked at migration 0027).

## Locked decisions (from ADR-0032 — do not re-litigate)

1. **`tasks.completed_at timestamptz`**, written ONLY by a `BEFORE INSERT OR UPDATE` trigger
   `stamp_task_completed_at()`: into-Done → `now()`; leaving-Done → `null`; re-enter-Done → fresh
   `now()`; non-status UPDATE → untouched. RLS on `tasks` unchanged (NFR-SCA-006).
2. **Hybrid actual series** in `buildSCurve(milestones, asOf, tasks?)`: task-tracked milestones (no
   `input_pct`) contribute per Done task at `completed_at` else `end_date` proxy; overridden/task-less
   milestones contribute `input_pct` at `target_date`; all proxies clamped ≤ `asOf`; cumulative
   non-decreasing; endpoint == `actualToDate`.
3. **Proxy backfill** of existing Done rows + a visible "estimated" caveat.
4. **Planned = monotone dashed (unchanged); actual = linear solid**; drop the lone dot at ≥2 points.

## ⚠ Schema-conformance errata (OQ-1 — resolved, flagged to Director)

The signed spec names task **`due_date`** (proxy) and task **`updated_at`** (backfill fallback). The
real `tasks` table (`0001_init_schema.sql`; `database.types.ts`) has **neither** — its columns are
`start_date`, `end_date`, `created_at`. Per ADR-0032 the build maps, with **no AC behaviour change**:
- proxy `due_date` → **`end_date`** · backfill fallback `updated_at` → **`created_at`**.

All tasks below use the real column names. **OQ-1 (Director):** confirm this mapping, or decide to add
a real `due_date` column (a spec amendment + separate decision — not in this plan).

## Type contracts (fixed across all tasks — keep consistent)

```ts
// src/lib/delivery/sCurve.ts — narrow task view the builder reads (assignable from TaskWithRefs).
export interface SCurveTask {
  milestone_id: string | null;
  status: string;            // 'To Do' | 'In Progress' | 'Done' (only 'Done' matters here)
  completed_at: string | null; // ISO timestamptz, trigger-stamped
  end_date: string | null;     // 'YYYY-MM-DD' scheduled finish — proxy when completed_at is null
}

export function buildSCurve(
  milestones: MilestoneWithProgress[],
  asOf: string,
  tasks?: SCurveTask[],
): SCurveModel;            // SCurveModel / SCurvePoint unchanged
```

`TaskWithRefs` gains `completed_at: string | null` (FR-SCA-007), so `TaskWithRefs[]` is assignable to
`SCurveTask[]` (structural). `ProjectSCurve` passes `useTasks(projectId).data ?? []` into `buildSCurve`.

---

## Tasks (2–5 min each, TDD; exact paths + verify commands)

### DB / migration

**T1 — Migration `0034_task_completed_at.sql`.**
Create `supabase/migrations/0034_task_completed_at.sql`:
1. Header comment: purpose; reversibility (`supabase db reset` pre-prod; documented forward-only
   rollback `alter table tasks drop column completed_at; drop function stamp_task_completed_at() cascade;`);
   security note "trigger only stamps the column; RLS on tasks unchanged (NFR-SCA-006); BEFORE trigger
   overwrites any client value (NFR-SCA-003)".
2. `alter table tasks add column completed_at timestamptz;`
3. Trigger fn (`language plpgsql`, `set search_path = public`):
   ```sql
   create or replace function stamp_task_completed_at() returns trigger
     language plpgsql set search_path = public as $$
   begin
     if tg_op = 'INSERT' then
       new.completed_at := case when new.status = 'Done' then now() else null end;
     elsif new.status = 'Done' and old.status is distinct from 'Done' then
       new.completed_at := now();          -- entered Done
     elsif new.status is distinct from 'Done' and old.status = 'Done' then
       new.completed_at := null;            -- left Done
     else
       new.completed_at := old.completed_at; -- status unchanged → preserve (overwrites client value)
     end if;
     return new;
   end $$;
   ```
4. `create trigger trg_stamp_task_completed_at before insert or update on tasks for each row execute function stamp_task_completed_at();`
5. Backfill: `update tasks set completed_at = coalesce(end_date::timestamptz, created_at) where status = 'Done';`
   (the backfill must run AFTER the trigger exists — an UPDATE fires the trigger, so guard it by
   running the backfill as the table owner inside the migration where `old.status='Done'` and
   `new.status='Done'` ⇒ the trigger's `else` branch preserves `old.completed_at` which is still null;
   therefore set it with a **direct** `update ... set completed_at = ...` is overwritten by the trigger.
   → Disable the trigger for the backfill: wrap the backfill in
   `alter table tasks disable trigger trg_stamp_task_completed_at;` … `alter table tasks enable trigger trg_stamp_task_completed_at;`).
**Verify:** `supabase db reset` completes clean (no error).

### pgTAP (Integration — AC-SCA-007..011)

**T2 — pgTAP `0034_task_completed_at.test.sql`.**
Create `supabase/tests/0034_task_completed_at.test.sql` (mirror `0061_milestones_rls.test.sql`
structure: `begin; select plan(N); … select * from finish(); rollback;`, fixture namespace
`00340000-…`, seed org/profile/company/project/milestone as table owner). Five behaviour assertions,
each leading with its AC id:
- **AC-SCA-007:** seed a `'To Do'` task; `update tasks set status='Done'`; `isnt(completed_at, null)`
  and `ok(completed_at >= now() - interval '5 seconds')`.
- **AC-SCA-008:** task `'Done'` (completed_at set); `update … status='In Progress'`;
  `is(completed_at, null)`.
- **AC-SCA-009:** `'Done'` task with completed_at = T; `update … set name='new'` (status unchanged);
  `is(completed_at, T)` (unchanged).
- **AC-SCA-010:** `insert into tasks (… status) values ('Done')`; `isnt(completed_at, null)`.
- **AC-SCA-011:** Done (T1) → In Progress (null) → Done again; capture T2;
  `ok(T2 is not null and T2 >= T1)`.
**Verify:** `supabase test db` (this file green).

### DAL (FR-SCA-007)

**T3 — `TaskWithRefs.completed_at` + SELECT.**
Edit `pmo-portal/src/lib/db/tasks.ts`: add `completed_at: string | null;` to `TaskWithRefs` and to the
`RawTask` type. The SELECT uses `'*'` (line 55–56) which already returns the new column once the
migration adds it and `database.types.ts` is regenerated — so **also** regenerate the generated types:
add `completed_at: string | null` to `tasks.Row` (and `?: string | null` to Insert/Update) in
`pmo-portal/src/lib/supabase/database.types.ts` (regenerate via the project's type-gen script; the
mapped `TaskWithRefs` spreads `*` so no `select` string edit is needed). No casts (NFR-SCA-007).
**Verify:** `npm run typecheck` zero errors.

### Pure builder (FR-SCA-008..011) — TDD: tests first

**T4 — Builder tests `sCurve.test.ts` (write first, RED).**
Append to `pmo-portal/src/lib/delivery/sCurve.test.ts` a `describe('buildSCurve — actual series')`
block with an `scTask` factory (`{ milestone_id, status, completed_at, end_date }`) and these cases,
each `it(...)` titled with its AC id:
- **AC-SCA-001:** 2 milestones (weight 1 each, no input_pct), each with 1 Done task at distinct
  `completed_at` (`2026-02-01`, `2026-05-01`); `buildSCurve(ms, '2026-06-16', tasks)`. Assert ≥2
  non-null actual points; actual values non-decreasing; last actual === `model.actualToDate`.
- **AC-SCA-002:** mix of Done + non-Done across weights; assert final actual point === `actualToDate`
  (use `toBeCloseTo(model.actualToDate, 2)`), matching the gauge.
- **AC-SCA-003:** all tasks `status='In Progress'`, no input_pct; assert exactly one non-null actual
  point (at `asOf`) and no throw.
- **AC-SCA-004:** M1(weight 2, input_pct 60, target_date `2025-03-01`) + M2(weight 2, no input_pct, 1
  Done task end_date `2025-04-01`); assert an actual point at/near `2025-03-01` (M1 contribution) and
  one at/near `2025-04-01` (M2), both ts ≤ `isoToTs('2026-06-16')`.
- **AC-SCA-005:** 1 milestone (weight 1, no tasks, no input_pct, effective_pct 0, target_date
  `2025-06-01`); `buildSCurve([m], '2026-06-16', [])`. Assert one actual point at `2025-06-01` valued
  0; `actualToDate === 0`.
- **AC-SCA-006:** Done task `end_date='2027-12-31'`, no `completed_at`, `asOf='2026-06-16'`; assert the
  contribution's point ts === `isoToTs('2026-06-16')` (clamped, not the future date).
- Regression guard: existing `AC-SC-003` "single point at asOf" still passes when `tasks` arg is
  **omitted** (fallback unchanged, FR-SCA-011).
**Verify (RED):** `npx vitest run src/lib/delivery/sCurve.test.ts` — new cases FAIL (builder ignores
`tasks`).

**T5 — Builder impl `sCurve.ts` (GREEN).**
Edit `pmo-portal/src/lib/delivery/sCurve.ts`:
1. Export `interface SCurveTask` (per Type contracts above).
2. Add optional `tasks?: SCurveTask[]` param to `buildSCurve`.
3. After computing `actualToDate`/`totalWeight`, if `tasks` is non-empty AND there is ≥1 actual
   contribution, build the actual series:
   - For each milestone (`weight > 0`): if it has `input_pct != null` OR no tasks assigned to it →
     emit one contribution `weight * clampPct(effective_pct)/100 * (100/100)` … i.e. contribution to
     the numerator = `weight * clampPct(m.effective_pct)` placed at
     `clampDate(m.target_date, asOf)` (skip if `target_date` null — Error-Handling row).
   - Else (has tasks, no override): for each Done task in the milestone, contribution to numerator =
     `weight * (100 / total_tasks_in_milestone)` placed at `clampDate(completed_at ?? end_date, asOf)`
     (skip if both null).
   - `clampDate(iso, asOf)` returns `min(iso, asOf)` on the date string (proxy clamp, FR-SCA-008).
   - Sort contributions by ts ascending; accumulate the numerator; each emitted actual point value =
     `round2(runningNumerator / totalWeight)` (non-decreasing — FR-SCA-009). The final emitted point
     is forced to `asOf` valued `actualToDate` if the last contribution date < asOf is NOT required —
     instead assert by construction: Σ all contributions / totalWeight === actualToDate (it does,
     because the per-milestone contributions reproduce `effective_pct`). Emit a terminal point at
     `asOf` valued `actualToDate` only when the last contribution ts < `isoToTs(asOf)` to anchor the
     endpoint to the gauge (FR-SCA-010 / NFR-SCA-001).
   - Merge actual points into the `points` array as `{date, ts, planned:null, actual}`; keep planned
     points as-is.
4. When `tasks` is absent/empty OR no contribution exists → keep the existing single
   `{date: asOf, …, actual: actualToDate}` fallback (FR-SCA-011). Builder stays pure (NFR-SCA-005).
**Verify (GREEN):** `npx vitest run src/lib/delivery/sCurve.test.ts` — all pass (incl. the pre-existing
planned/axis cases, unchanged).

### Component (FR-SCA-012..016) — TDD: tests first

**T6 — Component tests `ProjectSCurve.test.tsx` (write first, RED).**
Edit `pmo-portal/pages/project-detail/__tests__/ProjectSCurve.test.tsx`:
1. Add a `vi.mock('@/src/hooks/useTasks', …)` returning a mutable `taskState.data` (default `[]`),
   mirroring the existing `useMilestones` mock.
2. Extend the recharts `LineChart` mock to capture each `<Line>` child's `dataKey` +
   `strokeDasharray` props (scan children like the existing YAxis scan).
3. **AC-SCA-012:** set `taskState.data` to ≥2 Done tasks at different `completed_at`, dated
   milestones (no input_pct); render; assert two captured `<Line>`s — one with `strokeDasharray` set
   (planned), one without (actual), the actual one's `dataKey === 'actual'`.
4. **AC-SCA-013:** with ≥1 actual point, assert the DOM contains text
   `Completion dates before today are estimated`.
**Verify (RED):** `npx vitest run pages/project-detail/__tests__/ProjectSCurve.test.tsx` — AC-SCA-012/013
FAIL (component doesn't thread tasks yet / old caption).

**T7 — Component impl `ProjectSCurve.tsx` (GREEN).**
Edit `pmo-portal/pages/project-detail/ProjectSCurve.tsx`:
1. Import + call `useTasks(projectId)`; `const tasks = tasksData ?? []`.
2. `useMemo(() => buildSCurve(data ?? [], todayIso(), tasks), [data, tasks])`.
3. Compute `const hasActualSeries = model.points.filter(p => p.actual !== null).length >= 2;`.
4. Actual `<Line>`: `type="linear"`, **no** `strokeDasharray`, `dot={hasActualSeries ? false : { r: 4, fill: chartTheme.series.primary }}` (drop the lone dot at ≥2 points — FR-SCA-013).
5. Planned `<Line>` unchanged (`type="monotone"`, `strokeDasharray="5 4"` — FR-SCA-016).
6. Replace the `OBS-SC-001` caption text (lines 147–150) with: `Completion dates before today are
   estimated; live tracking starts now.` (FR-SCA-014).
7. `aria-label` summary already names actual-to-date % (FR-SCA-015) — leave intact.
**Verify (GREEN):** `npx vitest run pages/project-detail/__tests__/ProjectSCurve.test.tsx` — all pass,
including the pre-existing AC-SC-005..010 cases.

**T8 — Axis-tick collision tidy (cosmetic, non-AC).**
In `ProjectSCurve.tsx` XAxis, bump `minTickGap` from `32` to `48` to drop the duplicated right-edge
tick (the "16 Jun '26"/"30 Jun" collision flagged 2026-06-16). No behaviour change; no new test.
**Verify:** `npx vitest run pages/project-detail/__tests__/ProjectSCurve.test.tsx` stays green.

### E2E (FR-SCA — AC-SCA-014)

**T9 — Playwright `e2e/AC-SCA-014-actual-line-moves.spec.ts` (write first).**
Create `pmo-portal/e2e/AC-SCA-014-actual-line-moves.spec.ts`. `test(...)` title leads with
`AC-SCA-014`. Steps (use the standard auth helper, login `Passw0rd!dev`): open a delivery project's
Tasks/Timeline tab; change one In-Progress task's status to `Done`; navigate to the Delivery > S-curve
view; assert a visible actual line with ≥2 points (locate the actual `<path>`/`<Line>` and assert the
endpoint value equals the "Actual to date" gauge text in the legend). Run **serial**, dedicated
fixture project (per MEMORY full-serial-e2e rule).
**Verify:** `npx playwright test e2e/AC-SCA-014-actual-line-moves.spec.ts` (from `pmo-portal/`).

### Review & ship

**T10 — Reviews (3, always).**
`spec-reviewer` (ACs ↔ SDD), `code-quality-reviewer`, `security-auditor` (confirm: trigger can't be
bypassed; `completed_at` not client-writable; RLS on `tasks` unaffected — NFR-SCA-003/006). Address
findings.
**Verify:** `npm run typecheck` + `npm test` + `supabase test db` all green; `npx eslint` zero errors.

**T11 — PR.**
`release-engineer`: branch → commit (trailer `Co-Authored-By: Claude Opus 4.8 (1M context)
<noreply@anthropic.com>`) → push → one PR (migration `0034` + DAL + builder + component + e2e).
**Migration `0034` ships to prod only in the owner-gated promote** (prod parked at 0027).

---

## Traceability — every AC → its owning test (mirrors the spec table)

| AC | Owning Layer | File | Plan task |
|---|---|---|---|
| AC-SCA-001 | Unit (Vitest) | `pmo-portal/src/lib/delivery/sCurve.test.ts` | T4/T5 |
| AC-SCA-002 | Unit (Vitest) | `pmo-portal/src/lib/delivery/sCurve.test.ts` | T4/T5 |
| AC-SCA-003 | Unit (Vitest) | `pmo-portal/src/lib/delivery/sCurve.test.ts` | T4/T5 |
| AC-SCA-004 | Unit (Vitest) | `pmo-portal/src/lib/delivery/sCurve.test.ts` | T4/T5 |
| AC-SCA-005 | Unit (Vitest) | `pmo-portal/src/lib/delivery/sCurve.test.ts` | T4/T5 |
| AC-SCA-006 | Unit (Vitest) | `pmo-portal/src/lib/delivery/sCurve.test.ts` | T4/T5 |
| AC-SCA-007 | Integration (pgTAP) | `supabase/tests/0034_task_completed_at.test.sql` | T1/T2 |
| AC-SCA-008 | Integration (pgTAP) | `supabase/tests/0034_task_completed_at.test.sql` | T1/T2 |
| AC-SCA-009 | Integration (pgTAP) | `supabase/tests/0034_task_completed_at.test.sql` | T1/T2 |
| AC-SCA-010 | Integration (pgTAP) | `supabase/tests/0034_task_completed_at.test.sql` | T1/T2 |
| AC-SCA-011 | Integration (pgTAP) | `supabase/tests/0034_task_completed_at.test.sql` | T1/T2 |
| AC-SCA-012 | Unit/RTL (Vitest) | `pmo-portal/pages/project-detail/__tests__/ProjectSCurve.test.tsx` | T6/T7 |
| AC-SCA-013 | Unit/RTL (Vitest) | `pmo-portal/pages/project-detail/__tests__/ProjectSCurve.test.tsx` | T6/T7 |
| AC-SCA-014 | E2E (Playwright) | `pmo-portal/e2e/AC-SCA-014-actual-line-moves.spec.ts` | T9 |

## FR / NFR → task coverage

| Req | Task(s) |
|---|---|
| FR-SCA-001 column | T1 |
| FR-SCA-002 into-Done stamps | T1 (impl) / T2 (AC-SCA-007) |
| FR-SCA-003 leaving-Done clears | T1 / T2 (AC-SCA-008) |
| FR-SCA-004 non-status preserves | T1 / T2 (AC-SCA-009) |
| FR-SCA-005 INSERT-as-Done stamps | T1 / T2 (AC-SCA-010) |
| FR-SCA-006 backfill | T1 |
| FR-SCA-007 DAL type | T3 |
| FR-SCA-008 hybrid source | T5 / T4 (AC-SCA-004/005/006) |
| FR-SCA-009 monotone guarantee | T5 / T4 (AC-SCA-001) |
| FR-SCA-010 endpoint == gauge | T5 / T4 (AC-SCA-002) |
| FR-SCA-011 single-point fallback | T5 / T4 (AC-SCA-003) |
| FR-SCA-012 two lines | T7 / T6 (AC-SCA-012) |
| FR-SCA-013 drop lone dot ≥2 | T7 / T6 (AC-SCA-012) |
| FR-SCA-014 caveat | T7 / T6 (AC-SCA-013) |
| FR-SCA-015 aria-label | T7 (preserved; AC-SC-008 existing) |
| FR-SCA-016 planned unchanged | T7 (existing AC-SC-005 stays green) |
| NFR-SCA-001 endpoint invariant | T4/T5 (AC-SCA-002) |
| NFR-SCA-002 caveat honesty | T7 (AC-SCA-013) |
| NFR-SCA-003 server-enforced | T1 / T10 (security audit) |
| NFR-SCA-004 no extra round-trip | T7 (reuses `useTasks` already on the page) |
| NFR-SCA-005 pure builder | T5 (no I/O; AC-SCA-001..006 deterministic) |
| NFR-SCA-006 RLS unaffected | T1 / T10 (security audit) |
| NFR-SCA-007 typecheck zero | T3 (verify `npm run typecheck`) |

## Open questions (for the Director)

- **OQ-1 (resolved in-plan, confirm):** spec `due_date`/`updated_at` → real `end_date`/`created_at`
  mapping (the `tasks` table has neither spec column). No AC behaviour changes. Confirm, or elect to
  add a real `due_date` column (spec amendment + separate decision).
