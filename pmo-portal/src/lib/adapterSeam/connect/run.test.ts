import { describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../contract.ts';
import { advanceConnectRun, tickConnectRun, RUN_KINDS, RUN_BUDGET_MS, type ConnectRunDeps } from './run.ts';
import type { ConnectAdapter, MasterKind, NormalisedMaster } from './types.ts';

const parties = (n: number): NormalisedMaster[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'party', externalId: `Supplier:S${String(i).padStart(4, '0')}`, role: 'vendor', name: `Supplier ${i}`, active: true }));

/** An in-memory ERP: `party` has 450 rows in pages of 200; every other kind is empty. */
function harness(over: Partial<ConnectRunDeps> = {}, startedAt = new Date(0).toISOString()) {
  const erp = parties(450);
  const listMasters = vi.fn(async (kind: MasterKind, cursor: string | null) => {
    if (kind !== 'party') return { rows: [], nextCursor: null };
    const from = cursor ? Number(cursor) : 0;
    const rows = erp.slice(from, from + 200);
    return { rows, nextCursor: from + 200 < erp.length ? String(from + 200) : null };
  });
  const adapter: ConnectAdapter = { tier: 'fake', listMasters, countDomain: async () => 0, sendMaster: vi.fn() };
  const staged: Record<string, NormalisedMaster[]> = {};
  const writeProposals = vi.fn(async () => {});
  const d: ConnectRunDeps = {
    adapter,
    run: { id: 'run-1', state: 'staging', cursor: {}, proposedKinds: [], startedAt },
    stagePage: async (kind, rows) => { staged[kind] = [...(staged[kind] ?? []), ...rows]; },
    stagedErp: async (kind) => staged[kind] ?? [],
    pmoMasters: async () => [],
    writeProposals,
    failRun: vi.fn(async () => 'staging' as const),
    budget: { calls: 2 },
    now: () => 1000,
    ...over,
  };
  return { d, staged, listMasters, writeProposals };
}

describe('ECA2-T11 advanceConnectRun', () => {
  it('pages masters until the budget is spent, then proposes one kind per call', async () => {
    const h = harness();
    expect(await advanceConnectRun(h.d)).toBe('more');
    expect(h.staged.party).toHaveLength(400);
    expect(h.d.run.cursor.party).toBe('400');
    h.d.budget.calls = 20;
    expect(await advanceConnectRun(h.d)).toBe('more');   // staging finishes and the first kind is proposed in the same call
    expect(h.staged.party).toHaveLength(450);
    expect(h.writeProposals).toHaveBeenCalledTimes(1);
    const results: string[] = [];
    for (let i = 1; i < RUN_KINDS.length; i += 1) results.push(await advanceConnectRun(h.d));
    expect(results).toEqual(['more', 'more', 'more', 'ready']);
    expect(h.writeProposals.mock.calls.map((c) => (c as unknown as [MasterKind])[0])).toEqual([...RUN_KINDS]);
  });

  it('a thrown listMasters propagates and leaves the cursor at the last good page', async () => {
    const h = harness();
    h.listMasters.mockImplementationOnce(async () => ({ rows: parties(200), nextCursor: '200' }))
      .mockImplementationOnce(async () => { throw new AdapterError('commit-rejected', 'boom'); });
    await expect(advanceConnectRun(h.d)).rejects.toThrow('boom');
    expect(h.d.run.cursor.party).toBe('200');
  });
});

describe('Minor 8 tickConnectRun: a stuck run ends', () => {
  it('records a failed tick by class only (never the message) and keeps the run going', async () => {
    const h = harness();
    h.listMasters.mockRejectedValueOnce(new AdapterError('external-unreachable', 'secret-host.internal said no'));
    expect(await tickConnectRun(h.d)).toBe('more');
    expect(h.d.failRun).toHaveBeenCalledWith('external-unreachable', false);
  });

  it('an unexpected throw is class "unexpected"', async () => {
    const h = harness();
    h.listMasters.mockRejectedValueOnce(new TypeError('x'));
    await tickConnectRun(h.d);
    expect(h.d.failRun).toHaveBeenCalledWith('unexpected', false);
  });

  it('reports failed once the database ends the run', async () => {
    const h = harness({ failRun: vi.fn(async () => 'failed' as const) });
    h.listMasters.mockRejectedValueOnce(new AdapterError('external-unreachable', 'x'));
    expect(await tickConnectRun(h.d)).toBe('failed');
  });

  it('a run past its budget fails at once, without touching the ERP', async () => {
    const h = harness({ failRun: vi.fn(async () => 'failed' as const), now: () => RUN_BUDGET_MS + 1 });
    expect(await tickConnectRun(h.d)).toBe('failed');
    expect(h.d.failRun).toHaveBeenCalledWith('budget-exceeded', true);
    expect(h.listMasters).not.toHaveBeenCalled();
  });

  it('a healthy tick makes no failure call', async () => {
    const h = harness();
    expect(await tickConnectRun(h.d)).toBe('more');
    expect(h.d.failRun).not.toHaveBeenCalled();
  });
});
