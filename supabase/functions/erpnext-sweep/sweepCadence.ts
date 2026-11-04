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

/**
 * The financial-statement report batch keeps its OWN freshness marker (`erp_statement_pass_run`)
 * instead of the full-run marker, so the batch cadence is independent of how often the full run
 * happens: 0358 leaves a deferred full run due again on the next tick, which is the right shape for
 * the inbound passes and the wrong shape for a resumable report batch.
 */
export const STATEMENT_PASS_INTERVAL_MS = SWEEP_FULL_INTERVAL_MS;
/**
 * An unfinished or failed statement pass is retried on #1212's five-minute backfill cadence — never
 * the next one-minute tick, and never a whole hour (an open batch is resumable and should keep
 * making progress).
 */
export const STATEMENT_PASS_RETRY_DELAY_SECONDS = SWEEP_BACKFILL_EVERY_MINUTES * 60;

/** Whether an org's statement pass is due: never run, unreadable, or completed at least an hour ago. */
export function statementPassDue(lastStatementPassAt: string | null | undefined, nowMs: number): boolean {
  const last = lastStatementPassAt ? Date.parse(lastStatementPassAt) : Number.NaN;
  return !Number.isFinite(last) || nowMs - last >= STATEMENT_PASS_INTERVAL_MS;
}

/** Tick-wide: on a five-minute tick, `full` while some binding lacks its first statement publication. */
export async function sweepCadenceAt(entryMs: number, allPublished: () => Promise<boolean>): Promise<ErpSweepCadence> {
  const minute = new Date(entryMs).getUTCMinutes();
  if (minute % SWEEP_BACKFILL_EVERY_MINUTES !== 0) return 'money-only';
  return (await allPublished()) ? 'money-only' : 'full';
}
