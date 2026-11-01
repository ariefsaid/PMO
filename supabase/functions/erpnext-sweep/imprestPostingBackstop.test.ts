// AC-IMP-072 [Deno] — the originator of site-float transfers: one dispatch per paid replenishment, replay by key on a
// retry, a gate refusal recorded, an uncertain attempt never re-decided. Pure module, fake deps.
// Verify: cd supabase/functions/erpnext-sweep && deno test imprestPostingBackstop.test.ts --config deno.json --allow-env --allow-net --allow-read
import { reconcileOrgImprestPostings, type ImprestBackstopDeps, type ImprestGateTruth, type ImprestIntentRow } from './imprestPostingBackstop.ts';

function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\nexpected ${e}\n     got ${a}`);
}

const row = (id: string): ImprestIntentRow => ({
  id, posting_identity: `rep-${id}:replenishment`, replenishment_id: `rep-${id}`, state_stamp: '2026-11-01T10:00:00+00:00',
  push_state: 'pending', push_error: null,
});
const truth = { mirror_id: '1', float_cash_account: 'Site Cash F', amount: '800000.00' } as unknown as ImprestGateTruth;

function deps(rows: ImprestIntentRow[], over: Partial<ImprestBackstopDeps> = {}) {
  const log: string[] = [];
  const base: ImprestBackstopDeps = {
    listPending: async () => rows,
    findOutbox: async () => null,
    replay: async (r) => { log.push(`replay:${r.id}`); },
    assertGate: async () => ({ ok: true, truth }),
    resolve: async () => ({ outcome: 'ready', refs: { company: 'Co', headOfficeAccount: 'Bank' } }),
    recordOutcome: async (r, o) => { log.push(`record:${r.id}:${o.state}:${o.reason ?? ''}`); },
    driveFresh: async (r) => { log.push(`drive:${r.id}`); },
    markAttempted: async (_orgId, ids) => { log.push(`attempted:${ids.join(',')}`); },
    listStranded: async () => [],
  };
  return { deps: { ...base, ...over }, log };
}

Deno.test('AC-IMP-072 a paid replenishment posts once', async () => {
  const driven: unknown[] = [];
  const d = deps([row('1')], { driveFresh: async (r, t, refs) => { driven.push([r.id, t, refs]); } });
  const r = await reconcileOrgImprestPostings(d.deps, { orgId: 'org-1' });
  assertEquals(driven, [['1', truth, { company: 'Co', headOfficeAccount: 'Bank' }]]);
  assertEquals([r.driven, r.replayed, r.errors], [1, 0, []]);
});

Deno.test('AC-IMP-072 a retried tick reuses the key and adopts only its own document', async () => {
  // First tick: the attempt is uncertain (recorded failed). Second tick: the outbox row exists, so it is replayed from
  // its frozen payload; the gate and the resolver (which could change the body) never run, and nothing is driven fresh.
  let outbox: { id: string; state: string } | null = null;
  const d = deps([row('1')], {
    driveFresh: async () => { outbox = { id: 'ob-1', state: 'failed' }; throw new Error('external-unreachable'); },
    findOutbox: async () => outbox,
    assertGate: async () => (outbox ? (() => { throw new Error('gate must not run for a replay'); })() : { ok: true, truth }),
    resolve: async () => (outbox ? (() => { throw new Error('resolve must not run for a replay'); })() : { outcome: 'ready', refs: { company: 'Co', headOfficeAccount: 'Bank' } }),
  });
  const first = await reconcileOrgImprestPostings(d.deps, { orgId: 'org-1' });
  assertEquals([first.driven, first.errors.length], [0, 1]);
  const second = await reconcileOrgImprestPostings(d.deps, { orgId: 'org-1' });
  assertEquals([second.replayed, second.driven, second.errors], [1, 0, []]);
  assertEquals(d.log.filter((l) => l.startsWith('replay:')), ['replay:1']);
});

Deno.test('AC-IMP-072 a gate refusal marks the intent failed and the queue still drains', async () => {
  const d = deps([row('1'), row('2')], {
    assertGate: async (r) => (r.id === '1' ? { ok: false, reason: 'imprest-posting-actor-not-authorized' } : { ok: true, truth }),
  });
  const r = await reconcileOrgImprestPostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['attempted:1,2', 'record:1:failed:imprest-posting-actor-not-authorized', 'drive:2']);
  assertEquals([r.refused, r.driven], [1, 1]);
});

Deno.test('AC-IMP-072 an uncertain attempt stays failed and is reported, never re-decided', async () => {
  const d = deps([row('1')], { driveFresh: async () => { throw new Error('external-unreachable'); } });
  const r = await reconcileOrgImprestPostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['attempted:1', 'record:1:failed:external-unreachable']);
  assertEquals(r.errors, [{ intentId: '1', error: 'external-unreachable' }]);
});
