import type { WaitingMaterialAlert } from '@/src/lib/db/workOrderMaterialAlerts';

/**
 * The needs-you pointer for work orders whose material issued runs ahead of progress (docs/specs/material-vs-progress.spec.md FR-MVP-009).
 * Pure: rows come from `my_open_material_alerts`, derived from open alert rows, so a resolved alert is simply absent on the next read.
 */
export interface WaitingMaterialAlertsFact {
  /** Work orders with at least one item ahead. */
  count: number;
  /** The project's work-order tab when every alert is on one project, else the project list. */
  href: string;
}

export function summariseWaitingMaterialAlerts(rows: ReadonlyArray<WaitingMaterialAlert>): WaitingMaterialAlertsFact | null {
  if (rows.length === 0) return null;
  const projects = new Set(rows.map((r) => r.projectId));
  return {
    count: rows.length,
    href: projects.size === 1 ? `/projects/${encodeURIComponent(rows[0].projectId)}/work-orders` : '/projects',
  };
}
