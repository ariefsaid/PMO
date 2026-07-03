/**
 * dispatcher.watermark.test.ts — watermark read/advance + event-trigger selection (AC-AAN-022).
 * [REC-1]: logic lives in supabase/functions/agent-dispatch/*, tests live here.
 */
import { describe, it, expect, vi } from 'vitest';
import { readWatermark, advanceWatermark } from '../../../../../supabase/functions/agent-dispatch/watermark';
import { selectTriggerMatches } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import type { AutomationRow } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

function makeAutomation(overrides: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: 'trig-1',
    kind: 'trigger',
    owner_id: 'u1',
    prompt: 'notify me when ordered',
    trigger_on: { source: 'procurement_status_events', event: 'Ordered' },
    enabled: true,
    archived_at: null,
    ...overrides,
  };
}

describe('readWatermark / advanceWatermark', () => {
  it('readWatermark returns null when no row exists for the source', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    const sb = { from: fromMock };

    const wm = await readWatermark(sb as never, 'procurement_status_events');

    expect(wm).toBeNull();
    expect(fromMock).toHaveBeenCalledWith('agent_dispatch_watermarks');
    expect(eqMock).toHaveBeenCalledWith('source', 'procurement_status_events');
  });

  it('advanceWatermark upserts on agent_dispatch_watermarks keyed on source', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });
    const sb = { from: fromMock };

    await advanceWatermark(sb as never, 'procurement_status_events', { id: 'evt-1', at: '2026-07-06T08:00:00Z' });

    expect(fromMock).toHaveBeenCalledWith('agent_dispatch_watermarks');
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'procurement_status_events',
        last_seen_id: 'evt-1',
        last_seen_at: '2026-07-06T08:00:00Z',
      }),
    );
  });
});

describe('selectTriggerMatches — AC-AAN-022 watermark advances, no double-fire', () => {
  it('tick 1: no prior watermark, one matching event is returned', async () => {
    const automation = makeAutomation();
    const event = { id: 'evt-1', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered' };

    // readWatermark: null (no prior row)
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });

    // status-event source query: gt(created_at, epoch).order(...)
    const orderMock = vi.fn().mockResolvedValue({ data: [event], error: null });
    const gtMock = vi.fn().mockReturnValue({ order: orderMock });
    const evtSelectMock = vi.fn().mockReturnValue({ gt: gtMock });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
      return { select: evtSelectMock };
    });
    const sb = { from: fromMock };

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [automation]);

    expect(matches).toHaveLength(1);
    expect(matches[0].automation.id).toBe('trig-1');
    expect(matches[0].event).toEqual(event);
    expect(gtMock).toHaveBeenCalledWith('created_at', '1970-01-01');
  });

  it('tick 2: watermark advanced past the event, zero new events (no double-fire)', async () => {
    const automation = makeAutomation();

    // readWatermark: returns the previously-advanced watermark.
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { source: 'procurement_status_events', last_seen_id: 'evt-1', last_seen_at: '2026-07-06T08:00:00Z' },
      error: null,
    });
    const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });

    // status-event source query now returns zero rows past the watermark.
    const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const gtMock = vi.fn().mockReturnValue({ order: orderMock });
    const evtSelectMock = vi.fn().mockReturnValue({ gt: gtMock });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
      return { select: evtSelectMock };
    });
    const sb = { from: fromMock };

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:01:05Z'), [automation]);

    expect(matches).toHaveLength(0);
    expect(gtMock).toHaveBeenCalledWith('created_at', '2026-07-06T08:00:00Z');
  });
});
