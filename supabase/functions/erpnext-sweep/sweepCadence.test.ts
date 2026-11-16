// AC-ROP-070 the capture freshness window in 0874 covers the worst healthy gap between two hourly runs.
// The 2 hours literal lives in purchase_capture_feed_health; the 121-minute case in
// supabase/tests/2195_capture_feed_health.test.sql (AC-ROP-069) pins the same literal from the database side.
import { assert, assertEquals } from '@std/assert';
import { HOURLY_INVOCATION_DEADLINE_MS, SWEEP_FULL_INTERVAL_MS, sweepRetryDelaySeconds } from './sweepCadence.ts';

const MINUTE = 60_000;

Deno.test('AC-ROP-070 the freshness window exceeds the worst healthy start-to-start gap', async () => {
  const sql = await Deno.readTextFile(new URL('../../migrations/0874_capture_feed_currency.sql', import.meta.url));
  const hours = Number(/v_window := greatest\(v_since,now\(\)-interval '(\d+) hours'\)/.exec(sql)?.[1]);
  assertEquals(hours, 2);
  // Full-run interval, the invocation that starts it late, the LONGEST failed-run retry delay (#1642 backoff cap) and the one-minute tick.
  const worstGapMs = SWEEP_FULL_INTERVAL_MS + HOURLY_INVOCATION_DEADLINE_MS + sweepRetryDelaySeconds(Infinity) * 1000 + MINUTE;
  assert(worstGapMs < hours * 60 * MINUTE, `worst healthy gap ${worstGapMs / MINUTE} min must be under ${hours * 60} min`);
});
