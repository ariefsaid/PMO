# Plan — Gantt v2 Phase-A: on-axis milestone diamonds + dependency connectors + MS-Project layout + zoom

**Date:** 2026-06-16
**Feature:** `gantt-v2-phase-a` (extend the read-only Project Gantt — `/projects/:id` → Tasks tab → Timeline view)
**Branch:** TBD by release-engineer (cut from `main`; `main` is branch-protected — PR-only).
**Author:** eng-planner
**Status:** ready to build (TDD)
**Effort:** **M** (~2.5 days build + review). Confirms the owner's ~M estimate.
**Builds on:** `docs/plans/2026-06-14-gantt.md` (v1 — AC-GANTT-001..010 shipped). ADR-0030 §F "build-and-own,
referencing a proven MIT implementation" (frappe-gantt arrow routing as the blueprint; our tokens/a11y/R19).

> **Scope fence (binding).** Phase-A is **read-only display** only: on-axis milestone diamonds,
> dependency connector lines, an MS-Project split (left task table + right scroll-synced timeline),
> and a selectable day/week/month/quarter zoom. **NO drag-to-reschedule, NO resource leveling, NO
> auto-scheduling, NO write path** — those are **Phase-B** (a later, separate plan). The existing
> `onActivateTask` click-to-open affordance is preserved and extended to the new surfaces; it is the
> only interaction.

---

## 0. What exists today (read before building)

- `pmo-portal/src/lib/gantt/ganttLayout.ts` — pure `buildGanttModel(tasks, milestones, todayIso) → GanttModel`.
  Emits **fraction (0..1)** geometry: `lanes[{ marker:{left}, bars:[{left,width,kind,dependsOnCount,startIso,endIso,status}] }]`,
  `todayLeft`, `ticks:[{iso,left,label}]` (month-only), `undated`, `span`, `isEmpty`. **It already computes
  `marker.left` correctly** and `dependsOnCount` per bar — the bug is purely in the RENDER.
- `pmo-portal/pages/project-detail/ProjectGantt.tsx` (~380 lines) — presentational. Two confirmed defects to fix:
  - **Milestone bug (`:212`)** — renders the milestone as a right-aligned header badge `⬥ {targetIso}` instead
    of a diamond positioned at `marker.left` ON the axis.
  - **No connectors (`:321`)** — dependencies shown as a "depends on N" text chip; no drawn lines.
- `pmo-portal/src/lib/gantt/__tests__/ganttLayout.test.ts` — owns AC-GANTT-001..006 (unit).
- `pmo-portal/pages/project-detail/__tests__/ProjectGantt.test.tsx` — owns AC-GANTT-005/007/008/010 (RTL).
- Tokens: `DESIGN.md` (single-blue `--primary`, `--border`, `--muted-foreground`, radii 4/6/8/10/999,
  spacing 4/8/12/16/20/24, 32px controls, Inter, tabular-nums) + `src/components/ui/chartTheme.ts`
  (`chartTheme.grid = hsl(var(--border))`, `chartTheme.axis = hsl(var(--muted-foreground))`).

**Type fact (load-bearing):** `TaskWithRefs.dependencies: { depends_on_id: string }[]` — each row means
**this task depends on `depends_on_id`** (predecessor = `depends_on_id`, successor = the task). Edges are
**finish-to-start**: predecessor bar **end (right edge)** → successor bar **start (left edge)**.

---

## 1. Decisions (one at a time)

### D1 — Geometry becomes **pixel-aware** via a config; fractions are kept for back-compat
The v1 model is fraction-only. Dependency connectors and the MS-Project gridlines need **absolute
coordinates** (a predecessor's bar-end x, a successor's bar-start x, and each bar's **row y**) — fractions
alone cannot express row y or resolve an edge across lanes. **Decision:** extend `buildGanttModel` to accept
an **optional** `GanttLayoutConfig` (`pxPerDay`, row/header/axis heights, `tableWidth`) and, when present,
emit a `GanttGeometry` block: absolute `contentWidth`/`contentHeight`, each bar's `{ xStart, xEnd, y, h }`
(absolute px in the timeline content box), each marker's `{ x, y }`, and the **edge model** (D3). When config
is **omitted**, behaviour is byte-identical to v1 (fractions only, `geometry: null`) — so every existing
AC-GANTT-001..010 test stays green untouched. This keeps ONE pure model (testable without a DOM) and avoids
a DOM-measuring `useLayoutEffect` round-trip for edges.

### D2 — Zoom drives `pxPerDay`; the model recomputes ticks at the chosen granularity
A `GanttScale = 'day' | 'week' | 'month' | 'quarter'` maps to a `pxPerDay` and a **tick generator**:
day→`28px/day` (day ticks, weekly labels), week→`16px/day` (week-start ticks), month→`6px/day` (month ticks
— today's behaviour), quarter→`2px/day` (quarter-start ticks). `buildGanttModel` takes `scale` in the config
and produces `ticks` at that granularity (extend `buildMonthTicks` → a `buildTicks(scale,…)` dispatcher;
the month path is preserved verbatim so the existing tick test passes). The component owns the toggle
state (`useState<GanttScale>('month')`) and re-memoises the model on change. **No drag** — zoom is the only
geometry control.

### D3 — The **edge model** (the load-bearing new piece)
```ts
// src/lib/gantt/ganttLayout.ts
/** A resolved finish-to-start dependency connector in absolute timeline-content px. */
export interface GanttEdge {
  id: string;            // `${fromTaskId}->${toTaskId}` — stable key
  fromId: string;        // predecessor (depends_on_id)
  toId: string;          // successor (the task carrying the dependency row)
  /** Start point = predecessor bar END (right edge), vertically centred on its row. */
  x1: number; y1: number;
  /** End point = successor bar START (left edge), vertically centred on its row. */
  x2: number; y2: number;
  /** True when the successor starts at/after the predecessor's end (normal FS, no back-route). */
  forward: boolean;
}
```
**Resolution algorithm** (`buildEdges`, pure, runs only when `config` is present):
1. Build `barById: Map<taskId, { xStart, xEnd, y, h }>` from the laid-out bars (across **all** lanes — an
   edge may cross lanes).
2. For each task `t` with `t.dependencies`, for each `{ depends_on_id }`:
   - look up predecessor `p = barById.get(depends_on_id)` and successor `s = barById.get(t.id)`.
   - **skip** the edge if either endpoint is missing (predecessor undated / in the `undated` footer, or
     filtered out) — connectors only join two plotted bars. (Record skipped count for the summary, D7.)
   - `x1 = p.xEnd; y1 = p.y + p.h/2; x2 = s.xStart; y2 = s.y + s.h/2; forward = x2 >= x1`.
3. Return `GanttEdge[]` sorted by `(y1, y2)` for deterministic render order.

**Render geometry (the SVG path — frappe-gantt elbow blueprint).** The component draws each edge as an
orthogonal **elbow** path in one `<svg>` overlay sized to `contentWidth × contentHeight`, absolutely
positioned over the timeline content box (so it scrolls WITH the bars — same positioned track as today's
axis/today-line). Path builder `edgePath(e): string`:
- **Forward** (`x2 >= x1`): `M x1,y1  H (x1 + GAP)  V y2  H (x2 - ARROW)` — out from predecessor end, drop to
  the successor row, run into the successor start. (`GAP = 12`, `ARROW = 6`.)
- **Backward** (`x2 < x1`, successor starts before predecessor ends): route around —
  `M x1,y1  H (x1+GAP)  V (midY)  H (x2-GAP)  V y2  H (x2-ARROW)` where `midY` is the gap between the two rows
  (`(y1+y2)/2`). This is frappe-gantt's "wrap-around" case.
- Arrowhead: a small `<polygon>` (or `marker-end`) at `(x2, y2)` pointing right (3 token-coloured points,
  4px). Stroke = `chartTheme.grid` family at full strength (`hsl(var(--muted-foreground) / 0.55)` — a hairline
  connector, NOT the action-blue; per the One-Blue rule connectors are structural, not interactive).

This is a pure function over the laid-out bars; it is fully unit-testable (no DOM) — the L1 floor.

### D4 — Milestone diamonds render ON the axis (the bug fix)
The model already gives `lane.marker.left` (fraction) and, under D1, `marker.x`/`marker.y`. **Decision:** render
each dated milestone as a **diamond glyph** at `marker.x` on a thin **milestone rail row** at the top of each
lane band (a `◆`-style rotated square, 10px, `hsl(var(--primary))` fill at the diamond — milestones are a
wayfinding affordance, the bar-stepper precedent in DESIGN.md §5 permits primary for journey markers, not a
status pill). The header badge `⬥ {targetIso}` (`ProjectGantt.tsx:212`) is **removed**; the milestone name stays
as the lane label in the left task-table (D5), the date moves to the diamond's `title`/`aria-label`
(`{name} — target {targetIso}`). A vertical dotted guide drops from the diamond through the lane band
(`hsl(var(--primary) / 0.25)`, 1px dashed) so the target date reads against the bars.

### D5 — MS-Project split layout: left **task table** + right **timeline**, scroll-synced
Replace the single scroll block with a 2-pane grid:
- **Left pane (sticky):** a task table, `tableWidth = 260px`, columns **Name · Status · Dates**
  (`{startIso}–{endIso}` or "—"). One row per bar, **row-height-aligned** to the timeline rows (same
  `ROW_H`). Milestone lane headers span the full table width as group rows (mirrors `MilestoneGroupedList`).
  The Name cell is the `onActivateTask` button (role=button when the callback is present — same contract as
  the bar). The left pane does NOT horizontally scroll; it is `position: sticky; left: 0` with a right border.
- **Right pane:** the timeline (axis + bars + diamonds + edge SVG), `overflow-x-auto`. **Vertical scroll is
  shared** — both panes live in one outer `overflow-y-auto` row container so a row in the table always lines
  up with its bar (no JS scroll-sync needed for vertical; the shared parent handles it). Horizontal scroll is
  the right pane only.
- **Gridlines:** vertical rules at each `tick.x` (`hsl(var(--border))`, 1px) spanning `contentHeight`;
  horizontal rules at each row boundary (`hsl(var(--border) / 0.7)`, matching the table's row dividers). Both
  drawn in the same SVG layer as the edges (one overlay, painted under the bars).

### D6 — Zoom toggle UI = the existing `ViewToggle` segmented control grammar (32px, DESIGN.md §5)
A 4-segment `seg` control labelled **Day · Week · Month · Quarter**, right-aligned in a thin toolbar above the
split (left side holds the figure caption / undated count). `role="tablist"`, `aria-selected`, 32px track,
"on" = white pill + `0 1px 2px` lift (the documented segmented pattern). Default = `month` (today's view).

### D7 — a11y
- The `<figure role="img" aria-label={summary}>` wrapper is **preserved** (NFR-GANTT-A11Y-001). The summary
  string is extended: `… N dependencies drawn, scale: {scale}` (and `, M dependency(ies) hidden (endpoint undated)`
  when any edge is skipped per D3).
- **Keyboard grid nav.** The left task-table is a real `role="grid"` (rows `role="row"`, cells
  `role="gridcell"`) with **roving tabindex**: ArrowUp/Down move the focused row, ArrowRight focuses the row's
  bar in the timeline, ArrowLeft returns to the table, Enter/Space fires `onActivateTask`. This gives a
  keyboard path across BOTH panes (the table is the spine; the timeline is reachable from it).
- **Bars/diamonds/edges ARIA.** Each bar keeps its `aria-label` (`{name}: {status}, {startIso}–{endIso}`).
  Each diamond: `role="img"` + `aria-label={`${name} milestone — target ${targetIso}`}`. The edge SVG is
  `aria-hidden="true"` (decorative — the dependency relationship is also conveyed as text: the successor bar's
  `aria-label` gains `, depends on {predecessorName}` so the relationship is never SVG-only; this preserves the
  v1 "depends on N" information non-visually). Today line + gridlines stay `aria-hidden`.
- Respects `prefers-reduced-motion` (no bar-grow / no edge-draw animation when set — reuse
  `usePrefersReducedMotion`, already imported).

### D8 — Tokens (strict DESIGN.md — no raw hex, no off-scale px)
- Diamonds + today line: `hsl(var(--primary))` / `…/0.25` guide. Bars: existing `hsl(var(--primary)/0.15)` fill,
  `…/0.35` border (unchanged). Edges + arrowheads: `hsl(var(--muted-foreground)/0.55)`. Gridlines:
  `hsl(var(--border))` (vertical) / `…/0.7` (horizontal) — sourced via `chartTheme.grid`. Status: the existing
  `StatusPill` + `workflowVariant` (never color-only). Type: 11–12px label scale, `tabular-nums` on the date
  columns. Radii from the 4/6/8/10 scale; the diamond is a rotated 10px square (`rounded-[2px]` corner). The
  `pxPerDay`/row-height constants are **layout geometry, not design tokens** (like the existing `BAR_H=28`,
  `ROW_H=40`) — they live as named consts in the component, not raw magic numbers inline.

### D9 — ADR: **yes — one new ADR for the edge-model seam**
The `GanttGeometry` + `GanttEdge` model and the "build-and-own referencing frappe-gantt" provenance are a
**durable seam** Phase-B (drag-scheduling) will build directly on (drag mutates dates → recompute geometry →
re-route edges). That is a cross-cutting, reused contract → **ADR-0031 — Gantt geometry + dependency-edge model
(build-and-own)**. Records: the pixel-aware-config extension (back-compat with v1 fractions), the edge
resolution + elbow-routing algorithm (frappe-gantt MIT attribution), why connectors are structural (not
action-blue), and the Phase-A/Phase-B boundary. (v1's D10 said "no ADR"; Phase-A crosses that bar because it
introduces a reused geometry contract, not just a render.)

### D10 — No data/schema/RLS/repository change
Pure presentational + pure-model work. No migration, no RPC, no `org_id` surface, no new read — the Tasks tab
already fetches `useTasks` + `useMilestones`. NFR-GANTT-PERF-001 (zero new round-trip) holds. No security
surface to audit beyond confirming "no write added".

---

## 2. Architecture & files

| File | New? | Role |
|---|---|---|
| `pmo-portal/src/lib/gantt/ganttLayout.ts` | EDIT | Add `GanttLayoutConfig`, `GanttGeometry`, `GanttEdge`, `GanttScale`; optional pixel-aware geometry + `buildEdges` + `buildTicks(scale)`. v1 fraction path unchanged when config omitted. |
| `pmo-portal/src/lib/gantt/ganttGeometry.ts` | NEW | Pure SVG-path helpers: `edgePath(edge): string`, `arrowHead(edge): string`, `SCALE_PX_PER_DAY` map. Kept separate so geometry-string tests are isolated. |
| `pmo-portal/src/lib/gantt/__tests__/ganttLayout.test.ts` | EDIT | Existing v1 ACs stay; ADD geometry + edge + zoom-tick cases (AC-GANTT-011/012/013). |
| `pmo-portal/src/lib/gantt/__tests__/ganttGeometry.test.ts` | NEW | Unit tests for `edgePath`/`arrowHead` path-string geometry (AC-GANTT-012). |
| `pmo-portal/pages/project-detail/ProjectGantt.tsx` | EDIT | Split layout (table + timeline), on-axis diamonds (bug fix), edge SVG overlay, zoom toggle, grid a11y. |
| `pmo-portal/pages/project-detail/__tests__/ProjectGantt.test.tsx` | EDIT | v1 RTL ACs stay; ADD diamond-on-axis (AC-GANTT-014 — graduates the bug), connector-present (AC-GANTT-015), zoom-toggle (AC-GANTT-016), grid-a11y (AC-GANTT-017), table-pane (AC-GANTT-018). |
| `docs/adr/0031-gantt-geometry-and-dependency-edge-model.md` | NEW | The geometry + edge-model seam decision (D9). |

**Data flow (unchanged direction):** `TasksTab` (`useTasks`+`useMilestones`, already fetched) → props →
`ProjectGantt` → `buildGanttModel(tasks, milestones, today, { scale, … })` (pure) → `{ lanes, geometry:{ bars[],
markers[], edges[] }, ticks }` → SVG + DOM. One-directional, no writes.

### Load-bearing signatures (type-consistent across all tasks)
```ts
// src/lib/gantt/ganttLayout.ts  (additions — existing exports unchanged)
export type GanttScale = 'day' | 'week' | 'month' | 'quarter';

export interface GanttLayoutConfig {
  scale: GanttScale;
  /** Row height in px (timeline + table rows aligned). Default 40 (= v1 ROW_H). */
  rowHeight: number;
  /** Lane-header (milestone band) height in px. Default 36. */
  laneHeaderHeight: number;
  /** Axis height in px. Default 32. */
  axisHeight: number;
}

/** Absolute-px geometry for one laid-out bar within the timeline content box. */
export interface GanttBarBox { id: string; xStart: number; xEnd: number; y: number; h: number; }
export interface GanttMarkerBox { id: string; x: number; y: number; }

export interface GanttGeometry {
  contentWidth: number;   // total timeline px width (spanDays * pxPerDay)
  contentHeight: number;  // total px height of all lanes/rows
  pxPerDay: number;
  bars: GanttBarBox[];
  markers: GanttMarkerBox[];
  edges: GanttEdge[];
  /** Edges that could not be drawn because an endpoint bar is undated/absent. */
  hiddenEdgeCount: number;
}

// GanttModel gains ONE optional field (null when no config passed → v1 behaviour):
export interface GanttModel {
  /* …all v1 fields unchanged… */
  geometry: GanttGeometry | null;
}

export function buildGanttModel(
  tasks: TaskWithRefs[],
  milestones: MilestoneWithProgress[],
  todayIso: string,
  config?: GanttLayoutConfig,   // NEW optional 4th arg — omit → geometry:null, v1-identical
): GanttModel;
```
```ts
// src/lib/gantt/ganttGeometry.ts
import type { GanttEdge, GanttScale } from './ganttLayout';
export const SCALE_PX_PER_DAY: Record<GanttScale, number> =
  { day: 28, week: 16, month: 6, quarter: 2 };
export const EDGE_GAP = 12;   // elbow stub length (px)
export const EDGE_ARROW = 6;  // arrowhead inset (px)
/** Orthogonal elbow SVG path for a finish-to-start edge (frappe-gantt blueprint, MIT). */
export function edgePath(e: GanttEdge): string;
/** Arrowhead polygon points string at the successor start, pointing right. */
export function arrowHead(e: GanttEdge): string;
```

---

## 3. Requirements (EARS) — Phase-A additions (FR-GANTT-001..008 from v1 still hold)

- **FR-GANTT-011** — When the Timeline view renders a dated milestone, the system shall draw a **diamond
  marker positioned on the time axis** at the milestone's target date (not a header badge).
- **FR-GANTT-012** — Where a task depends on another and **both** bars are plotted, the system shall draw a
  **connector line** from the predecessor bar's end to the successor bar's start, with an arrowhead at the
  successor; where an endpoint is undated, the system shall **omit** that connector and acknowledge the count
  in the figure summary.
- **FR-GANTT-013** — The Timeline shall present a **left task table** (name, status, dates) and a **right
  timeline**, vertically aligned row-for-row, with the table sticky and the timeline horizontally scrollable.
- **FR-GANTT-014** — Where the user selects a **scale** (Day / Week / Month / Quarter), the system shall
  recompute the axis ticks and bar/marker/edge geometry at that granularity; the default scale shall be Month.
- **NFR-GANTT-A11Y-002** — The task table shall be a keyboard-navigable `role="grid"` (roving tabindex,
  Arrow/Enter); bars and diamonds shall carry text `aria-label`s; connector lines shall be `aria-hidden` with
  the dependency relationship also conveyed as text on the successor's label; the `role="img"` figure summary
  shall be preserved.
- **NFR-GANTT-PERF-002** — Phase-A shall add **no** network round-trip and shall recompute geometry purely
  client-side from the already-fetched caches (memoised per `[tasks, milestones, today, scale]`).

---

## 4. Acceptance criteria (Given/When/Then) + traceability (ADR-0010)

| AC | Given / When / Then | Owning layer | File |
|---|---|---|---|
| **AC-GANTT-011** | Given a `config` is passed, When `buildGanttModel` runs, Then `geometry` is non-null with `pxPerDay = SCALE_PX_PER_DAY[scale]`, `contentWidth = spanDays*pxPerDay`, and one `GanttBarBox` per plotted bar with `xEnd = xStart + width*spanDays*pxPerDay`. | Unit (Vitest) | `ganttLayout.test.ts` |
| **AC-GANTT-012** | Given a predecessor→successor dependency where both are dated, When geometry builds, Then an edge `{x1=predEnd, y1=predRowMid, x2=succStart, y2=succRowMid, forward}` is produced and `edgePath`/`arrowHead` yield a valid elbow path string ending at `(x2,y2)`; Given an undated endpoint, Then no edge and `hiddenEdgeCount` increments. | Unit | `ganttLayout.test.ts` + `ganttGeometry.test.ts` |
| **AC-GANTT-013** | Given the same data at scale `day` vs `month`, When the model rebuilds, Then `pxPerDay`/`contentWidth`/tick count differ accordingly and tick `iso`s match the chosen granularity (day ticks vs month-start ticks). | Unit | `ganttLayout.test.ts` |
| **AC-GANTT-014** *(graduates the milestone bug)* | Given a dated milestone, When the Timeline renders, Then a diamond marker is in the DOM **positioned at the milestone's axis fraction** (its `left%`/`x` reflects `target_date`, within tolerance) and **no** right-aligned header date-badge is rendered. | Unit (RTL) | `ProjectGantt.test.tsx` |
| **AC-GANTT-015** | Given two tasks with a dependency where both are dated, When the Timeline renders, Then a connector `<path>`/`<svg>` element is present and the successor bar's `aria-label` names the predecessor dependency. | Unit (RTL) | `ProjectGantt.test.tsx` |
| **AC-GANTT-016** | Given the Timeline, When the user selects the **Day** scale segment, Then the model is rebuilt at `day` granularity (timeline widens — `data-scale="day"` / day ticks appear) and Month is no longer selected. | Unit (RTL) | `ProjectGantt.test.tsx` |
| **AC-GANTT-017** | Given the Timeline, When inspected, Then the left task table exposes `role="grid"` with roving-tabindex rows, ArrowDown moves focus, and Enter on a row fires `onActivateTask`; the figure keeps `role="img"`. | Unit (RTL) | `ProjectGantt.test.tsx` |
| **AC-GANTT-018** | Given dated tasks, When the Timeline renders, Then the left pane shows each task's **name, status pill, and date range** in a row vertically aligned to its bar (same row index/height). | Unit (RTL) | `ProjectGantt.test.tsx` |

**No e2e / pgTAP AC.** Phase-A is pure geometry + render state — no write, no RLS, no cross-stack flow. Every
behavior is owned at the lowest sufficient layer (Vitest/RTL) per ADR-0010. The existing curated Tasks-tab
e2e journey is unaffected (Timeline remains a non-default view toggle).

**v1 regression guard:** AC-GANTT-001..010 tests stay green **unchanged** (D1 back-compat). Task 1 verifies
this explicitly before any new code.

---

## 5. Tasks (TDD, 2–5 min each, red → green)

> Run all commands from `/Users/ariefsaid/Coding/PMO/pmo-portal`.

### Task 0 — ADR-0031 (the geometry/edge seam)
- **File (new):** `docs/adr/0031-gantt-geometry-and-dependency-edge-model.md`
- Context (v1 fraction model can't express edges/rows; Phase-B will reuse this); Decision (optional
  pixel-aware config extending `buildGanttModel` back-compat; `GanttGeometry`/`GanttEdge`; elbow routing per
  frappe-gantt MIT with attribution; connectors are structural `muted-foreground`, not action-blue; Phase-A vs
  Phase-B boundary); Consequences (Phase-B drag recomputes geometry; no schema/auth surface).
- **Verify:** `test -f docs/adr/0031-gantt-geometry-and-dependency-edge-model.md`

### Task 1 — Confirm v1 baseline is green (regression floor)
- **Verify:** `npm test -- ganttLayout ProjectGantt` — all v1 AC-GANTT-001..010 pass on the untouched code.
  (Establishes the back-compat oracle Task 3 must not break.)

### Task 2 (RED) — Unit test: pixel geometry — **AC-GANTT-011**
- **File:** `src/lib/gantt/__tests__/ganttLayout.test.ts` — add a `describe('AC-GANTT-011: pixel geometry …')`.
- `it('AC-GANTT-011: config yields px geometry with correct contentWidth and bar boxes', …)`:
  two tasks over the 10-day span (`2026-01-01..2026-01-11`), call
  `buildGanttModel(tasks, [], '2026-01-05', { scale:'month', rowHeight:40, laneHeaderHeight:36, axisHeight:32 })`;
  assert `model.geometry` non-null, `geometry.pxPerDay === 6`, `contentWidth === 10*6` (60), and the bar box for
  task A has `xStart` ≈ 0 and `xEnd` ≈ 60 (`width 1`), B `xStart` ≈ 30 `xEnd` ≈ 60.
- Add `it('AC-GANTT-011: omitting config keeps geometry null (v1 back-compat)', …)`: same call WITHOUT the 4th
  arg → `model.geometry === null` and `model.lanes` identical to v1.
- **Verify (must fail):** `npm test -- ganttLayout`

### Task 3 (GREEN) — Implement pixel geometry in `buildGanttModel` — **AC-GANTT-011/013**
- **File:** `src/lib/gantt/ganttLayout.ts`
- Add the new exported types (`GanttScale`, `GanttLayoutConfig`, `GanttBarBox`, `GanttMarkerBox`,
  `GanttGeometry`, `GanttEdge`) and the optional `config?` 4th param + `geometry: GanttGeometry | null` field.
- Import `SCALE_PX_PER_DAY` from `./ganttGeometry` (created in Task 6 — pre-create the const-only stub now, or
  inline the map here and re-export; **decision:** define `SCALE_PX_PER_DAY` in `ganttGeometry.ts` and import,
  to keep the px-map next to the path helpers; create that file's const in this task, path fns in Task 6).
- When `config` is present: `pxPerDay = SCALE_PX_PER_DAY[config.scale]`; walk the same lane/bar build but also
  accumulate a running `y` (axis already consumed; each lane adds `laneHeaderHeight` then `rowHeight` per bar);
  compute each bar's `xStart = left*spanDays*pxPerDay`, `xEnd = (left+width)*spanDays*pxPerDay`, `y`, `h=barH`
  (barH = `min(28, rowHeight-12)`); markers `x = marker.left*spanDays*pxPerDay`, `y =` lane-header mid.
  `contentWidth = spanDays*pxPerDay`, `contentHeight = running y`. Set `edges`/`hiddenEdgeCount` in Task 5.
- When `config` is **absent**: `geometry = null` (return v1 shape exactly).
- **Verify:** `npm test -- ganttLayout` (Task 2 green; Task 1 v1 cases still green).

### Task 4 (RED) — Unit test: zoom ticks — **AC-GANTT-013**
- **File:** `src/lib/gantt/__tests__/ganttLayout.test.ts` — add
  `it('AC-GANTT-013: day scale produces day ticks and a wider timeline than month', …)`: a 3-month-span task;
  build at `scale:'month'` then `scale:'day'`; assert `day` `geometry.contentWidth` > `month` `contentWidth`,
  and the `day` model's `ticks` are denser (more ticks) with day-resolution `iso`s, while `month` ticks match
  the existing month-start behaviour.
- **Verify (must fail):** `npm test -- ganttLayout`

### Task 5 (GREEN) — Implement `buildTicks(scale)` + `buildEdges` — **AC-GANTT-012/013**
- **File:** `src/lib/gantt/ganttLayout.ts`
- Refactor `buildMonthTicks` → `buildTicks(spanStart, spanEnd, spanDays, scale)`: `month` path = the existing
  code verbatim (preserves the v1 axis-tick test); `quarter` = month-start where month ∈ {0,3,6,9}; `week` =
  every Monday in span; `day` = every day (label every Nth to avoid clutter — label all, the component thins
  visually). Each tick keeps `{iso,left,label}`; `left` stays a fraction (component multiplies by
  `contentWidth`). Dispatch from `buildGanttModel`.
- Implement `buildEdges(barById, datedTasks): { edges, hiddenEdgeCount }` per D3 (FS resolution, skip-missing,
  sort by `(y1,y2)`). Call it inside the `config`-present branch and assign to `geometry.edges`/`hiddenEdgeCount`.
- **Verify:** `npm test -- ganttLayout` (Tasks 2 & 4 green; all v1 ACs green).

### Task 6 (RED→GREEN) — `ganttGeometry.ts` path helpers — **AC-GANTT-012**
- **File (new):** `src/lib/gantt/__tests__/ganttGeometry.test.ts` (RED first):
  - `it('AC-GANTT-012: forward edge path is an elbow from pred-end to succ-start ending at (x2,y2)', …)`:
    edge `{x1:60,y1:20,x2:120,y2:60,forward:true,…}` → `edgePath` returns a string starting `M60,20` and
    containing the successor approach `H114` (`x2-ARROW`); `arrowHead` points at `(120,60)`.
  - `it('AC-GANTT-012: backward edge wraps around (successor before predecessor)', …)`:
    `{x1:120,y1:20,x2:40,y2:60,forward:false}` → path includes a mid-Y detour (`V40` then `H` toward `x2-GAP`).
- **File (new):** `src/lib/gantt/ganttGeometry.ts` (GREEN): implement `SCALE_PX_PER_DAY`, `EDGE_GAP`,
  `EDGE_ARROW`, `edgePath`, `arrowHead` per D3. (Re-exported `SCALE_PX_PER_DAY` is the one `ganttLayout`
  imported in Task 3.)
- **Verify:** `npm test -- ganttGeometry ganttLayout`

### Task 7 (RED) — RTL: diamond-on-axis bug fix — **AC-GANTT-014**
- **File:** `pages/project-detail/__tests__/ProjectGantt.test.tsx` — add
  `describe('AC-GANTT-014: milestone renders as an on-axis diamond at its target-date position (not a header badge)')`:
  - `it('AC-GANTT-014: a dated milestone renders a diamond positioned at its target-date fraction', …)`:
    one task `2026-01-01..2026-01-11` under `ms1`, milestone `ms1` `target_date:'2026-01-06'`; render; query the
    diamond by `aria-label` `/phase 1 milestone — target 2026-01-06/i`; assert it is present **and** its inline
    `left`/`style` reflects ~50% (mid-span) — i.e. NOT pinned to the right header. Assert the old badge text
    pattern (`/⬥ 2026-01-06/`) is **absent** (`queryByText` → null).
- **Verify (must fail):** `npm test -- ProjectGantt`

### Task 8 (RED) — RTL: connectors + zoom + grid-a11y + table — **AC-GANTT-015/016/017/018**
- **File:** `pages/project-detail/__tests__/ProjectGantt.test.tsx` — add:
  - `it('AC-GANTT-015: a dependency between two dated tasks draws a connector and labels the relationship', …)`:
    task B depends on A (both dated, different rows); render; assert at least one `path` exists inside an
    `svg` in the figure (`container.querySelector('svg path')`), and B's bar `aria-label` matches `/depends on/i`.
  - `it('AC-GANTT-016: selecting the Day scale rebuilds the timeline at day granularity', …)`:
    render; `getByRole('tab', { name: /day/i })`, click; assert the figure root carries `data-scale="day"` (and
    Month tab `aria-selected="false"`).
  - `it('AC-GANTT-017: the task table is a keyboard grid and Enter fires onActivateTask', …)`:
    render with `onActivateTask` spy; `getByRole('grid')`; focus first row, `keyDown ArrowDown` then `Enter`;
    assert the spy was called with the expected task.
  - `it('AC-GANTT-018: the left table shows each task name, status, and date range aligned to its bar', …)`:
    one task `In Progress`, `2026-01-01..2026-01-11`; assert table cells show the name, the `In Progress` pill,
    and the date range text — all present.
- **Verify (must fail):** `npm test -- ProjectGantt`

### Task 9 (GREEN) — Rebuild `ProjectGantt.tsx` (split layout, diamonds, edges, zoom, grid) — **AC-GANTT-014..018, FR-GANTT-011..014**
- **File:** `pages/project-detail/ProjectGantt.tsx`
- Add `const [scale, setScale] = useState<GanttScale>('month')`. Build the model with the config:
  `buildGanttModel(tasks, milestones, today, { scale, rowHeight: ROW_H, laneHeaderHeight: LANE_HEADER_H, axisHeight: AXIS_H })`.
- Replace the single scroll figure with: a thin toolbar (`<div role="tablist">` Day/Week/Month/Quarter
  segmented, D6) + a 2-pane row inside one `overflow-y-auto` container:
  - **Left:** `<div role="grid">` task table (sticky `left:0`, `width:260`), milestone group rows + task rows
    (`role="row"`/`role="gridcell"`), roving tabindex + Arrow/Enter handlers (D7); Name cell = the
    `onActivateTask` button.
  - **Right:** `overflow-x-auto`; an inner content box `width:{geometry.contentWidth}`,
    `height:{geometry.contentHeight}`; one `<svg aria-hidden width=contentWidth height=contentHeight>` painting
    (a) horizontal/vertical gridlines, (b) `geometry.edges.map(e => <path d={edgePath(e)} …/> + arrowhead)`;
    then the axis ticks, today line, bars (`geometry.bars` → absolute `left:xStart`, `width:xEnd-xStart`,
    `top:y`), and the **diamonds** (`geometry.markers` → rotated 10px square at `x`, with the dotted guide, D4).
- **Remove** the header badge (`:212`) and the inline "depends on N" chip (`:321`) — the relationship now lives
  in the bar's `aria-label` + the drawn connector.
- Extend the `summary` string (D7). Preserve `<figure role="img" aria-label={summary}>`, the empty state, the
  undated footer, `prefers-reduced-motion`, and the `onActivateTask` contract on bars/diamonds/rows. Add
  `data-scale={scale}` on the figure (for AC-GANTT-016).
- Keep ALL tokens per D8 (no raw hex/off-scale px).
- **Verify:** `npm test -- ProjectGantt && npm run typecheck`

### Task 10 — Full gate + lint
- **Verify:**
  `npm test -- ganttLayout ganttGeometry ProjectGantt && npm run typecheck && npm run lint`
- All AC-GANTT-001..018 green; zero type/lint errors.

### Task 11 — Rendered design check (Discover, ADR-0030 mode)
- Per `docs/qa-portfolio.md` review-mode: a vision/owner rendered glance of the Timeline on the rich solar seed
  at desktop + 390px and at each scale — confirm diamonds sit on the axis, connectors route cleanly (no
  overlap with bars at month scale), the table aligns row-for-row, and the One-Blue rule holds (connectors are
  grey, not blue). Any finding graduates to a test per ADR-0030.

---

## 6. Collision / isolation note
- **Edits** confined to the Gantt slice: `ganttLayout.ts` (additive — new optional arg + field, v1 path
  byte-identical), `ProjectGantt.tsx` (internal rewrite, same props + same `onActivateTask` contract), and the
  two test files. **New:** `ganttGeometry.ts` + its test + ADR-0031. `TasksTab.tsx` is **untouched** (same
  `<ProjectGantt tasks milestones onActivateTask?>` signature). No schema, RLS, repository, hook, or RPC.
- No overlap with any in-flight CRM/procurement/approvals work.

## 7. Open questions for the Director
1. **OQ-1 (zoom default + persistence):** default scale = **Month** (matches today's view). Persisting the
   user's last-chosen scale (localStorage / URL param) is **out of Phase-A scope** — confirm defer to Phase-B.
2. **OQ-2 (day-scale label density):** at `day` scale a 6-month project = ~180 ticks. Plan thins labels
   visually (every 7th label) while keeping all gridlines. Confirm that's acceptable vs. capping `day` scale to
   projects under a span threshold.
3. **OQ-3 (cross-lane edge volume):** dense dependency graphs can draw many crossing elbows. Phase-A draws all
   resolvable edges (no bundling/declutter). If a real project looks noisy in the Task 11 render, edge-bundling
   graduates to Phase-B — confirm acceptable for MVP.

None are blocking; defaults are as written.
