# ADR-0032 — S-curve actual series: server-stamped completion dates + hybrid client-side derivation

- **Status:** Accepted
- **Date:** 2026-06-16
- **Feature:** `scurve-actual-line` — replace the single "actual to date" dot with a real cumulative actual line over time
- **Spec:** `docs/specs/scurve-actual-line.spec.md` (FR-SCA / NFR-SCA / AC-SCA — signed)
- **Plan:** `docs/plans/2026-06-16-scurve-actual-line.md`
- **Relates to:** ADR-0019 (server-enforced rules / write authority), ADR-0017 (repository seam),
  ADR-0016 (RLS is the enforcement authority), migration `0023_delivery_milestones.sql`
  (`effective_pct` derivation), `OBS-SC-001` / `OBS-SCA-001` (the honesty single-dot limit)

## Context

The project Delivery S-curve plots a genuine multi-point **planned** cumulative curve (one point per
dated milestone) but only a **single "actual to date" dot** at `asOf`. The data layer records no
per-date actual-completion history — `project_milestones` stores only the *current* weight-weighted
`effective_pct` (derived in `get_project_milestones`, migration 0023), and `tasks` records `status`
but **no instant at which a task became Done**. `buildSCurve` therefore emits one `actual`-valued
point (`{ date: asOf, actual: actualToDate }`) and the chart renders a lone dot, not a line
(`OBS-SC-001` / `OBS-SCA-001`). A reviewer cannot see slippage or acceleration over time.

The honest fix requires a per-completion **date** signal. Two facts constrain the design:

1. **The write path must be tamper-proof.** Progress (status → `Done`) is the headline delivery
   number; a forgeable completion date is a correctness/audit hole. Per ADR-0019, a real progress
   fact belongs to the DB, not the client.
2. **No new read may be added.** The project-detail Tasks tab already loads `useTasks(projectId)` +
   `useMilestones(projectId)`; the actual series must be derivable **client-side** from data already
   in cache (NFR-SCA-004 / NFR-SC-PERF-001 preserved).

A complication: the existing rollup is **hybrid by milestone** — a milestone's `effective_pct` is
`input_pct` (a human override) when set, else the task-Done ratio. The actual *series* must reproduce
that same hybrid so its endpoint equals the headline gauge exactly (NFR-SCA-001), and it must produce
a believable second line **today** even though no real completion history exists yet.

### Schema-conformance note (errata — resolved here, flagged to the Director)

The signed spec refers to task **`due_date`** (the per-task proxy) and task **`updated_at`** (the
backfill fallback in `COALESCE(due_date::timestamptz, updated_at)`). The real `tasks` table
(`0001_init_schema.sql`, confirmed in `database.types.ts`) has **no `due_date` and no `updated_at`**
— its date/time columns are `start_date`, `end_date`, `created_at`. This ADR maps the spec's intent
onto the real schema **without changing any AC behavior**:

- **Per-task proxy `due_date` → `end_date`** (the task's scheduled finish — the schema analog of a
  "due date").
- **Backfill fallback `updated_at` → `created_at`** (the only `timestamptz` on the row).

Every AC still holds verbatim in shape (a Done task with a future scheduled finish clamps to `asOf`,
etc.); only the column name the test fixture sets changes (`end_date` instead of `due_date`). This is
recorded as **OQ-1** in the plan for Director confirmation; it does not block the build.

## Decision

### (a) `tasks.completed_at`, stamped by a server-side trigger — the write authority (ADR-0019)

Add `tasks.completed_at timestamptz` (nullable). A `BEFORE INSERT OR UPDATE` trigger
`stamp_task_completed_at()` is the **sole writer** of this column:

- **into `Done`** (INSERT-as-Done, or UPDATE where new `status = 'Done'` and it was not before) →
  `completed_at := now()` (FR-SCA-002, FR-SCA-005);
- **leaving `Done`** (UPDATE where old `status = 'Done'` and new ≠ `'Done'`) → `completed_at := null`
  (FR-SCA-003) — a reopened task drops off the actual curve;
- **re-entering `Done`** → re-stamps a fresh `now()` (FR-SCA-011 / AC-SCA-011);
- **non-status UPDATE** (status unchanged) → `completed_at` left untouched (FR-SCA-004 / AC-SCA-009).

The trigger overwrites any client-supplied value, so `completed_at` is never forgeable and always
agrees with `status`. RLS on `tasks` is **unchanged** (NFR-SCA-006): the trigger only stamps the
column; the existing `tasks_write` WITH CHECK remains the row-write authority, and the client never
sends `completed_at` (the DAL SELECT exposes it read-only; no writer path adds it).

### (b) Hybrid actual-series source — derived client-side in the pure builder

`buildSCurve(milestones, asOf, tasks?)` gains an optional `tasks: SCurveTask[]` argument and, when
non-empty, emits a multi-point actual series by the **hybrid rule** (mirrors `effective_pct`):

- **Milestone has tasks AND no `input_pct` override** → task-level: each Done task contributes
  `weight · (1 / total_tasks_in_milestone)` placed at `completed_at` (real) **else `end_date`**
  (proxy), clamped ≤ `asOf` (FR-SCA-008).
- **Milestone has an `input_pct` override OR no tasks** → milestone-level: contributes
  `weight · input_pct/100` placed at `target_date` (proxy), clamped ≤ `asOf` (FR-SCA-008).
- Contributions are summed by date, accumulated in ascending date order, normalised by `totalWeight`,
  and `round2`'d — yielding a **non-decreasing** series (FR-SCA-009) whose endpoint at `asOf` equals
  `actualToDate` by construction (FR-SCA-010 / NFR-SCA-001).

The builder stays **pure** (no I/O, deterministic — NFR-SCA-005). It reads only `status`,
`milestone_id`, `completed_at`, `end_date` off each task (a narrow `SCurveTask` view).

### (c) Proxy backfill of existing Done tasks + chart caveat

Migration `0034` backfills `completed_at = COALESCE(end_date::timestamptz, created_at)` for existing
`status = 'Done'` rows (FR-SCA-006), so the second line is believable **today**. Those dates are
*estimates, not recorded history* — the chart carries the caveat "Completion dates before today are
estimated; live tracking starts now." (FR-SCA-014 / NFR-SCA-002), replacing the old `OBS-SC-001`
caption. Going forward, every completion date is a real `now()`.

### (d) Linear actual vs monotone planned

The planned line stays `type="monotone"` (the smooth ideal target), dashed — **unchanged** in shape,
style, and data (FR-SCA-016). The actual line renders `type="linear"`, solid (no `strokeDasharray`),
connecting its **real** date coordinates — the conventional cumulative-to-date interpolation, and
visually distinct from the dashed plan (FR-SCA-012). When the series has ≥2 actual points the lone
`dot={{ r: 4 }}` is dropped in favour of the connected line (FR-SCA-013); the single-point fallback
(no completions, or `tasks` absent) preserves the old dot (FR-SCA-011). Both lines remain One-Blue
(DESIGN.md single-blue identity); plan vs actual is style-differentiated, never colour-differentiated.

## Alternatives considered and rejected

- **A milestone-level `completed_at` column** (stamp the milestone, not its tasks). Rejected: a
  milestone has no single completion instant — it rolls up N tasks finishing on different dates;
  collapsing them to one date loses exactly the intra-milestone slope the line is meant to show, and
  would need a second trigger keeping milestone state in sync with task churn. Task-level granularity
  is the natural grain and reuses the existing task write path.
- **Purist no-backfill** (only real `completed_at` from migration day forward). Rejected: every
  existing project would show an empty actual line until new completions accrue — the feature would
  look broken on the demo/seed data the owner reviews. The clamped `end_date`/`target_date` proxy
  plus a visible honesty caveat is the better trade (real where we have it, estimated where we don't,
  disclosed either way).
- **A step line** (`type="stepAfter"`). Rejected: cumulative-progress S-curves conventionally read as
  connected/interpolated; a stepped actual against a smooth planned reads as two different chart
  idioms. Linear keeps both as cumulative curves, distinguished only by dash vs solid.
- **Deriving completion dates from a generic `updated_at`** (or any last-touched timestamp).
  Rejected on two counts: (1) `tasks` has no `updated_at` column at all; (2) even if it did, any edit
  (rename, reassign) would move the "completion" date — `updated_at` is last-touched, not
  became-Done. A dedicated trigger-stamped column is the only signal that means "entered Done".

## Consequences

- **The trigger is the write authority for `completed_at` (ADR-0019 spirit).** Client writes to the
  column are inert (trigger overwrites); no RLS change is needed or made, so the tenancy surface is
  untouched and the security auditor's job is to confirm exactly that (trigger can't bypass/widen
  `tasks_write`; column not client-writable).
- **Honesty debt from the backfill.** Pre-migration dates are estimates; the caveat discloses this
  and MUST stay until all on-screen points originate from real `completed_at` (a future milestone —
  tracking first-real-completion vs migration date — explicitly out of scope here, NFR-SCA-002).
- **No new read, no new RPC, no schema beyond one column + one trigger.** The actual series is pure
  client math over already-cached `tasks` + `milestones`; `buildSCurve` stays pure and the additive
  `tasks?` arg keeps the single-dot fallback byte-compatible for callers that don't pass tasks.
- **One owner-gated prod step.** Migration `0034` ships to prod only in the owner-gated promote (prod
  is parked at migration 0027; this lands with the rest of the dev-only backlog when promoted).
- **Schema-conformance deviation (OQ-1).** The `due_date → end_date` / `updated_at → created_at`
  mapping is recorded in the plan and flagged to the Director; if the owner prefers adding a real
  `due_date` column instead, that is a spec amendment + a separate decision, not part of this build.
