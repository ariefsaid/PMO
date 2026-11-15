/**
 * dispatcher.leaseRecovery.test.ts — a trigger event claimed by a tick that died fires later (lease re-claim),
 * never twice; a burst is capped per tick; a failed audit write closes the run. [REC-1]: logic in
 * supabase/functions/agent-dispatch/*.
 */
import { describe, it, expect, vi } from 'vitest';
import { runDispatchTick, MAX_TRIGGER_EVENTS_PER_TICK } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import type { AutomationRow } from '../../../../../supabase/functions/agent-dispatch/dispatcher';
import { makeDispatcherTestRpc } from './dispatcherTestRpc';

type WmChain = { eq: () => WmChain; maybeSingle: () => Promise<{ data: unknown; error: unknown }> };

// unique id per automation: condition verdicts are memoized across ticks by (automation, event, condition)
let seq = 0;
const trigger = (o: Partial<AutomationRow> = {}): AutomationRow => ({
  id: `trig-${++seq}`, kind: 'trigger', owner_id: 'u1', org_id: 'org-1', prompt: 'p',
  trigger_on: { source: 'procurement_status_events', event: 'Ordered' }, enabled: true, archived_at: null, timeout_s: 30, ...o,
});
const ev = (n: number) => ({ id: `evt-${String(n).padStart(3, '0')}`, created_at: `2026-07-06T08:00:00.${String(n).padStart(3, '0')}Z`, to_status: 'Ordered', org_id: 'org-1' });
const T0 = new Date('2026-07-06T08:00:30Z').getTime();
const at = (minutes: number) => new Date(T0 + minutes * 60_000);
const hang = () => new Promise<never>(() => {});

type Row = { fired_at: string; settled_at: string | null };
/** In-memory agent_automation_fires: one row per (automation,event), conditional updates are atomic like the table's. */
function makeSvc(automations: AutomationRow[], events: unknown[], fires = new Map<string, Row>(), cursor: { id: string; at: string } | null = null) {
  const wm = { cursor };
  const upsert = vi.fn((row: { last_seen_id: string; last_seen_at: string }) => { wm.cursor = { id: row.last_seen_id, at: row.last_seen_at }; return Promise.resolve({ data: null, error: null }); });
  const rpc = makeDispatcherTestRpc((name, args) => {
    if (name !== 'select_trigger_events') return { data: null, error: null };
    const a = args as { p_last_seen_at: string | null; p_last_seen_id: string | null };
    const after = (events as ReturnType<typeof ev>[]).filter((e) => !a.p_last_seen_at || e.created_at > a.p_last_seen_at || (e.created_at === a.p_last_seen_at && e.id > (a.p_last_seen_id ?? '')));
    return { data: after, error: null };
  });
  const firesTable = {
    insert: (row: { automation_id: string; event_id: string }) => ({
      select: () => {
        const k = `${row.automation_id}:${row.event_id}`;
        if (fires.has(k)) return Promise.resolve({ data: null, error: { code: '23505', message: 'dup' } });
        fires.set(k, { fired_at: (svcNow.current).toISOString(), settled_at: null });
        return Promise.resolve({ data: [{ automation_id: row.automation_id }], error: null });
      },
    }),
    update: (patch: Partial<Row>) => {
      const f: Array<(r: Row) => boolean> = [];
      const keys: string[] = [];
      const run = () => {
        const hit = [...fires.entries()].filter(([k, r]) => keys.includes(k) && f.every((p) => p(r)));
        hit.forEach(([, r]) => Object.assign(r, patch));
        return hit;
      };
      const eqs: string[] = [];
      const chain: Record<string, unknown> = {
        eq: (col: string, v: string) => { eqs.push(col === 'automation_id' ? `${v}:` : v); if (eqs.length === 2) keys.push(`${eqs[0]}${eqs[1]}`); return chain; },
        is: (col: string, v: null) => { f.push((r) => (r as never as Record<string, unknown>)[col] === v); return chain; },
        lt: (col: string, v: string) => { f.push((r) => ((r as never as Record<string, string>)[col]) < v); return chain; },
        select: () => Promise.resolve({ data: run().map(([k]) => ({ automation_id: k })), error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res),
      };
      return chain;
    },
    select: () => ({
      eq: (_c: string, a: string) => ({ eq: (_c2: string, e: string) => ({ maybeSingle: () => Promise.resolve({ data: fires.get(`${a}:${e}`) ?? null, error: null }) }) }),
    }),
  };
  const from = vi.fn((t: string) => {
    if (t === 'agent_dispatch_watermarks') {
      // self-chaining eq: the watermark read is keyed (source, org_id) — two .eq calls (issue 2255)
      const wmEq = (): WmChain =>
        ({ eq: wmEq, maybeSingle: () => Promise.resolve({ data: wm.cursor ? { last_seen_id: wm.cursor.id, last_seen_at: wm.cursor.at } : null, error: null }) });
      return { select: () => ({ eq: wmEq }), upsert };
    }
    if (t === 'agent_automation_fires') return firesTable;
    return {
      select: () => ({ eq: () => ({ eq: () => ({ is: () => Promise.resolve({ data: automations, error: null }) }) }) }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    };
  });
  return { client: { from, rpc }, upsert, fires, wm };
}
const svcNow = { current: new Date(T0) };

function makeMinted(failEvents = false) {
  const updates: Array<{ table: string; patch: unknown }> = [];
  const from = vi.fn((table: string) => ({
    insert: table === 'notifications'
      ? vi.fn().mockResolvedValue({ error: null })
      : () => ({ select: () => ({ single: () => Promise.resolve(table === 'agent_events' && failEvents ? { data: null, error: { message: 'x' } } : { data: { id: 'x' }, error: null }) }) }),
    update: (patch: unknown) => ({ eq: () => { updates.push({ table, patch }); return Promise.resolve({ error: null }); } }),
  }));
  return { client: { from }, updates };
}

function tick(svc: { client: unknown }, minted: { client: unknown }, now: Date, over: Record<string, unknown> = {}, handler = vi.fn(async function* () { yield { runId: 'r', type: 'status', payload: { status: 'completed' } }; })) {
  svcNow.current = now;
  const p = runDispatchTick({
    serviceClient: svc.client as never,
    authAdmin: { admin: { generateLink: vi.fn().mockResolvedValue({ data: { properties: { hashed_token: 'H' } }, error: null }), getUserById: vi.fn(async (id: string) => ({ data: { user: { email: id } }, error: null })) } } as never,
    buildClient: vi.fn().mockReturnValue(minted.client),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: { access_token: 'T' } }, error: null }),
    handler: handler as never,
    modelClient: { create: vi.fn() } as never,
    model: 'm',
    conditionModel: { create: vi.fn() } as never,
    conditionModelId: 'cheap',
    now: () => now,
    newRunId: () => 'run-1',
    newMintedAt: () => now.toISOString(),
    ...over,
  });
  return { p, handler };
}
const flush = () => new Promise((r) => setTimeout(r, 20));

describe('burst cap per tick', () => {
  it('evaluates at most MAX_TRIGGER_EVENTS_PER_TICK events per tick and leaves the rest to the next tick', async () => {
    const n = MAX_TRIGGER_EVENTS_PER_TICK + 5;
    const svc = makeSvc([trigger({ condition: 'c' })], Array.from({ length: n }, (_, i) => ev(i + 1)));
    const create = vi.fn().mockResolvedValue({ finish_reason: 'stop', message: { role: 'assistant', content: 'false' }, model: 'c' });
    await tick(svc, makeMinted(), at(0), { conditionModel: { create } }).p;
    expect(create).toHaveBeenCalledTimes(MAX_TRIGGER_EVENTS_PER_TICK);
    expect(svc.wm.cursor?.id).toBe(ev(MAX_TRIGGER_EVENTS_PER_TICK).id);
    await tick(svc, makeMinted(), at(1), { conditionModel: { create } }).p;
    expect(create).toHaveBeenCalledTimes(n);
    expect(svc.wm.cursor?.id).toBe(ev(n).id);
  });
});

describe('an event claimed by a tick that died fires later, never twice', () => {
  it('re-claims an unsettled claim after the lease and fires once; an in-lease claim holds the watermark', async () => {
    const svc = makeSvc([trigger()], [ev(1)]);
    void tick(svc, makeMinted(), at(0), { rateGuard: { check: hang } }).p; // dies at the credit hold, before the fire
    await flush();
    expect(svc.fires.size).toBe(1);

    const inLease = tick(svc, makeMinted(), at(1));
    await inLease.p;
    expect(inLease.handler).not.toHaveBeenCalled();
    expect(svc.wm.cursor).toBeNull(); // still pending: the cursor must not pass it

    const after = tick(svc, makeMinted(), at(6));
    await after.p;
    expect(after.handler).toHaveBeenCalledTimes(1);

    const again = tick(svc, makeMinted(), at(12));
    await again.p;
    expect(again.handler).not.toHaveBeenCalled();
  });

  it('two ticks racing for the same expired claim fire it once', async () => {
    const svc = makeSvc([trigger()], [ev(1)]);
    void tick(svc, makeMinted(), at(0), { rateGuard: { check: hang } }).p;
    await flush();
    const handler = vi.fn(async function* () { yield { runId: 'r', type: 'status', payload: { status: 'completed' } }; });
    await Promise.all([
      tick(svc, makeMinted(), at(6), {}, handler).p,
      tick(svc, makeMinted(), at(6), {}, handler).p,
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a tick that died while firing is never re-fired', async () => {
    const svc = makeSvc([trigger()], [ev(1)]);
    const hung = vi.fn(async function* () { await hang(); yield { runId: 'r', type: 'status' }; });
    void tick(svc, makeMinted(), at(0), {}, hung as never).p;
    await flush();
    expect(hung).toHaveBeenCalledTimes(1);
    const later = tick(svc, makeMinted(), at(30));
    await later.p;
    expect(later.handler).not.toHaveBeenCalled();
  });

  it('a condition judged false is settled: not re-evaluated after the lease', async () => {
    const svc = makeSvc([trigger({ condition: 'c' })], [ev(1)], new Map(), null);
    const create = vi.fn().mockResolvedValue({ finish_reason: 'stop', message: { role: 'assistant', content: 'false' }, model: 'c' });
    await tick(svc, makeMinted(), at(0), { conditionModel: { create } }).p;
    svc.wm.cursor = null; // force re-selection, as a failed watermark write would
    await tick(svc, makeMinted(), at(10), { conditionModel: { create } }).p;
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('audit write failure closes the run', () => {
  it('closes the run errored when the audit event insert fails after the run row exists', async () => {
    const minted = makeMinted(true);
    const { p, handler } = tick(makeSvc([trigger()], [ev(1)]), minted, at(0));
    await p;
    expect(handler).not.toHaveBeenCalled();
    expect(minted.updates.filter((u) => u.table === 'agent_runs').map((u) => (u.patch as { status: string }).status)).toEqual(['errored']);
  });
});
