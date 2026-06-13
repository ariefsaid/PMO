# ADR-0025 — Project S-curve: actual-to-date model (reuse, no new RPC)

- **Status:** Accepted
- **Date:** 2026-06-14
- **Feature:** KANNA Wave 2 — per-project planned-vs-actual S-curve (Delivery lens)
- **Supersedes / relates to:** ADR-0021 (unified project detail), ADR-0017 (repository seam)

## Context

The Delivery lens needs a cumulative S-curve showing **planned** vs **actual** progress
over time. The data we have:

- `project_milestones` (migration 0023) records, per milestone: `target_date`, `weight`,
  `input_pct`, and (via `get_project_milestones`, security-invoker) the derived
  `calculated_pct` / `effective_pct = coalesce(input_pct, calculated_pct, 0)`.
- **There is NO per-date actual-completion history anywhere** — not on the table, not on
  `tasks` (the only completion signal is `tasks.status = 'Done'`, with no completion date).
  `created_at` is row-creation, not progress.

So a true *historical* actual curve cannot be drawn without inventing fake datapoints,
which would be dishonest.

## Decision

1. **Reuse the existing read.** The S-curve consumes `useMilestones(projectId)` verbatim —
   the same `get_project_milestones` security-invoker RPC and the same React Query cache
   entry the milestone stepper already populates. **No new RPC, no migration, no new RLS.**
   RLS on `project_milestones` scopes rows; `org_id` is never threaded from the client.

2. **Planned curve** = cumulative weight-normalized milestone progress plotted at each
   milestone `target_date` (sorted ascending, ties by `sort_order`), monotonic
   non-decreasing, anchored at an origin (earliest date, 0%) and terminating at 100%.

3. **Actual curve (honest v1, OBS-SC-001)** = a **single** weight-weighted
   `effective_pct` rollup point at **today** (`Σ(weight·effective_pct)/Σweight`), the same
   rollup the stepper shows. We do **not** synthesize intermediate historical actuals. The
   variance signal v1 delivers: *where actual-to-date sits today vs. where the plan said we'd
   be by today* (the planned curve interpolated at today).

4. **Single-blue identity.** Planned and actual are both One-Blue; **line style** (dashed
   vs solid) + a **text legend** carry the distinction, never color alone.

## Consequences

- Honest but coarse actual (one point, not a stepped history). This is stated in the UI copy
  ("Actual reflects current progress as of today; historical actuals are not yet tracked.")
  and tagged **OBS-SC-001** in `src/lib/delivery/sCurve.ts`.
- **No FE rewrite on upgrade:** a future migration adding a milestone `completed_on` (or a
  progress-history table) lets the actual series step at those dates — `buildSCurve` already
  emits a `{date, planned, actual}` point list, so only the data feed changes.
- **Zero tenancy/RLS surface added** (NFR-SC-SEC-001); **zero extra network round-trip**
  (NFR-SC-PERF-001 — shares the stepper's cache).
