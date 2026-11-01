// When the sweep's hourly work runs (THEME-BACK-40): the cadence vocabulary and the per-org due rule.
// Pure — no I/O — so the scheduling policy is readable and testable without the entry point.

/**
 * Owner ruling 2026-10-23: money postings reach ERPNext near-instantly. `full` runs every pass;
 * `money-only` (between the hourly statement windows) runs just the outbound money passes —
 * (1) outbox recovery, (5) budget, (6) timesheets, (7) expenses — still under the per-org lock.
 */
export type ErpSweepCadence = 'full' | 'money-only';

/** 0358: an org's hourly work is due once its last completed full run is at least this old. */
export const SWEEP_FULL_INTERVAL_MS = 55 * 60_000;
/** A binding still building its first statement publication keeps the full sweep every five minutes. */
export const SWEEP_BACKFILL_EVERY_MINUTES = 5;
/** Delay before a failed hourly run is retried; a merely truncated run continues on the next tick. */
export const SWEEP_RETRY_DELAY_SECONDS = 300;
/** No hourly pass starts this long after the invocation began (the function's wall-clock cap is 150 s). */
export const HOURLY_INVOCATION_DEADLINE_MS = 120_000;

/** Whether an org's hourly work is due: never run, unreadable, or completed at least 55 minutes ago. */
export function fullSweepDue(lastFullSweepAt: string | null | undefined, nowMs: number): boolean {
  const last = lastFullSweepAt ? Date.parse(lastFullSweepAt) : Number.NaN;
  return !Number.isFinite(last) || nowMs - last >= SWEEP_FULL_INTERVAL_MS;
}

/** Tick-wide: on a five-minute tick, `full` while some binding lacks its first statement publication. */
export async function sweepCadenceAt(entryMs: number, allPublished: () => Promise<boolean>): Promise<ErpSweepCadence> {
  const minute = new Date(entryMs).getUTCMinutes();
  if (minute % SWEEP_BACKFILL_EVERY_MINUTES !== 0) return 'money-only';
  return (await allPublished()) ? 'money-only' : 'full';
}
