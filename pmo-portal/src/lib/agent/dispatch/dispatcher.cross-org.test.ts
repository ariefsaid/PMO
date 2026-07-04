/**
 * dispatcher.cross-org.test.ts — SECURITY CRITICAL: cross-org trigger tenancy (gpt-5.5 audit #1/#2).
 *
 * The dispatcher enumerates automations under service_role and reads trigger-source rows under
 * service_role (RLS-bypassing). A trigger automation matched an event by `to_status` ALONE — so an
 * Org-B `procurement_status_events` row could fire an Org-A automation, and Org-B's event would be
 * serialized into Org-A's condition-model prompt. The fix carries each automation's org_id and the
 * event's org_id, and REQUIRES event.org_id === automation.org_id before any match.
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

/** A serviceClient whose watermark is null and whose source table returns the given event rows. */
function makeServiceClient(events: Array<Record<string, unknown>>) {
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const wmEqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
  const wmSelectMock = vi.fn().mockReturnValue({ eq: wmEqMock });

  const orderMock = vi.fn().mockResolvedValue({ data: events, error: null });
  const gteMock = vi.fn().mockReturnValue({ order: orderMock });
  const evtSelectMock = vi.fn().mockReturnValue({ gte: gteMock });

  const from = vi.fn((table: string) => {
    if (table === 'agent_dispatch_watermarks') return { select: wmSelectMock };
    if (table === 'procurement_status_events') return { select: evtSelectMock };
    throw new Error(`unexpected table ${table}`);
  });
  return { from };
}

describe('selectTriggerMatches — SECURITY CRITICAL cross-org tenancy (gpt-5.5 #1)', () => {
  it('does NOT match an Org-B event to an Org-A automation (event.org_id must equal automation.org_id)', async () => {
    const automation = makeTrigger({ org_id: 'org-A' });
    // An Org-B event with the matching to_status — must NEVER match the Org-A automation.
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
