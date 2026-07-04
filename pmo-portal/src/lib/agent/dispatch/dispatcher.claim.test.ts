/**
 * dispatcher.claim.test.ts — AUDIT-M2 (2026-07-04 audit): schedule fires are claimed atomically
 * via a conditional last_fired_at UPDATE before any mint/fire work, so overlapping dispatcher
 * ticks can never double-fire the same schedule automation in one cron minute.
 */
import { describe, it, expect, vi } from 'vitest';
import { claimScheduleFire } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

function makeClaimClient(claimResult: { data: unknown[] | null; error: unknown }) {
  const selectMock = vi.fn().mockResolvedValue(claimResult);
  const orMock = vi.fn().mockReturnValue({ select: selectMock });
  const eqMock = vi.fn().mockReturnValue({ or: orMock });
  const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
  const from = vi.fn().mockReturnValue({ update: updateMock });
  return { client: { from }, from, updateMock, eqMock, orMock, selectMock };
}

describe('claimScheduleFire (AUDIT-M2)', () => {
  const now = new Date('2026-07-06T08:00:42.500Z'); // mid-minute — floor must be :00.000

  it('claims via a conditional UPDATE keyed on id + minute-floored last_fired_at', async () => {
    const sb = makeClaimClient({ data: [{ id: 'auto-1' }], error: null });
    const claimed = await claimScheduleFire(sb.client as never, 'auto-1', now);

    expect(claimed).toBe(true);
    expect(sb.from).toHaveBeenCalledWith('agent_automations');
    expect(sb.updateMock).toHaveBeenCalledWith({ last_fired_at: '2026-07-06T08:00:42.500Z' });
    expect(sb.eqMock).toHaveBeenCalledWith('id', 'auto-1');
    // The mutual exclusion: only an unclaimed row (null or stamped BEFORE this minute) matches.
    expect(sb.orMock).toHaveBeenCalledWith(
      'last_fired_at.is.null,last_fired_at.lt."2026-07-06T08:00:00.000Z"',
    );
  });

  it('returns false when another tick already claimed this minute (0 rows updated)', async () => {
    const sb = makeClaimClient({ data: [], error: null });
    expect(await claimScheduleFire(sb.client as never, 'auto-1', now)).toBe(false);
  });

  it('fails closed (no fire) when the claim query errors', async () => {
    const sb = makeClaimClient({ data: null, error: { code: '57014' } });
    expect(await claimScheduleFire(sb.client as never, 'auto-1', now)).toBe(false);
  });
});
