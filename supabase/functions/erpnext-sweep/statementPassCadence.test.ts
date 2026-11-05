// Statement report batches leave the every-minute sweep: the pure per-org due rule and the constants
// that connect it to the sweep's existing cadence vocabulary. No I/O — the shipped edge function's
// scheduling policy is readable and testable without the entry point (same split as sweepCadence.ts).
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const {
  SWEEP_BACKFILL_EVERY_MINUTES,
  SWEEP_FULL_INTERVAL_MS,
  STATEMENT_PASS_INTERVAL_MS,
  STATEMENT_PASS_RETRY_DELAY_SECONDS,
  statementPassDue,
} = await import('./sweepCadence.ts');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const NOW = Date.parse('2026-11-04T09:37:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

Deno.test('AC-SPC-001: an org that never completed a statement pass is due', () => {
  assert(statementPassDue(null, NOW), 'a never-stamped org must be due');
  assert(statementPassDue(undefined, NOW), 'a missing marker must be due');
});

Deno.test('AC-SPC-001: the statement pass is due only after the hourly interval', () => {
  assert(!statementPassDue(minutesAgo(10), NOW), 'a pass completed 10 minutes ago is not due');
  assert(!statementPassDue(minutesAgo(54), NOW), 'a pass completed 54 minutes ago is not due');
  assert(statementPassDue(minutesAgo(55), NOW), 'a pass completed 55 minutes ago is due');
  assert(statementPassDue(minutesAgo(600), NOW), 'a stale marker is due');
});

Deno.test('AC-SPC-002: an unreadable marker fails toward running the pass', () => {
  assert(statementPassDue('not-a-timestamp', NOW), 'a malformed marker must not stall the pass');
});

Deno.test('AC-SPC-003: the statement interval is the sweep hourly interval', () => {
  assert(STATEMENT_PASS_INTERVAL_MS === SWEEP_FULL_INTERVAL_MS,
    `the statement pass must share the hourly interval (${STATEMENT_PASS_INTERVAL_MS} vs ${SWEEP_FULL_INTERVAL_MS})`);
});

Deno.test('AC-SPC-004: a failed or unfinished pass retries on the five-minute backfill cadence', () => {
  assert(STATEMENT_PASS_RETRY_DELAY_SECONDS === SWEEP_BACKFILL_EVERY_MINUTES * 60,
    'a retry must wait the documented five-minute backfill cadence, never the next minute tick');
  assert(STATEMENT_PASS_RETRY_DELAY_SECONDS > 60, 'a retry must not run on the every-minute tick');
});
