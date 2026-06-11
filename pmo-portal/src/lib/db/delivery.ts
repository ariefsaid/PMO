/**
 * Pure derivation functions for delivery milestone % calculations (AC-DEL-001..007).
 *
 * These functions mirror the SQL derivation in get_project_milestones / get_projects_delivery
 * (migration 0023) — they are the testable oracle for the display layer. The RPC SQL is the
 * authoritative server-side derivation; both implement the identical formula (FR-DEL-004..006).
 */

/** Calculated % = Done/total × 100; null when there are no tasks (FR-DEL-004). */
export function calculatedPct(done: number, total: number): number | null {
  if (total <= 0) return null;
  return (done * 100) / total;
}

/** Effective % = input ?? calculated ?? 0 (FR-DEL-005). */
export function effectivePct(args: { input: number | null; calculated: number | null }): number {
  return args.input ?? args.calculated ?? 0;
}

/** Project delivery % = Σ(w·eff)/Σw; null when there are no milestones (FR-DEL-006). */
export function projectDeliveryPct(ms: { weight: number; effective: number }[]): number | null {
  if (ms.length === 0) return null;
  const sumW = ms.reduce((a, m) => a + m.weight, 0);
  if (sumW === 0) return null;
  return ms.reduce((a, m) => a + m.weight * m.effective, 0) / sumW;
}
