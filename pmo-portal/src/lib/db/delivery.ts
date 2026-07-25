/**
 * Pure derivation functions for delivery milestone % calculations (AC-DEL-001..007).
 *
 * These functions mirror the SQL derivation in get_project_milestones / get_projects_delivery
 * (migration 0023) — they are the testable oracle for the display layer. The RPC SQL is the
 * authoritative server-side derivation; both implement the identical formula (FR-DEL-004..006).
 */

/** Rows eligible for milestone/delivery rollups: top-level and not archived. */
export function isRollupTask(task: { parent_task_id: string | null; archived_at?: string | null }): boolean {
  return task.parent_task_id == null && task.archived_at == null;
}

/** Calculated % = Done/total × 100; null when there are no tasks (FR-DEL-004). */
export function calculatedPct(done: number, total: number): number | null {
  if (total <= 0) return null;
  return (done * 100) / total;
}

/** Effective % = input ?? calculated ?? 0 (FR-DEL-005). */
export function effectivePct(args: { input: number | null; calculated: number | null }): number {
  return args.input ?? args.calculated ?? 0;
}

/**
 * Project delivery % = Σ(w·eff)/Σw; null when there are no milestones (FR-DEL-006).
 *
 * I-1 no-signal suppression: also returns null when EVERY milestone has no signal
 * (calculated_pct is null AND input_pct is null), to avoid showing a misleading "0%"
 * chip on projects whose milestones simply have no tasks and no PM input yet.
 * A genuine 0% (at least one milestone has tasks but none are Done, or input_pct=0)
 * still renders.
 */
export function projectDeliveryPct(
  ms: { weight: number; effective: number; hasSignal?: boolean }[],
): number | null {
  if (ms.length === 0) return null;
  // If hasSignal is provided for all entries and none carry a signal, suppress the chip.
  const allHaveSignalField = ms.every((m) => 'hasSignal' in m);
  if (allHaveSignalField && ms.every((m) => !m.hasSignal)) return null;
  const sumW = ms.reduce((a, m) => a + m.weight, 0);
  if (sumW === 0) return null;
  return ms.reduce((a, m) => a + m.weight * m.effective, 0) / sumW;
}
