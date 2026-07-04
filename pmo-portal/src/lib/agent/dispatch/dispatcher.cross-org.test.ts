/**
 * dispatcher.cross-org.test.ts — SECURITY CRITICAL: cross-org trigger tenancy (gpt-5.5 audit #1/#2,
 * SEC-HIGH-2).
 *
 * The dispatcher enumerates automations under service_role and (SEC-HIGH-2, migration 0054) selects
 * trigger events via the SECURITY DEFINER `select_trigger_events` RPC — it no longer reads the tenant
 * `procurement_status_events` table under service_role. The RPC returns ONLY events matching one of the
 * caller's (org_id, event) filter pairs, so a cross-org event never crosses into the edge fn. These
 * tests assert BOTH the belt (the dispatcher passes org-scoped filters + never .from()s the source
 * table) AND the suspenders (the in-JS pairing loop re-asserts event.org_id === automation.org_id, so
 * even a mocked RPC that leaks a cross-org row is not cross-matched).
 *
 * [REC-1]: logic in supabase/functions/agent-dispatch/*, tests here.
 */
import { describe, it, expect, vi } from 'vitest';
import { selectTriggerMatches } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import type { AutomationRow } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

function makeTrigger(overrides: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: 'trig-A',
    kind: 'trigger',
    owner_id: 'user-A',
    org_id: 'org-A',
    prompt: 'notify me when ordered',
    trigger_on: { source: 'procurement_status_events', event: 'Ordered' },
    enabled: true,
    archived_at: null,
    ...overrides,
  };
}

/**
 * A serviceClient whose watermark is null and whose select_trigger_events RPC returns the given event
 * rows. The source business table is NEVER exposed via .from() — a .from('procurement_status_events')
 * call throws, proving the deputy invariant (SEC-HIGH-2). `rpc` is returned so tests can assert the
 * dispatcher passed org-scoped filters to the RPC.
 */
function makeServiceClient(events: Array<Record<string, unknown>>) {
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
  const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });

  const rpc = vi.fn().mockResolvedValue({ data: events, error: null });

  const from = vi.fn((table: string) => {
    if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
    throw new Error(`service_role must never .from() business data; got: ${table}`);
  });
  return { from, rpc };
}

describe('selectTriggerMatches — SECURITY CRITICAL cross-org tenancy (gpt-5.5 #1, SEC-HIGH-2)', () => {
  it('never reads the source table directly; passes an org-scoped filter to select_trigger_events', async () => {
    const automation = makeTrigger({ org_id: 'org-A' });
    const sb = makeServiceClient([]);

    await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [automation]);

    // The RPC — not a raw table read — was used, with the automation's own org in the filter set.
    expect(sb.rpc).toHaveBeenCalledWith(
      'select_trigger_events',
      expect.objectContaining({
        p_source: 'procurement_status_events',
        p_filters: [{ org_id: 'org-A', event: 'Ordered' }],
      }),
    );
  });

  it('does NOT match an Org-B event to an Org-A automation (defense-in-depth: even a leaky RPC row)', async () => {
    const automation = makeTrigger({ org_id: 'org-A' });
    // A (hypothetically leaked) Org-B event with the matching to_status — the in-JS gate must reject it.
    const orgBEvent = { id: 'evt-B', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-B' };
    const sb = makeServiceClient([orgBEvent]);

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [automation]);

    expect(matches).toHaveLength(0);
  });

  it('matches a same-org event (event.org_id === automation.org_id)', async () => {
    const automation = makeTrigger({ org_id: 'org-A' });
    const orgAEvent = { id: 'evt-A', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-A' };
    const sb = makeServiceClient([orgAEvent]);

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [automation]);

    expect(matches).toHaveLength(1);
    expect(matches[0].automation.id).toBe('trig-A');
    expect(matches[0].event.id).toBe('evt-A');
  });

  it('with mixed org events, only the same-org event matches (no cross-org leak into the match set)', async () => {
    const automation = makeTrigger({ org_id: 'org-A' });
    const events = [
      { id: 'evt-B', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-B' },
      { id: 'evt-A', created_at: '2026-07-06T08:00:01Z', to_status: 'Ordered', org_id: 'org-A' },
    ];
    const sb = makeServiceClient(events);

    const matches = await selectTriggerMatches(sb as never, new Date('2026-07-06T08:00:05Z'), [automation]);

    expect(matches).toHaveLength(1);
    expect(matches[0].event.id).toBe('evt-A');
  });
});
