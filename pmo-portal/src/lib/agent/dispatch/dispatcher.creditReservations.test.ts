/**
 * dispatcher.creditReservations.test.ts — every automation unit of work holds credit under a unique
 * reservation id and releases it on every exit path; a failing meter is reported as "metering
 * unavailable" (still fail-closed); natural-language trigger conditions are credit-checked BEFORE
 * the model call and every evaluation is recorded as trusted usage.
 */
import { describe, it, expect, vi } from 'vitest';
import { runDispatchTick } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import type { AutomationRow } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

const EVENT = { id: 'evt-1', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-A' };

function automation(overrides: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: 'auto-A', kind: 'schedule', owner_id: 'user-A', org_id: 'org-A', prompt: 'summarize my overdue tasks',
    schedule: '* * * * *', enabled: true, archived_at: null, timeout_s: 90, ...overrides,
  };
}
const trigger = (condition = 'sits >30 days in Ordered') =>
  automation({
    id: 'trig-1', kind: 'trigger', schedule: null, condition,
    trigger_on: { source: 'procurement_status_events', event: 'Ordered' },
  });

function setup(auto: AutomationRow) {
  const usageInserts: Array<Record<string, unknown>> = [];
  const claimed = Object.assign(Promise.resolve({ error: null }), {
    or: () => ({ select: () => Promise.resolve({ data: [{ id: 'claimed' }], error: null }) }),
  });
  const isTrigger = auto.kind === 'trigger';
  let automationSelects = 0;
  const service = {
    rpc: vi.fn().mockResolvedValue({ data: [EVENT], error: null }),
    from: vi.fn((table: string) => {
      if (table === 'agent_automations') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ is: () => {
            automationSelects += 1;
            // schedules are selected first, triggers second
            const mine = isTrigger ? automationSelects === 2 : automationSelects === 1;
            return Promise.resolve({ data: mine ? [auto] : [], error: null });
          } }) }) }),
          update: () => ({ eq: () => claimed }),
        };
      }
      if (table === 'agent_dispatch_watermarks') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }), upsert: () => Promise.resolve({ error: null }) };
      }
      if (table === 'agent_automation_fires') {
        return { insert: () => ({ select: () => Promise.resolve({ data: [{ automation_id: auto.id }], error: null }) }) };
      }
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { org_id: 'org-A' }, error: null }) }) }) };
      }
      if (table === 'agent_usage') {
        return { insert: (row: Record<string, unknown>) => { usageInserts.push(row); return { select: () => ({ single: () => Promise.resolve({ error: null }) }) }; } };
      }
      throw new Error(`unexpected service table ${table}`);
    }),
  };
  const notifInsert = vi.fn().mockResolvedValue({ error: null });
  const order: string[] = [];
  const minted = {
    from: vi.fn((table: string) => {
      if (table === 'notifications') return { insert: notifInsert };
      if (table === 'agent_runs') {
        return {
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'run-1' }, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      return { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'x' }, error: null }) }) }) };
    }),
  };
  const mint = {
    authAdmin: { admin: {
      generateLink: vi.fn().mockResolvedValue({ data: { properties: { hashed_token: 'H' } }, error: null }),
      getUserById: vi.fn(async (id: string) => ({ data: { user: { email: id } }, error: null })),
    } },
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: { access_token: 'J' } }, error: null }),
    buildClient: vi.fn().mockReturnValue(minted),
  };
  const handler = vi.fn(async function* () {
    order.push('fire');
    yield { runId: 'run-1', type: 'status', payload: { status: 'completed' } };
  });
  type Credit = { exceeded: boolean; retryAfterSeconds?: number; reason?: 'out_of_credits' | 'meter_error' };
  const guard = (result: Credit = { exceeded: false, retryAfterSeconds: 0 }) => ({
    check: vi.fn(async (_org: string, _client?: unknown, _id?: string): Promise<Credit> => { order.push('check'); return result; }),
    release: vi.fn(async (_client: unknown, _id: string) => { order.push('release'); }),
  });
  const conditionModel = (content: string) => ({
    create: vi.fn().mockResolvedValue({
      finish_reason: 'stop', message: { role: 'assistant', content }, model: 'cheap',
      usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13, total_cost: 0.0004 },
    }),
  });
  const run = (rateGuard: ReturnType<typeof guard>, cond: { create: ReturnType<typeof vi.fn> } = conditionModel('true')) =>
    runDispatchTick({
      serviceClient: service as never, authAdmin: mint.authAdmin as never, buildClient: mint.buildClient,
      verifyOtp: mint.verifyOtp, handler: handler as never, modelClient: { create: vi.fn() } as never,
      model: 'm', conditionModel: cond as never, conditionModelId: 'cheap', rateGuard,
      now: () => new Date('2026-07-06T08:00:00Z'), newRunId: () => 'run-1',
      newMintedAt: () => '2026-07-06T08:00:00.000Z',
    });
  return { run, guard, handler, notifInsert, usageInserts, minted, order, conditionModel };
}

describe('dispatcher — credit reservation lifecycle', () => {
  it('holds under a unique reservation id before the fire and releases it after', async () => {
    const t = setup(automation());
    const g = t.guard();
    await t.run(g);
    const id = g.check.mock.calls[0][2];
    expect(typeof id).toBe('string');
    expect(id).toBeTruthy();
    expect(g.release).toHaveBeenCalledWith(t.minted, id);
    expect(t.order).toEqual(['check', 'fire', 'release']);
  });

  it('releases the reservation when the fired run throws', async () => {
    const t = setup(automation());
    t.handler.mockImplementation((() => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('boom')) }) })) as never);
    const g = t.guard();
    await t.run(g);
    expect(g.release).toHaveBeenCalledTimes(1);
  });

  it('a failing meter says "metering unavailable", not out of credits, and does not fire', async () => {
    const t = setup(automation());
    const g = t.guard({ exceeded: true, retryAfterSeconds: 0, reason: 'meter_error' });
    await t.run(g);
    expect(t.handler).not.toHaveBeenCalled();
    expect(t.notifInsert).toHaveBeenCalledTimes(1);
    const n = t.notifInsert.mock.calls[0][0] as { title: string; body?: string; message?: string };
    expect(n.title).toMatch(/metering unavailable/i);
    expect(JSON.stringify(n)).not.toMatch(/out of credits|balance was exceeded/i);
    expect(g.release).not.toHaveBeenCalled();
  });
});

describe('dispatcher — natural-language trigger conditions are credit-checked and metered', () => {
  it('a zero-balance org: no condition model call, owner told, nothing fires', async () => {
    const t = setup(trigger());
    const g = t.guard({ exceeded: true, retryAfterSeconds: 0, reason: 'out_of_credits' });
    const cond = t.conditionModel('true');
    await t.run(g, cond);
    expect(cond.create).not.toHaveBeenCalled();
    expect(t.handler).not.toHaveBeenCalled();
    expect(t.notifInsert).toHaveBeenCalledTimes(1);
    expect((t.notifInsert.mock.calls[0][0] as { title: string }).title).toMatch(/out of credits/i);
    expect(t.usageInserts).toHaveLength(0);
  });

  it.each([['true', true], ['false', false]])('an evaluated condition (%s) records trusted usage', async (verdict, fires) => {
    const t = setup(trigger());
    const g = t.guard();
    const cond = t.conditionModel(verdict);
    await t.run(g, cond);
    expect(cond.create).toHaveBeenCalledTimes(1);
    expect(t.usageInserts).toHaveLength(1);
    expect(t.usageInserts[0]).toMatchObject({
      owner_id: 'user-A', org_id: 'org-A', action: 'automation', model: 'cheap',
      prompt_tokens: 12, completion_tokens: 1, cost: 0.0004,
    });
    expect(t.handler).toHaveBeenCalledTimes(fires ? 1 : 0);
    // the hold covers the condition call and is dropped at the end of the unit
    expect(g.check).toHaveBeenCalledTimes(1);
    expect(g.release).toHaveBeenCalledTimes(1);
    expect(g.check.mock.calls[0][2]).toBe(g.release.mock.calls[0][1]);
  });
});
