/**
 * dispatcher.selectionErrorVisibility.test.ts — I-COLPROJ (2026-07-28 review): selectDueSchedules
 * and selectEnabledTriggers (dispatcher.ts) and readWatermark (watermark.ts) previously coalesced a
 * REAL query error with the legitimate "nothing here yet" empty case (`if (error || !data) return
 * […]`). A real error (a drifted column list raising PostgREST 42703, a connectivity blip, an
 * RLS/grant regression) then looked IDENTICAL to "no schedules due" / "no triggers enabled" / "no
 * watermark yet" — with no log line anywhere to diagnose it from:
 *   - selectDueSchedules failing silently ⇒ every scheduled automation stops firing, forever.
 *   - selectEnabledTriggers failing silently ⇒ every trigger automation stops firing, forever.
 *   - readWatermark failing silently ⇒ indistinguishable from "no watermark yet", so the NEXT
 *     successful read passes a null cursor and select_trigger_events re-selects the ENTIRE event
 *     history ⇒ mass duplicate automation fires.
 * `selectDueSchedules` has its own dedicated test file (dispatcher.schedule.test.ts); this file
 * covers `selectEnabledTriggers` (not exported — driven via `runDispatchTick`) and `readWatermark`.
 * Fail-safe behavior is UNCHANGED in every case (still empty/null) — only the visibility changes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runDispatchTick } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import { readWatermark } from '../../../../../supabase/functions/agent-dispatch/watermark';

/**
 * A minimal service client for runDispatchTick whose `agent_automations` query resolves
 * differently by `kind` — `kind='schedule'` succeeds empty (so SELECT_DUE_SCHEDULES_FAILED never
 * fires and this test's assertion is unambiguous), `kind='trigger'` errors (the path under test).
 */
function makeServiceClientWithTriggerSelectError() {
  const from = vi.fn((table: string) => {
    if (table !== 'agent_automations') throw new Error(`unexpected table: ${table}`);
    let kind: string | undefined;
    const chain = {
      eq: (col: string, val: unknown) => {
        if (col === 'kind') kind = val as string;
        return chain;
      },
      is: async () => {
        if (kind === 'trigger') {
          return { data: null, error: { code: '42703', message: 'column "trigger_on" does not exist' } };
        }
        return { data: [], error: null }; // kind='schedule' — legitimately empty
      },
    };
    return { select: () => chain };
  });
  return { from };
}

// A no-op set of the deps runDispatchTick never actually reaches when both selection queries
// resolve to zero due automations (the whole per-unit fire loop is skipped).
function unreachableMintDeps() {
  return {
    authAdmin: { admin: { generateLink: vi.fn(), getUserById: vi.fn() } } as never,
    buildClient: vi.fn(),
    verifyOtp: vi.fn(),
    handler: (async function* () {}) as never,
    modelClient: { create: vi.fn() } as never,
    model: 'm',
    conditionModel: { create: vi.fn() } as never,
    conditionModelId: 'cheap',
    now: () => new Date('2026-07-28T08:00:00Z'),
  };
}

describe('selectEnabledTriggers (via runDispatchTick) — a real query error is DISTINGUISHABLE from "no triggers enabled"', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs SELECT_ENABLED_TRIGGERS_FAILED (not silent) when the trigger-side query errors; the tick still completes (fail-safe)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const svc = makeServiceClientWithTriggerSelectError();

    await runDispatchTick({ serviceClient: svc as never, ...unreachableMintDeps() });

    expect(errSpy).toHaveBeenCalledWith(
      '[agent-dispatch] SELECT_ENABLED_TRIGGERS_FAILED',
      expect.objectContaining({ errorCode: 'SELECT_ENABLED_TRIGGERS_FAILED' }),
    );
  });

  it('logs NOTHING when both selection queries legitimately return zero rows', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({ eq: () => ({ is: async () => ({ data: [], error: null }) }) }),
      }),
    }));

    await runDispatchTick({ serviceClient: { from } as never, ...unreachableMintDeps() });

    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe('readWatermark — a real query error is DISTINGUISHABLE from "no watermark yet"', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs WATERMARK_READ_FAILED (not silent) when the watermark query errors, and still fails safe (returns null)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: { code: '42703', message: 'column "last_seen_id" does not exist' } });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    const sb = { from: fromMock };

    const wm = await readWatermark(sb as never, 'procurement_status_events');

    expect(wm).toBeNull(); // fail-safe: unchanged
    expect(errSpy).toHaveBeenCalledWith(
      '[agent-dispatch] WATERMARK_READ_FAILED',
      expect.objectContaining({ errorCode: 'WATERMARK_READ_FAILED', contextId: 'procurement_status_events' }),
    );
  });

  it('logs NOTHING when no watermark row exists yet (the legitimate first-tick case)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    const sb = { from: fromMock };

    const wm = await readWatermark(sb as never, 'procurement_status_events');

    expect(wm).toBeNull();
    expect(errSpy).not.toHaveBeenCalled();
  });
});
