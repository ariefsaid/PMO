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
    org_id: 'org-1',
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

describe('selectTriggerMatches — SECURITY HIGH-1 hard-gates trigger_on.source against TRIGGER_SOURCES', () => {
  it('skips a non-allowlisted source without ever calling sb.from(source) — never queries it', async () => {
    const automation = makeAutomation({ trigger_on: { source: 'profiles', event: 'Ordered' } });
    const fromMock = vi.fn().mockImplementation((table: string) => {
      throw new Error(`selectTriggerMatches must never call .from() for a non-allowlisted source, got: ${table}`);
    });
    const sb = { from: fromMock };

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [automation]);

    expect(matches).toHaveLength(0);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('still selects matches for an allowlisted source alongside a skipped non-allowlisted one', async () => {
    const good = makeAutomation({ id: 'trig-good', trigger_on: { source: 'procurement_status_events', event: 'Ordered' } });
    const bad = makeAutomation({ id: 'trig-bad', trigger_on: { source: 'agent_automations', event: 'Ordered' } });
    const event = { id: 'evt-1', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-1' };

    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });
    const orderMock = vi.fn().mockResolvedValue({ data: [event], error: null });
    const gteMock = vi.fn().mockReturnValue({ order: orderMock });
    const evtSelectMock = vi.fn().mockReturnValue({ gte: gteMock });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
      if (table === 'procurement_status_events') return { select: evtSelectMock };
      throw new Error(`must never query non-allowlisted source: ${table}`);
    });
    const sb = { from: fromMock };

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [good, bad]);

    expect(matches).toHaveLength(1);
    expect(matches[0].automation.id).toBe('trig-good');
    expect(fromMock).not.toHaveBeenCalledWith('agent_automations');
  });
});

describe('selectTriggerMatches — AC-AAN-022 watermark advances, no double-fire', () => {
  it('tick 1: no prior watermark, one matching event is returned', async () => {
    const automation = makeAutomation();
    const event = { id: 'evt-1', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-1' };

    // readWatermark: null (no prior row)
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });

    // status-event source query: gte(created_at, epoch).order(...) — the compound cursor (item 4)
    // queries at-or-after the watermark and filters the exact seen id in-JS.
    const orderMock = vi.fn().mockResolvedValue({ data: [event], error: null });
    const gteMock = vi.fn().mockReturnValue({ order: orderMock });
    const evtSelectMock = vi.fn().mockReturnValue({ gte: gteMock });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
      return { select: evtSelectMock };
    });
    const sb = { from: fromMock };

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [automation]);

    expect(matches).toHaveLength(1);
    expect(matches[0].automation.id).toBe('trig-1');
    expect(matches[0].event).toEqual(event);
    expect(gteMock).toHaveBeenCalledWith('created_at', '1970-01-01');
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

    // status-event source query now returns zero rows at-or-after the watermark.
    const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const gteMock = vi.fn().mockReturnValue({ order: orderMock });
    const evtSelectMock = vi.fn().mockReturnValue({ gte: gteMock });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
      return { select: evtSelectMock };
    });
    const sb = { from: fromMock };

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:01:05Z'), [automation]);

    expect(matches).toHaveLength(0);
    expect(gteMock).toHaveBeenCalledWith('created_at', '2026-07-06T08:00:00Z');
  });

  it('gpt-5.5 #5: same-timestamp siblings BEFORE the advanced id are NOT re-yielded (no double-fire)', async () => {
    // tick1 saw A,B,C all at the SAME created_at and advanced the watermark to C (max id at that
    // instant). tick2 re-reads gte(created_at) — the source table still returns A,B,C (same instant).
    // The compound (created_at, id) cursor must drop A and B (id ≤ C's), NOT re-yield them. The old
    // `id === lastSeenId` filter dropped only C, re-firing A and B every tick forever.
    const automation = makeAutomation();
    const evtA = { id: 'a', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-1' };
    const evtB = { id: 'b', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-1' };
    const evtC = { id: 'c', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-1' };

    // watermark advanced to C (the max id at that instant).
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { source: 'procurement_status_events', last_seen_id: 'c', last_seen_at: '2026-07-06T08:00:00Z' },
      error: null,
    });
    const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });

    // gte still returns all three same-timestamp rows.
    const orderMock = vi.fn().mockResolvedValue({ data: [evtA, evtB, evtC], error: null });
    const gteMock = vi.fn().mockReturnValue({ order: orderMock });
    const evtSelectMock = vi.fn().mockReturnValue({ gte: gteMock });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
      return { select: evtSelectMock };
    });
    const sb = { from: fromMock };

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:01:05Z'), [automation]);

    // No re-yield of A or B (nor C) — all are ≤ the (created_at, id) cursor at that instant.
    expect(matches).toHaveLength(0);
  });

  it('gpt-5.5 #5: a same-timestamp sibling AFTER the advanced id IS yielded (not skipped)', async () => {
    // The watermark advanced to B at instant T; a later-inserted sibling D at the SAME instant T with
    // id > B must still be picked up (strict compound-cursor greater-than, not skipped by the gte).
    const automation = makeAutomation();
    const evtB = { id: 'b', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-1' };
    const evtD = { id: 'd', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-1' };

    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { source: 'procurement_status_events', last_seen_id: 'b', last_seen_at: '2026-07-06T08:00:00Z' },
      error: null,
    });
    const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });

    const orderMock = vi.fn().mockResolvedValue({ data: [evtB, evtD], error: null });
    const gteMock = vi.fn().mockReturnValue({ order: orderMock });
    const evtSelectMock = vi.fn().mockReturnValue({ gte: gteMock });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
      return { select: evtSelectMock };
    });
    const sb = { from: fromMock };

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:01:05Z'), [automation]);

    // B is at-or-below the cursor (dropped); D is strictly after (id > b at the same instant) → yielded.
    expect(matches).toHaveLength(1);
    expect(matches[0].event.id).toBe('d');
  });

  it('the exact previously-seen row (same created_at, same id) is filtered out, not re-matched', async () => {
    const automation = makeAutomation();
    const seenEvent = { id: 'evt-1', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-1' };

    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { source: 'procurement_status_events', last_seen_id: 'evt-1', last_seen_at: '2026-07-06T08:00:00Z' },
      error: null,
    });
    const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });

    // gte still returns the already-seen row (its own instant) — selectTriggerMatches must filter
    // it out in-JS by id, never re-match it.
    const orderMock = vi.fn().mockResolvedValue({ data: [seenEvent], error: null });
    const gteMock = vi.fn().mockReturnValue({ order: orderMock });
    const evtSelectMock = vi.fn().mockReturnValue({ gte: gteMock });

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
      return { select: evtSelectMock };
    });
    const sb = { from: fromMock };

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:01:05Z'), [automation]);

    expect(matches).toHaveLength(0);
  });
});
