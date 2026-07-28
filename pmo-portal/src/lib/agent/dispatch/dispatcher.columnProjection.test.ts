/**
 * dispatcher.columnProjection.test.ts — AC-COLPROJ-AGENT: proves selectDueSchedules /
 * selectEnabledTriggers's explicit `.select(...)` column list (PR #397's `agent_automations` trim)
 * actually matches every field `AutomationRow` — and therefore runDispatchTick — consumes.
 *
 * The other tests in this directory build fully-typed `AutomationRow` objects directly as their
 * mock's canned response, so a wrong/missing column in the real `.select()` string can never fail
 * them (the mock never actually simulates PostgREST's projection — see the sibling test files'
 * `vi.fn().mockReturnValue(...)` chains). This file is a NEW, purpose-built fake — mirroring the
 * Deno moneyOutboxDeps.test.ts fix for the same PR — that DOES simulate the real projection: it
 * seeds one full raw DB row (every real `agent_automations` column, including the ones the trim
 * DROPS: created_at/updated_at/last_fired_at) and returns only the columns actually named in the
 * `.select()` string, throwing (simulating PostgREST's `42703`) if a requested column is absent.
 */
import { describe, it, expect } from 'vitest';
import { selectDueSchedules } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import type { ServiceClientLike } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

// selectEnabledTriggers (dispatcher.ts, the trigger-side twin of selectDueSchedules) is NOT exported
// — it's an internal helper of runDispatchTick — and its `.select(...)` string is byte-for-byte
// IDENTICAL to selectDueSchedules's (same 11-column list; verified by reading both call sites in
// dispatcher.ts). Proving the projection round-trips through the exported selectDueSchedules
// therefore proves the SAME string is safe for selectEnabledTriggers too, without exporting an
// internal function just to test it.

/** Every column the real `agent_automations` table has — a superset of AutomationRow's 11 fields
 *  plus the 3 the trim deliberately drops (created_at, updated_at, last_fired_at). */
function fullRawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'auto-1',
    kind: 'schedule',
    owner_id: 'user-1',
    org_id: 'org-1',
    prompt: 'summarize my overdue tasks',
    schedule: '* * * * *',
    trigger_on: null,
    condition: null,
    enabled: true,
    archived_at: null,
    timeout_s: 90,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    last_fired_at: null,
    ...overrides,
  };
}

/** Same projection contract as the Deno moneyOutboxDeps fake and the m365MockDeps fake: return
 *  ONLY the requested columns; throw (simulating PostgREST 42703) if one is missing from the row. */
function project(row: Record<string, unknown>, cols: string): Record<string, unknown> {
  const keys = cols.split(',').map((c) => c.trim()).filter(Boolean);
  const projected: Record<string, unknown> = {};
  for (const k of keys) {
    if (!(k in row)) {
      throw new Error(
        `fake: column "${k}" requested by .select('${cols}') is not present on the stubbed row ` +
          `(simulates PostgREST 42703 — the column list and AutomationRow have drifted apart).`,
      );
    }
    projected[k] = row[k];
  }
  return projected;
}

function makeProjectingClient(rows: Record<string, unknown>[]): ServiceClientLike {
  return {
    from: (table: string) => {
      if (table !== 'agent_automations') throw new Error(`unexpected table: ${table}`);
      return {
        select: (cols: string) => {
          const chain = {
            eq: (_col: string, _val: unknown) => chain,
            is: (_col: string, _val: null) => Promise.resolve({ data: rows.map((r) => project(r, cols)), error: null }),
          };
          return chain;
        },
      };
    },
  } as unknown as ServiceClientLike;
}

describe('AC-COLPROJ-AGENT — selectDueSchedules honours its trimmed agent_automations column list', () => {
  it('every AutomationRow field the caller reads survives the real .select() projection', async () => {
    const client = makeProjectingClient([fullRawRow({ id: 'auto-sched', kind: 'schedule' })]);

    const rows = await selectDueSchedules(client, new Date('2026-07-28T12:00:00Z'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'auto-sched', kind: 'schedule', owner_id: 'user-1', org_id: 'org-1',
      prompt: 'summarize my overdue tasks', schedule: '* * * * *', enabled: true,
      archived_at: null, timeout_s: 90,
    });
    // The trimmed-away columns are genuinely absent from the projected row (not just unread) —
    // proves the projection, and therefore the over-fetch reduction, is real.
    expect('created_at' in rows[0]).toBe(false);
    expect('updated_at' in rows[0]).toBe(false);
    expect('last_fired_at' in rows[0]).toBe(false);
  });

  it('filters by cronMatches using the projected `schedule` field (proves `schedule` round-trips through the projection)', async () => {
    const client = makeProjectingClient([
      fullRawRow({ id: 'auto-due', schedule: '* * * * *' }),
      fullRawRow({ id: 'auto-not-due', schedule: '0 0 1 1 *' }), // once a year — not due now
    ]);

    const rows = await selectDueSchedules(client, new Date('2026-07-28T12:00:00Z'));

    expect(rows.map((r) => r.id)).toEqual(['auto-due']);
  });

  it('the trigger-only fields (trigger_on, condition) — read by selectTriggerMatches/evaluateCondition on the sibling selectEnabledTriggers call — also survive the SAME projection', async () => {
    const client = makeProjectingClient([
      fullRawRow({
        id: 'auto-trig-shaped', trigger_on: { source: 'procurement_status_events', event: 'Ordered' },
        condition: 'is urgent',
      }),
    ]);

    const rows = await selectDueSchedules(client, new Date('2026-07-28T12:00:00Z'));

    expect(rows[0]).toMatchObject({
      trigger_on: { source: 'procurement_status_events', event: 'Ordered' },
      condition: 'is urgent',
    });
  });
});
