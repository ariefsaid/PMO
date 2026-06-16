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
