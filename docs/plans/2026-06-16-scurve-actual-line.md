# Plan — S-curve real "actual" line (Option A: completion dates)

**Owner-approved (2026-06-16):** the S-curve must show **two cumulative lines** — planned (have it) and
**actual over time** (today: a single "actual to date" dot, because we store only the *current*
`effective_pct`, no history — `OBS-SC-001`). Option A: capture **real completion dates** and step the
actual line at them. Gates production promote (owner: "production after the s-curve is fixed").

## Root facts (verified)
- `effective_pct` is **derived**, not stored: per milestone `= input_pct ?? (count tasks Done / count tasks)`
  (migration `0023_delivery_milestones.sql`). Project rollup `= Σ(weight·effective_pct)/Σweight`.
- Tasks are written via `updateTask` / `updateTaskStatus` (`src/lib/db/tasks.ts`); status→`Done` is the real
  progress event. **No `completed_at` exists today.**
- The project-detail page already loads the project's `tasks` (TaskWithRefs) AND `milestones` — so the actual
  series can be computed **client-side**, no new RPC.

## Design decisions (resolved in the 2026-06-16 owner grill)
1. **Granularity = task-level.** Add `tasks.completed_at timestamptz`, stamped in the DB (can't be forged;
   fires on every write path). **Trigger semantics:** into-`Done` → `now()`; **leaving `Done` → `null`**
   (a reopened task drops off the actual curve); re-entering `Done` re-stamps the new date; INSERT-as-`Done`
   stamps. `completed_at` always agrees with `status`. Server-enforced (ADR-0019 spirit).
2. **Hybrid source (per milestone, weight `w`) — tasks where trustworthy, the milestone's own number where not:**
   - *Has tasks, no manual override:* `w · (tasks Done by d / total)`, each Done task placed at
     `completed_at` (real) **else `due_date`** (proxy, clamped ≤ today).
   - *Has an `input_pct` override (= tasks "unreliable" — a human set the %) OR no tasks:* `w · input_pct`
     placed at the **milestone `target_date`** (proxy, clamped ≤ today).
   - `actual(d) = round2( Σ_milestones[contribution by d] / Σweight )`. Endpoint = today's headline gauge
     (`actualToDate`) by construction.
3. **Backfill** = the proxies above (`due_date` / `target_date`, clamped ≤ today) for all currently-`Done`
   tasks / overridden milestones — so the demo shows a believable second line **now**. Backfilled dates are
   estimates, not recorded history → a chart caveat ("completion dates before today are estimated; live from
   here") until real `completed_at`s accrue. Going forward, dates are real.
4. **Render:** planned line stays **monotone** (smooth ideal); actual is a **linear** connected line over its
   points (real points; segments = the conventional cumulative-to-date interpolation) — visually distinct,
   not a lone dot. Legend already distinguishes; keep the caveat sub-line.

## Tasks (2–5 min each; TDD)
1. **Migration `0034_task_completed_at.sql`** — `ALTER TABLE tasks ADD COLUMN completed_at timestamptz;`
   + `BEFORE INSERT OR UPDATE` trigger fn `stamp_task_completed_at()` (into-Done → `now()`; out-of-Done →
   `null`); backfill `UPDATE tasks SET completed_at = coalesce(due_date::timestamptz, updated_at) WHERE status='Done'`.
   Verify: `supabase db reset` clean.
2. **pgTAP `supabase/tests/0034_task_completed_at.test.sql`** — into-Done stamps; Done→To Do clears;
   non-status update preserves; insert-as-Done stamps. Verify: `supabase test db`.
3. **DAL** — add `completed_at: string | null` to `TaskWithRefs` + the select in `src/lib/db/tasks.ts`
   (+ the Gantt/Tasks consumers compile). Verify: `npm run typecheck`.
4. **`src/lib/delivery/sCurve.ts`** — `buildSCurve(milestones, asOf, tasks?)`: when `tasks` given, emit the
   stepped actual points (above) instead of the single asOf dot; keep the single-dot fallback when `tasks`
   is undefined/empty (no completion data). Pure. Verify: new unit tests.
5. **`sCurve.test.ts`** — actual-series cases: monotonic; steps at completion dates; weighting; equals
   `actualToDate` at asOf; empty-completion → single-dot fallback. (AC-SC-ACTUAL-001..00n.)
6. **`ProjectSCurve.tsx`** — thread the project `tasks` in; render the actual series as a `<Line>` (solid,
   One-Blue) over its points; drop the lone-dot path when there are ≥2 actual points. Update its render test.
7. **Tidy (folds in the earlier finding):** fix the right-edge axis-label collision ("16 Jun '26"/"30 Jun")
   — de-dupe ticks / `minTickGap` (the same recharts duplicate-tick cosmetic flagged 2026-06-16).
8. **Review + ship:** spec/quality/security (trigger touches a business table → security confirms the trigger
   can't be bypassed + RLS unaffected) → PR. Migration `0034` ships to prod in the gated promote.

## Acceptance
- AC-SC-ACTUAL-1: a delivery project with completed tasks shows a **rising actual line** (≥2 points), not a dot.
- AC-SC-ACTUAL-2: actual is monotonic non-decreasing and meets `actualToDate` at today.
- AC-SC-ACTUAL-3: a project with no completed tasks still renders (single "actual to date" point) — no crash.
- AC-SC-TRIG-1 (pgTAP): `completed_at` stamps into-Done, clears out-of-Done, server-side.
