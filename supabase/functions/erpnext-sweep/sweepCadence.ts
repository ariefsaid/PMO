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
/** Delay before the FIRST failed hourly run is retried; a merely truncated run continues on the next tick. */
export const SWEEP_RETRY_DELAY_SECONDS = 300;
/**
 * #1642: each consecutive failure doubles the retry delay (300, 600, 1200, 2400 s), capped at the hourly
 * interval so a persistently failing org reruns its hourly workload at most once per full interval (55 min). `failures` is the
 * stored count of failures since the last completed run (`erp_sweep_full_run.consecutive_failures`).
 */
export function sweepRetryDelaySeconds(failures: number): number {
  // 20 doublings is far past the cap; the bound only keeps `2 ** n` finite. NaN / negative -> 0 (the first delay).
  const n = failures > 0 ? Math.min(Math.floor(failures), 20) : 0;
  return Math.min(SWEEP_RETRY_DELAY_SECONDS * 2 ** n, SWEEP_FULL_INTERVAL_MS / 1000);
}
/** No hourly pass starts this long after the invocation began. Kept below the last moment a money try can start
 *  (#2149: `SWEEP_INVOCATION_DEADLINE_MS` − the outcome margin − a minimum try, 115 s), so money keeps priority. */
export const HOURLY_INVOCATION_DEADLINE_MS = 105_000;
/** #2149: the deadline the hourly passes' ERP tries share, this long after the invocation began. A try gets at most the
 *  time left before it minus the outcome margin, so every hourly try ends by 115 s, the last moment a money try can
 *  start; and none starts unless a full minimum try fits, so none starts after 95 s. */
export const HOURLY_TRY_DEADLINE_MS = 125_000;
/** #2149: the one deadline every ERP try in an invocation shares, this long after it began. Under the function's
 *  150 s wall-clock cap; the few seconds left cover the run summary and lock release. Each try is given at most the
 *  time left minus the outcome-write margin, and none starts unless a full minimum try fits (`sweepShared.ts`). */
export const SWEEP_INVOCATION_DEADLINE_MS = 145_000;

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
/** Deferred segments become eligible at the next UTC five-minute boundary. They run only on a
 * qualifying full sweep; already-published bindings retain the ordinary full-run retry policy. */
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

/** The cron starts the sweep once a minute. */
export const SWEEP_TICK_INTERVAL_MS = 60_000;
/**
 * Which tick of the once-a-minute schedule an invocation is, from the time it began: the nearest whole minute, so a
 * tick that starts a few seconds late or early still gets the turn after the previous tick's. The cycle uses it to
 * decide which organisation with no failed hourly run goes first.
 */
export function sweepTurn(startedAtMs: number): number {
  return Math.max(0, Math.round(startedAtMs / SWEEP_TICK_INTERVAL_MS));
}
