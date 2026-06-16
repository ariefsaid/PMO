/**
 * Pure SVG-path + scale helpers for the Gantt v2 dependency connectors (ADR-0031).
 *
 * No DOM, no React — every function is a pure string/number transform over the
 * absolute-px geometry produced by `buildGanttModel(…, config)`. Kept separate from
 * `ganttLayout.ts` so the path-string geometry is unit-isolated.
 *
 * Connector routing follows the frappe-gantt elbow blueprint (MIT,
 * https://github.com/frappe/gantt) — re-implemented against our tokens/a11y, per
 * ADR-0030 §F build-and-own.
 */
import type { GanttEdge, GanttScale } from './ganttLayout';

/** Pixels-per-day for each zoom scale (ADR-0031 §5). */
export const SCALE_PX_PER_DAY: Record<GanttScale, number> = {
  day: 28,
  week: 16,
  month: 6,
  quarter: 2,
};

/** Elbow stub length (px) — how far a connector runs straight before turning. */
export const EDGE_GAP = 12;

/** Arrowhead inset (px) — the connector stops this short of the successor start. */
export const EDGE_ARROW = 6;

/** Half-height of the arrowhead triangle (px). */
const ARROW_HALF = 4;

/** Rounds to avoid sub-pixel noise in the emitted path strings (stable + crisp). */
const r = (n: number): number => Math.round(n * 100) / 100;

/**
 * Orthogonal elbow SVG path for a finish-to-start dependency edge (frappe-gantt
 * blueprint, MIT). The path STOPS `EDGE_ARROW` px short of the successor start so the
 * separate arrowhead polygon (`arrowHead`) caps it.
 *
 *  - Forward (`x2 >= x1`): out from the predecessor end, drop to the successor row,
 *    run into the successor start —  `M x1,y1  H x1+GAP  V y2  H x2-ARROW`.
 *  - Backward (`x2 < x1`): wrap around via the mid-Y between the two rows —
 *    `M x1,y1  H x1+GAP  V midY  H x2-GAP  V y2  H x2-ARROW`.
 */
export function edgePath(e: GanttEdge): string {
  const stubOut = e.x1 + EDGE_GAP;
  const approach = e.x2 - EDGE_ARROW;

  if (e.forward) {
    return `M${r(e.x1)},${r(e.y1)} H${r(stubOut)} V${r(e.y2)} H${r(approach)}`;
  }

  const midY = (e.y1 + e.y2) / 2;
  const backIn = e.x2 - EDGE_GAP;
  return (
    `M${r(e.x1)},${r(e.y1)} H${r(stubOut)} V${r(midY)} ` +
    `H${r(backIn)} V${r(e.y2)} H${r(approach)}`
  );
}

/**
 * Arrowhead polygon points string at the successor start `(x2, y2)`, pointing right.
 * Three points: the tip at `(x2, y2)` and two tail points `EDGE_ARROW` px back.
 */
export function arrowHead(e: GanttEdge): string {
  const tipX = e.x2;
  const tailX = e.x2 - EDGE_ARROW;
  return (
    `${r(tipX)},${r(e.y2)} ` +
    `${r(tailX)},${r(e.y2 - ARROW_HALF)} ` +
    `${r(tailX)},${r(e.y2 + ARROW_HALF)}`
  );
}
