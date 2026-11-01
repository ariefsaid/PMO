/**
 * Credit reservations at each shipped handler: every metered request holds credit atomically
 * (reserve_credits) before its model call and releases it on every exit path, so concurrent
 * requests cannot both spend the same remaining balance; a failing meter reads as "metering
 * unavailable", never as an exhausted balance.
 */
import { describe, it, expect, vi } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps as ChatDeps } from '../../../../supabase/functions/agent-chat/handler';
import { composeViewHandler } from '../../../../supabase/functions/compose-view/handler';
import type { HandlerDeps as ComposeDeps } from '../../../../supabase/functions/compose-view/handler';
import { createCreditRateGuard, createDispatchRateGuard } from '../../../../supabase/functions/_shared/creditRateGuard';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';
import { makeCreditLedger } from './creditLedger.fake';

// One hold (RESERVE_UNIT = 0.01) fits; two do not.
const BALANCE_FOR_ONE = 0.015;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const answer = {
  finish_reason: 'stop',
  message: { role: 'assistant', content: 'Done.' },
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, total_cost: 0 },
  model: 'm',
};

function chatSupabase(rpc: unknown): ChatDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Engineer' }, error: null }),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    })),
    rpc,
  } as unknown as ChatDeps['supabase'];
}

const REQ: AgentChatRequest = { messages: [{ role: 'user', content: 'how many active projects?' }] };
const status = (events: AgentEvent[]) => events.filter((e) => e.type === 'status').at(-1)?.payload as
  | { status?: string; error?: string }
  | undefined;

describe('agent-chat — credit reservation', () => {
  it('two concurrent requests against a balance covering one: exactly one proceeds, holds are released', async () => {
    const ledger = makeCreditLedger(BALANCE_FOR_ONE);
    const supabase = chatSupabase(ledger.rpc);
    const gate = deferred<typeof answer>();
    const create = vi.fn().mockReturnValue(gate.promise);
    const run = () =>
      collect(agentChatHandler(REQ, {
        modelClient: { create }, model: 'm', supabase, userId: 'user-1', verifyAnswer: false,
        rateGuard: createCreditRateGuard({ supabase: supabase as never }),
        now: () => new Date('2026-07-03T00:00:00Z'),
      }));
    const a = run();
    const b = run();
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
    gate.resolve(answer);
    const results = await Promise.all([a, b]);
    expect(create).toHaveBeenCalledTimes(1);
    const statuses = results.map(status);
    expect(statuses.filter((s) => s?.error === 'RATE_LIMITED')).toHaveLength(1);
    expect(statuses.filter((s) => s?.status === 'completed')).toHaveLength(1);
    // reserved with a run id, released with the same one, nothing left held
    const reserved = ledger.calls('reserve_credits').map((c) => c.p_run_id);
    expect(reserved.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(ledger.calls('release_credits').map((c) => c.p_run_id)).toContain(reserved[0]);
    expect(ledger.openHolds()).toEqual([]);
  });

  it('releases the reservation when the model call fails', async () => {
    const ledger = makeCreditLedger(BALANCE_FOR_ONE);
    const supabase = chatSupabase(ledger.rpc);
    const create = vi.fn().mockRejectedValue(new Error('upstream down'));
    const events = await collect(agentChatHandler(REQ, {
      modelClient: { create }, model: 'm', supabase, userId: 'user-1',
      rateGuard: createCreditRateGuard({ supabase: supabase as never }),
      now: () => new Date('2026-07-03T00:00:00Z'),
    }));
    expect(status(events)?.status).toBe('errored');
    expect(ledger.calls('reserve_credits')).toHaveLength(1);
    expect(ledger.openHolds()).toEqual([]);
  });

  it('a request that is refused holds nothing', async () => {
    const ledger = makeCreditLedger(0);
    const supabase = chatSupabase(ledger.rpc);
    const create = vi.fn();
    const events = await collect(agentChatHandler(REQ, {
      modelClient: { create }, model: 'm', supabase, userId: 'user-1',
      rateGuard: createCreditRateGuard({ supabase: supabase as never }),
      now: () => new Date('2026-07-03T00:00:00Z'),
    }));
    expect(status(events)).toMatchObject({ error: 'RATE_LIMITED' });
    expect(create).not.toHaveBeenCalled();
    expect(ledger.openHolds()).toEqual([]);
  });
});

function composeSupabase(rpc: unknown): ComposeDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1' }, error: null }),
        }),
      }),
    })),
    rpc,
  } as unknown as ComposeDeps['supabase'];
}

describe('compose-view — credit reservation', () => {
  const body = { prompt: 'show me active projects', orgId: 'org-1' };

  it('two concurrent requests against a balance covering one: exactly one proceeds, hold released on failure', async () => {
    const ledger = makeCreditLedger(BALANCE_FOR_ONE);
    const supabase = composeSupabase(ledger.rpc);
    const gate = deferred<never>();
    const create = vi.fn().mockReturnValue(gate.promise);
    const deps = (): ComposeDeps => ({
      modelClient: { create }, model: 'm', supabase, userId: 'user-1',
      rateGuard: createCreditRateGuard({ supabase: supabase as never }),
    });
    const a = composeViewHandler(body, deps());
    const b = composeViewHandler(body, deps());
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
    gate.reject(new Error('upstream down'));
    const results = await Promise.all([a, b]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status).sort()).toEqual([429, 502]);
    expect(ledger.calls('reserve_credits').every((c) => typeof c.p_run_id === 'string')).toBe(true);
    expect(ledger.openHolds()).toEqual([]);
  });

  it('a failing meter reads as METER_UNAVAILABLE (503), not an exhausted balance, and still fails closed', async () => {
    const ledger = makeCreditLedger(100, { reserveError: { code: 'XX000' } });
    const supabase = composeSupabase(ledger.rpc);
    const create = vi.fn();
    const result = await composeViewHandler(body, {
      modelClient: { create }, model: 'm', supabase, userId: 'user-1',
      rateGuard: createCreditRateGuard({ supabase: supabase as never }),
    });
    expect(result).toMatchObject({ status: 503, body: { error: 'METER_UNAVAILABLE' } });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('creditRateGuard.release', () => {
  it('releases the hold by run id and never throws when the RPC fails', async () => {
    const ledger = makeCreditLedger(1);
    const guard = createCreditRateGuard({ supabase: { rpc: ledger.rpc } as never });
    await guard.check('org-1', 'run-1');
    expect(ledger.openHolds()).toEqual(['run-1']);
    await guard.release('run-1');
    expect(ledger.openHolds()).toEqual([]);
    const failing = createCreditRateGuard({ supabase: { rpc: vi.fn().mockRejectedValue(new Error('x')) } as never });
    await expect(failing.release('run-1')).resolves.toBeUndefined();
  });
});

describe('agent-dispatch rate-guard adapter', () => {
  it('forwards the reservation id to reserve_credits and releases it by that id, on the minted client', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'hold', error: null });
    const minted = { rpc };
    const guard = createDispatchRateGuard(true);
    const result = await guard.check('org-1', minted, 'hold-1');
    expect(result.exceeded).toBe(false);
    expect(rpc).toHaveBeenCalledWith('reserve_credits', expect.objectContaining({ p_org_id: 'org-1', p_run_id: 'hold-1' }));
    await guard.release(minted, 'hold-1');
    expect(rpc).toHaveBeenCalledWith('release_credits', { p_run_id: 'hold-1' });
  });

  it('with enforcement off it neither checks nor releases', async () => {
    const rpc = vi.fn();
    const guard = createDispatchRateGuard(false);
    expect((await guard.check('org-1', { rpc }, 'hold-1')).exceeded).toBe(false);
    await guard.release({ rpc }, 'hold-1');
    expect(rpc).not.toHaveBeenCalled();
  });
});
