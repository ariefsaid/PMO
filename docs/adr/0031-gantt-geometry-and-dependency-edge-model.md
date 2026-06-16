# ADR-0031 — Gantt geometry + dependency-edge model (build-and-own)

- **Status:** Accepted
- **Date:** 2026-06-16
- **Feature:** `gantt-v2-phase-a` — on-axis milestone diamonds, dependency connectors, MS-Project split layout, zoom
- **Supersedes / relates to:** `docs/plans/2026-06-14-gantt.md` (v1 — AC-GANTT-001..010), ADR-0030 §F
  ("build-and-own, referencing a proven MIT implementation"), ADR-0029 (single status-variant authority)

## Context

The v1 Gantt model (`buildGanttModel`) emits **fraction-only** geometry: `bar.left`/`bar.width` in `[0,1]`
of the date span, `marker.left`, month-only ticks. Fractions are sufficient to paint a single scrolling
column of bars, but they **cannot express**:

- a **dependency connector** — it needs a predecessor bar's *end* x and a successor bar's *start* x in a
  shared absolute coordinate space, and those two bars may live in **different lanes** (rows);
- a bar's **row y** — fractions describe horizontal position only;
- an MS-Project **split layout** where a left task table aligns row-for-row with a right timeline and
  vertical gridlines fall on tick boundaries.

Resolving edges by measuring the rendered DOM (`useLayoutEffect` round-trip) would couple the geometry to a
mounted browser, make it untestable without a DOM, and add a re-layout pass. v1 kept ONE pure, DOM-free model;
Phase-A must preserve that property because **Phase-B (drag-to-reschedule) will mutate dates → recompute
geometry → re-route edges**, and that recompute has to be a pure function it can unit-test.

## Decision

1. **Extend `buildGanttModel` with an OPTIONAL pixel-aware config; keep the fraction path byte-identical.**
   The signature gains a 4th optional argument `config?: GanttLayoutConfig` (`scale`, `rowHeight`,
   `laneHeaderHeight`, `axisHeight`). When the config is **omitted**, behaviour is identical to v1 — fractions
   only, `geometry: null` — so every existing AC-GANTT-001..010 test passes untouched. When present, the model
   additionally emits a `GanttGeometry` block of **absolute px** within the timeline content box.

2. **`GanttGeometry` is the durable seam.** It carries `contentWidth`/`contentHeight`/`pxPerDay`, one
   `GanttBarBox { id, xStart, xEnd, y, h }` per plotted bar, one `GanttMarkerBox { id, x, y }` per dated
   milestone, the resolved `edges`, and `hiddenEdgeCount`. This is what Phase-B drag mutates and re-derives.

3. **The edge model is finite-state-start (FS) and resolved purely.** `GanttEdge` connects a predecessor
   (`depends_on_id`) bar's **end** (right edge, vertically centred) to a successor bar's **start** (left edge,
   vertically centred). `buildEdges` walks all laid-out bars across all lanes, **skips** an edge whose
   predecessor or successor is undated/absent (recording `hiddenEdgeCount`), and returns edges sorted by
   `(y1, y2)` for deterministic render order. `forward = x2 >= x1`.

4. **Render geometry is an orthogonal elbow — the frappe-gantt blueprint (MIT).** SVG path strings are built
   by pure helpers in `ganttGeometry.ts`: a **forward** edge runs out from the predecessor end, drops to the
   successor row, and runs into the successor start; a **backward** edge (successor starts before the
   predecessor ends) wraps around via a mid-Y detour. Routing constants `EDGE_GAP = 12`, `EDGE_ARROW = 6`.
   This mirrors frappe-gantt's arrow routing (MIT, https://github.com/frappe/gantt) — re-implemented against
   our tokens/a11y/React-19 rather than vendored, per ADR-0030 §F build-and-own.

5. **Zoom drives `pxPerDay` and tick granularity.** `GanttScale = 'day' | 'week' | 'month' | 'quarter'` maps
   to `SCALE_PX_PER_DAY = { day: 28, week: 16, month: 6, quarter: 2 }`. `buildMonthTicks` is generalised to
   `buildTicks(scale)` — the `month` path is preserved verbatim (the v1 axis-tick test stays green), and
   `quarter`/`week`/`day` add denser ticks. Default scale = `month` (today's view).

6. **Connectors are STRUCTURAL, not interactive — `muted-foreground`, never action-blue.** Per the One-Blue
   rule, the single brand-blue is reserved for the primary interactive affordance. Dependency lines and their
   arrowheads are wayfinding structure, drawn at `hsl(var(--muted-foreground) / 0.55)` (the `chartTheme.axis`
   family). Milestone diamonds keep `--primary` (a journey/wayfinding marker, the bar-stepper precedent).

7. **a11y: the edge SVG is decorative; the relationship is also text.** The connector `<svg>` is
   `aria-hidden`. The dependency relationship is conveyed non-visually by appending `, depends on {pred}` to
   the successor bar's `aria-label` (preserving the v1 "depends on N" information). The left task table is a
   real `role="grid"` (roving tabindex, Arrow/Enter) so both panes are keyboard-reachable; the
   `<figure role="img">` summary is preserved and extended with the dependency/scale counts.

## Consequences

- **Phase-B (drag-to-reschedule) builds directly on this:** a drag changes a task's dates → re-call
  `buildGanttModel` with the same config → `GanttGeometry` (bars + edges) re-derives purely → re-render. No
  new seam needed; the contract is set here.
- **No schema/auth surface.** Phase-A is pure presentational + pure-model work: no migration, no RPC, no
  `org_id` column, no new read (the Tasks tab already fetches `useTasks` + `useMilestones`). There is nothing
  for the security auditor to gate beyond confirming "no write path added".
- **Back-compat is mechanical:** the v1 fraction fields are untouched and `geometry` is additive/nullable, so
  the regression risk is contained to the new branch.
- **Scope fence:** Phase-A is read-only display. Drag, resource leveling, auto-scheduling, and any write path
  are Phase-B (a later, separate plan + ADR if the write seam warrants one).
