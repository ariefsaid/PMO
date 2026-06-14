/**
 * AC-W2-3-04: Win-rate boundary `p_from`/`p_to` RPC params are the LOCAL calendar
 * day string, not the UTC-shifted version.
 *
 * Root cause: `from.toISOString().slice(0, 10)` converts the local Date to UTC first.
 * For a Date that is e.g. 2026-06-14 23:00 local (UTC-7) → UTC is 2026-06-15 06:00 →
 * the slice produces "2026-06-15", one day in the future. The cache key in WinRateCard
 * would then also drift (buildWinRateRange uses the same toDateKey helper).
 *
 * Fix: use `toIso(d)` from `@/src/lib/calendar/monthMatrix` which uses
 * `getFullYear()/getMonth()/getDate()` — always LOCAL calendar values.
 */
import { describe, it, expect, vi } from 'vitest';

// ── Mock supabase.rpc so we can inspect the params passed ────────────────────
const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return { data: { wins_count: 0, losses_count: 0, wins_value: 0, losses_value: 0, win_rate_count: 0, win_rate_value: 0 }, error: null };
    }),
  },
}));

import { getWinRate } from '../dashboard';

describe('AC-W2-3-04: getWinRate boundary params — no UTC day-shift', () => {
  it('sends p_from as the LOCAL YYYY-MM-DD for a date near midnight in a behind-UTC zone', async () => {
    rpcCalls.length = 0;

    // Construct a Date that is 2026-06-14 locally but 2026-06-15 in UTC (UTC offset < 0).
    // We simulate this by directly creating a date with local parts = Jun 14 at 23:00
    // and verifying the p_from param uses getFullYear/Month/Date (local), not UTC.
    //
    // In ANY timezone, new Date(2026, 5, 14, 23, 0, 0) is Jun 14 locally at 23:00.
    // .toISOString() in UTC-7 → "2026-06-15T06:00:00.000Z" → slice → "2026-06-15" (WRONG)
    // toIso(d) → getFullYear()=2026, getMonth()=5, getDate()=14 → "2026-06-14" (CORRECT)
    const localJun14Late = new Date(2026, 5, 14, 23, 0, 0);

    await getWinRate(localJun14Late);

    expect(rpcCalls.length).toBe(1);
    const { params } = rpcCalls[0];

    // The p_from must be the LOCAL date "2026-06-14", not the UTC-shifted "2026-06-15".
    // The assertion is: local year/month/date extracted from the param string match
    // the year/month/date of the Date as seen in LOCAL time.
    expect(params.p_from).toBe('2026-06-14');
  });

  it('sends p_to as the LOCAL YYYY-MM-DD for a date near midnight', async () => {
    rpcCalls.length = 0;

    const localDec31Late = new Date(2026, 11, 31, 23, 30, 0); // Dec 31 locally at 23:30

    await getWinRate(undefined, localDec31Late);

    expect(rpcCalls.length).toBe(1);
    const { params } = rpcCalls[0];

    // p_to must be "2026-12-31" (LOCAL), not "2027-01-01" (UTC in behind-UTC zone).
    expect(params.p_to).toBe('2026-12-31');
  });

  it('passes null params when no date is supplied', async () => {
    rpcCalls.length = 0;

    await getWinRate();

    expect(rpcCalls.length).toBe(1);
    const { params } = rpcCalls[0];
    expect(params.p_from).toBeNull();
    expect(params.p_to).toBeNull();
  });
});
