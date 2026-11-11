/**
 * T-10 #1538 BACK-03/CROSS-02: the credit hold is released only AFTER the usage row that replaces it
 * has landed — on success and on error — in the chat and compose paths (the dispatcher's twin is in
 * dispatch/dispatcher.creditReservations.test.ts). Releasing first would leave a window where
 * neither the hold nor the spend is counted.
 */
import { describe, it, expect, vi } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps as ChatDeps } from '../../../../supabase/functions/agent-chat/handler';
import { composeViewHandler } from '../../../../supabase/functions/compose-view/handler';
import type { HandlerDeps as ComposeDeps } from '../../../../supabase/functions/compose-view/handler';
import { createCreditRateGuard } from '../../../../supabase/functions/_shared/creditRateGuard';
import type { AgentEvent } from './runtime/port';
import { makeCreditLedger } from './creditLedger.fake';

const order: string[] = [];
const ledger = () => {
  const l = makeCreditLedger(1);
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'release_credits') order.push('release');
    return (l.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<unknown>)(fn, args);
  });
  return { l, rpc };
};
const insertOf = () => (_row: object) => {
  order.push('usage');
  return { select: () => ({ single: () => Promise.resolve({ data: { id: 'u1' }, error: null }) }) };
};
const profile = (single: unknown) => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve(single), limit: () => Promise.resolve({ data: [], error: null }) }), limit: () => Promise.resolve({ data: [], error: null }) }) });
const resp = (content: string | null, tool_calls?: unknown[]) => ({
  finish_reason: tool_calls ? 'tool_calls' : 'stop',
  message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) },
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, total_cost: 0.001 }, model: 'm',
});

async function chat(create: ReturnType<typeof vi.fn>) {
  order.length = 0;
  const { l, rpc } = ledger();
  const supabase = { from: () => ({ ...profile({ data: { org_id: 'org-1', role: 'Engineer' }, error: null }), insert: insertOf() }), rpc } as unknown as ChatDeps['supabase'];
  const events: AgentEvent[] = [];
  for await (const e of agentChatHandler({ messages: [{ role: 'user', content: 'how many active projects?' }] }, {
    modelClient: { create } as never, model: 'm', supabase, userId: 'user-1', verifyAnswer: false, usage: { supabase },
    rateGuard: createCreditRateGuard({ supabase: supabase as never }),
    now: () => new Date('2026-07-03T00:00:00Z'),
  })) events.push(e);
  return { l, events };
}

describe('chat: usage lands before the hold is released', () => {
  it('on success', async () => {
    const { l } = await chat(vi.fn().mockResolvedValue(resp('Done.')));
    expect(order).toEqual(['usage', 'release']);
    expect(l.openHolds()).toEqual([]);
  });

  it('on error after a resolved call (second model call fails)', async () => {
    const call = { id: 'c1', type: 'function', function: { name: 'no_such_tool', arguments: '{}' } };
    const create = vi.fn().mockResolvedValueOnce(resp(null, [call])).mockRejectedValue(new Error('upstream down'));
    const { l, events } = await chat(create);
    expect((events.filter((e) => e.type === 'status').at(-1)?.payload as { status?: string }).status).toBe('errored');
    expect(order.indexOf('usage')).toBeGreaterThanOrEqual(0);
    expect(order.at(-1)).toBe('release');
    expect(order.indexOf('usage')).toBeLessThan(order.indexOf('release'));
    expect(l.openHolds()).toEqual([]);
  });
});

describe('compose-view: usage lands before the hold is released', () => {
  const VALID = { version: 1, panels: [{ id: 'p1', primitive: 'KPITile', querySpec: { entity: 'projects', select: ['id'], aggregate: { fn: 'count', column: 'id', alias: 'count' } } }] };
  const call = { id: 'c', type: 'function', function: { name: 'compose_view', arguments: JSON.stringify(VALID) } };
  const BAD = { ...VALID, panels: [{ ...VALID.panels[0], querySpec: { entity: 'secret_salaries', select: ['id'] } }] };
  const badCall = { ...call, function: { name: 'compose_view', arguments: JSON.stringify(BAD) } };

  async function compose(create: ReturnType<typeof vi.fn>) {
    order.length = 0;
    const { l, rpc } = ledger();
    const supabase = { from: () => profile({ data: { org_id: 'org-1' }, error: null }), rpc } as unknown as ComposeDeps['supabase'];
    const serviceClient = { from: (t: string) => (t === 'profiles' ? profile({ data: { org_id: 'org-1' }, error: null }) : { ...profile({ data: null, error: null }), insert: insertOf() }) };
    const result = await composeViewHandler({ prompt: 'show projects', orgId: 'org-1' }, {
      modelClient: { create } as never, model: 'm', supabase, userId: 'u-1', usage: { serviceClient },
      rateGuard: createCreditRateGuard({ supabase: supabase as never }),
    } as ComposeDeps);
    return { l, result };
  }

  it('on success', async () => {
    const { l, result } = await compose(vi.fn().mockResolvedValue(resp(null, [call])));
    expect(result.status).toBe(200);
    expect(order).toEqual(['usage', 'release']);
    expect(l.openHolds()).toEqual([]);
  });

  it('on repair exhaustion (422)', async () => {
    const { l, result } = await compose(vi.fn().mockResolvedValue(resp(null, [badCall])));
    expect(result.status).toBe(422);
    expect(order).toEqual(['usage', 'release']);
    expect(l.openHolds()).toEqual([]);
  });
});
