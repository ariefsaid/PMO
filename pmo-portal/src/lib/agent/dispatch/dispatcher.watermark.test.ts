/**
 * dispatcher.watermark.test.ts — watermark read/advance + event-trigger selection (AC-AAN-022).
 * [REC-1]: logic lives in supabase/functions/agent-dispatch/*, tests live here.
 *
 * SEC-HIGH-2 (migration 0054): the dispatcher no longer reads the tenant `procurement_status_events`
 * table under service_role — it calls the SECURITY DEFINER `select_trigger_events` RPC. The compound
 * (created_at, id) watermark cursor + the (org_id, to_status) match now live in SQL; their correctness
 * is owned by pgTAP 0104 (AC-STE-001..004). These unit tests own the JS contract: that the dispatcher
 * reads the watermark, passes the correct cursor + org-scoped filters to the RPC, hard-gates a
 * non-allowlisted source (never round-trips), and pairs the RPC-returned events back to automations.
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

/**
 * A serviceClient whose watermark read resolves to `watermark` and whose select_trigger_events RPC
 * resolves to `events`. The source business table is NEVER exposed via .from() (SEC-HIGH-2) — only
 * agent_dispatch_watermarks is reachable through .from(); anything else throws.
 */
function makeServiceClient(
  events: Array<Record<string, unknown>>,
  watermark: { last_seen_id: string; last_seen_at: string } | null = null,
) {
  const maybeSingleMock = vi.fn().mockResolvedValue({
    data: watermark ? { source: 'procurement_status_events', ...watermark } : null,
    error: null,
  });
  const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
  const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });

  const rpc = vi.fn().mockResolvedValue({ data: events, error: null });

  const from = vi.fn((table: string) => {
    if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
    throw new Error(`service_role must never .from() business data; got: ${table}`);
  });
  return { from, rpc };
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

  it('advanceWatermark surfaces WATERMARK_ADVANCE_FAILED (not swallowed) when the upsert errors', async () => {
    // Rel-Med (audit): a failed watermark write must be VISIBLE — otherwise the same event window is
    // reprocessed silently every tick. logStructuredError → console.error, so spy on that.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: { code: '55P03', message: 'lock' } });
    const sb = { from: vi.fn().mockReturnValue({ upsert: upsertMock }) };

    await advanceWatermark(sb as never, 'procurement_status_events', { id: 'evt-1', at: '2026-07-06T08:00:00Z' });

    expect(errSpy).toHaveBeenCalledWith(
      '[agent-dispatch] WATERMARK_ADVANCE_FAILED',
      expect.objectContaining({ errorCode: 'WATERMARK_ADVANCE_FAILED', contextId: 'procurement_status_events' }),
    );
    errSpy.mockRestore();
  });
});

describe('selectTriggerMatches — SECURITY HIGH-1 hard-gates trigger_on.source against TRIGGER_SOURCES', () => {
  it('skips a non-allowlisted source without ever calling the RPC or .from(source) — never queries it', async () => {
    const automation = makeAutomation({ trigger_on: { source: 'profiles', event: 'Ordered' } });
    const rpc = vi.fn();
    const fromMock = vi.fn().mockImplementation((table: string) => {
      throw new Error(`must never .from() for a non-allowlisted source, got: ${table}`);
    });
    const sb = { from: fromMock, rpc };

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [automation]);

    expect(matches).toHaveLength(0);
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('still selects matches for an allowlisted source alongside a skipped non-allowlisted one', async () => {
    const good = makeAutomation({ id: 'trig-good', trigger_on: { source: 'procurement_status_events', event: 'Ordered' } });
    const bad = makeAutomation({ id: 'trig-bad', trigger_on: { source: 'agent_automations', event: 'Ordered' } });
    const event = { id: 'evt-1', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-1' };
    const sb = makeServiceClient([event]);

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [good, bad]);

    expect(matches).toHaveLength(1);
    expect(matches[0].automation.id).toBe('trig-good');
    // The RPC was invoked only for the allowlisted source, never for agent_automations.
    expect(sb.rpc).toHaveBeenCalledTimes(1);
    expect(sb.rpc).toHaveBeenCalledWith(
      'select_trigger_events',
      expect.objectContaining({ p_source: 'procurement_status_events' }),
    );
  });
});

describe('selectTriggerMatches — AC-AAN-022 watermark cursor passed to select_trigger_events', () => {
  it('tick 1: no prior watermark → null cursor passed to the RPC, one matching event returned', async () => {
    const automation = makeAutomation();
    const event = { id: 'evt-1', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-1' };
    const sb = makeServiceClient([event], null);

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [automation]);

    expect(matches).toHaveLength(1);
    expect(matches[0].automation.id).toBe('trig-1');
    expect(matches[0].event).toEqual(event);
    // A null watermark → null cursor to the RPC (the RPC returns all matching rows).
    expect(sb.rpc).toHaveBeenCalledWith(
      'select_trigger_events',
      expect.objectContaining({
        p_source: 'procurement_status_events',
        p_last_seen_at: null,
        p_last_seen_id: null,
        p_filters: [{ org_id: 'org-1', event: 'Ordered' }],
      }),
    );
  });

  it('tick 2: an advanced watermark is passed as the compound cursor to the RPC', async () => {
    const automation = makeAutomation();
    // RPC returns zero rows (it excluded already-seen rows via the cursor — see pgTAP 0104 AC-STE-003).
    const sb = makeServiceClient([], { last_seen_id: 'evt-1', last_seen_at: '2026-07-06T08:00:00Z' });

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:01:05Z'), [automation]);

    expect(matches).toHaveLength(0);
    // The dispatcher hands the RPC the compound (created_at, id) cursor read from the watermark.
    expect(sb.rpc).toHaveBeenCalledWith(
      'select_trigger_events',
      expect.objectContaining({
        p_last_seen_at: '2026-07-06T08:00:00Z',
        p_last_seen_id: 'evt-1',
      }),
    );
  });

  it('pairs each RPC-returned event to its automation by (org_id, to_status)', async () => {
    // Two automations, same org, different events; the RPC returns one event per (org, event) pair.
    const ordered = makeAutomation({ id: 'trig-ord', trigger_on: { source: 'procurement_status_events', event: 'Ordered' } });
    const received = makeAutomation({ id: 'trig-rcv', trigger_on: { source: 'procurement_status_events', event: 'Received' } });
    const events = [
      { id: 'evt-o', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-1' },
      { id: 'evt-r', created_at: '2026-07-06T08:00:01Z', to_status: 'Received', org_id: 'org-1' },
    ];
    const sb = makeServiceClient(events);

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:01:05Z'), [ordered, received]);

    expect(matches).toHaveLength(2);
    expect(matches.find((m) => m.automation.id === 'trig-ord')?.event.id).toBe('evt-o');
    expect(matches.find((m) => m.automation.id === 'trig-rcv')?.event.id).toBe('evt-r');
    // Both (org, event) filter pairs were deduped-and-passed to the RPC.
    expect(sb.rpc).toHaveBeenCalledWith(
      'select_trigger_events',
      expect.objectContaining({
        p_filters: [
          { org_id: 'org-1', event: 'Ordered' },
          { org_id: 'org-1', event: 'Received' },
        ],
      }),
    );
  });
});
