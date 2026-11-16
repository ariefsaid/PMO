/**
 * dispatcher.deliveryRecovery.test.ts — trigger events survive claim outages, conditions are judged per event,
 * and audit runs reach a terminal state on every skip path. [REC-1]: logic in supabase/functions/agent-dispatch/*.
 */
import { describe, it, expect, vi } from 'vitest';
import { runDispatchTick } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import type { AutomationRow } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import { makeDispatcherTestRpc } from './dispatcherTestRpc';

type WmChain = { eq: () => WmChain; maybeSingle: () => Promise<{ data: unknown; error: unknown }> };

const trigger = (o: Partial<AutomationRow> = {}): AutomationRow => ({
  id: 'trig-1', kind: 'trigger', owner_id: 'u1', org_id: 'org-1', prompt: 'p',
  trigger_on: { source: 'procurement_status_events', event: 'Ordered' }, enabled: true, archived_at: null, timeout_s: 30, ...o,
});
const ev = (n: number) => ({ id: `evt-${n}`, created_at: `2026-07-06T08:00:0${n}Z`, to_status: 'Ordered', org_id: 'org-1' });

/** claims: per `${automation}:${event}` -> 'ok' | 'dup' | 'down'. */
function makeSvc(automations: AutomationRow[], events: unknown[], claims: Record<string, 'ok' | 'dup' | 'down'> = {}) {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const select = vi.fn().mockReturnValue({ eq: () => ({ eq: () => ({ is: () => Promise.resolve({ data: automations, error: null }) }) }) });
  const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ data: null, error: null }) });
  const insert = vi.fn((row: { automation_id: string; event_id: string }) => ({
    select: () => {
      const c = claims[`${row.automation_id}:${row.event_id}`] ?? 'ok';
      if (c === 'ok') return Promise.resolve({ data: [{ automation_id: row.automation_id }], error: null });
      if (c === 'dup') return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
      return Promise.resolve({ data: null, error: { code: '08006', message: 'connection failure' } });
    },
  }));
  const from = vi.fn((t: string) => {
    // self-chaining eq: the watermark read is keyed (source, org_id) — two .eq calls (issue 2255)
    const wmEq = (): WmChain =>
      ({ eq: wmEq, maybeSingle: () => Promise.resolve({ data: null, error: null }) });
    if (t === 'agent_dispatch_watermarks') return { select: () => ({ eq: wmEq }), upsert };
    if (t === 'agent_automation_fires') return { insert, update: (p: Record<string, unknown>) => ({ eq: () => ({ eq: () => (p.settled_at ? Promise.resolve({ error: null }) : ({ is: () => ({ lt: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }) })) }) }), select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { settled_at: 'x' }, error: null }) }) }) }), };
    return { select, update };
  });
  const rpc = makeDispatcherTestRpc((name) => (name === 'select_trigger_events' ? { data: events, error: null } : { data: null, error: null }));
  return { client: { from, rpc }, upsert };
}

function makeMinted() {
  const updates: Array<{ table: string; patch: unknown }> = [];
  const ins = () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'x' }, error: null }) }) });
  const from = vi.fn((table: string) => ({
    insert: table === 'notifications' ? vi.fn().mockResolvedValue({ error: null }) : ins,
    update: (patch: unknown) => ({ eq: () => { updates.push({ table, patch }); return Promise.resolve({ error: null }); } }),
  }));
  return { client: { from }, updates };
}

async function tick(svc: { client: unknown }, minted: { client: unknown }, over: Record<string, unknown> = {}) {
  const handler = vi.fn(async function* () { yield { runId: 'r', type: 'status', payload: { status: 'completed' } }; });
  await runDispatchTick({
    serviceClient: svc.client as never,
    authAdmin: { admin: { generateLink: vi.fn().mockResolvedValue({ data: { properties: { hashed_token: 'H' } }, error: null }), getUserById: vi.fn(async (id: string) => ({ data: { user: { email: id } }, error: null })) } } as never,
    buildClient: vi.fn().mockReturnValue(minted.client),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: { access_token: 'T' } }, error: null }),
    handler: handler as never,
    modelClient: { create: vi.fn() } as never,
    model: 'm',
    conditionModel: { create: vi.fn() } as never,
    conditionModelId: 'cheap',
    now: () => new Date('2026-07-06T08:00:30Z'),
    newRunId: () => 'run-1',
    newMintedAt: () => '2026-07-06T08:00:30.000Z',
    ...over,
  });
  return handler;
}

describe('trigger claim outage keeps the event retryable', () => {
  it('does not advance the watermark past an event whose claim failed operationally', async () => {
    const svc = makeSvc([trigger()], [ev(1), ev(2)], { 'trig-1:evt-2': 'down' });
    await tick(svc, makeMinted());
    expect(svc.upsert).toHaveBeenCalledTimes(1);
    expect(svc.upsert.mock.calls[0][0]).toMatchObject({ last_seen_id: 'evt-1' });
  });

  it('writes no watermark when the first event claim failed operationally', async () => {
    const svc = makeSvc([trigger()], [ev(1)], { 'trig-1:evt-1': 'down' });
    const handler = await tick(svc, makeMinted());
    expect(svc.upsert).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('a sibling automation outage holds the cursor, and an already-claimed sibling is not fired twice', async () => {
    const svc = makeSvc([trigger({ id: 'a' }), trigger({ id: 'b' })], [ev(1)], { 'a:evt-1': 'down', 'b:evt-1': 'dup' });
    const handler = await tick(svc, makeMinted());
    expect(svc.upsert).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('a duplicate claim (already fired) still advances the watermark', async () => {
    const svc = makeSvc([trigger()], [ev(1)], { 'trig-1:evt-1': 'dup' });
    await tick(svc, makeMinted());
    expect(svc.upsert.mock.calls[0][0]).toMatchObject({ last_seen_id: 'evt-1' });
  });
});

describe('condition verdict is per event', () => {
  it('two events of one automation in one tick get their own verdicts', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ finish_reason: 'stop', message: { role: 'assistant', content: 'true' }, model: 'c' })
      .mockResolvedValueOnce({ finish_reason: 'stop', message: { role: 'assistant', content: 'false' }, model: 'c' });
    const svc = makeSvc([trigger({ condition: 'big order' })], [ev(1), ev(2)]);
    const handler = await tick(svc, makeMinted(), { conditionModel: { create } });
    expect(create).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('audit runs reach a terminal state', () => {
  const runStatus = (m: ReturnType<typeof makeMinted>) => m.updates.filter((u) => u.table === 'agent_runs').map((u) => (u.patch as { status: string }).status);

  it('credit denial closes the minted run', async () => {
    const minted = makeMinted();
    await tick(makeSvc([trigger()], [ev(1)]), minted, { rateGuard: { check: vi.fn().mockResolvedValue({ exceeded: true }) } });
    expect(runStatus(minted)).toEqual(['errored']);
  });

  it('an unevaluable condition closes the minted run', async () => {
    const minted = makeMinted();
    const create = vi.fn().mockRejectedValue(new Error('down'));
    await tick(makeSvc([trigger({ condition: 'c' })], [ev(1)]), minted, { conditionModel: { create } });
    expect(runStatus(minted)).toEqual(['errored']);
  });
});
