// AC-EXP-121 [Deno] — the ONLY originator of expense postings (ADR-0081): replay before re-deciding, gate, resolve,
// drive; per-row containment. Pure module, fake deps.
// Verify: cd supabase/functions/erpnext-sweep && deno test expensePostingBackstop.test.ts --config deno.json --allow-env --allow-net --allow-read
import { reconcileOrgExpensePostings, EXPENSE_BACKSTOP_TICK_LIMIT, type ExpenseBackstopDeps, type ExpenseIntentRow } from './expensePostingBackstop.ts';

function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\nexpected ${e}\n     got ${a}`);
}

const row = (id: string): ExpenseIntentRow => ({
  id, posting: 'approval', posting_identity: `c-${id}:approval`, claim_id: `c-${id}`,
  return_id: null, state_stamp: '2026-10-07T10:00:00+00:00', push_state: 'pending', push_error: null,
});

function deps(rows: ExpenseIntentRow[], over: Partial<ExpenseBackstopDeps> = {}) {
  const log: string[] = [];
  const base: ExpenseBackstopDeps = {
    listPending: async () => rows,
    findOutbox: async () => null,
    replay: async (r) => { log.push(`replay:${r.id}`); },
    assertGate: async (r) => ({ ok: true, truth: { mirror_id: r.id } as never }),
    resolve: async () => ({ outcome: 'ready', refs: {} as never }),
    recordOutcome: async (r, o) => { log.push(`record:${r.id}:${o.state}:${o.reason ?? ''}:${o.erpName ?? ''}`); },
    driveFresh: async (r) => { log.push(`drive:${r.id}`); },
  };
  return { deps: { ...base, ...over }, log };
}

Deno.test('AC-EXP-121 the queue is read for the org with the per-tick bound', async () => {
  const seen: Array<[string, number]> = [];
  const d = deps([], { listPending: async (orgId, limit) => { seen.push([orgId, limit]); return []; } });
  await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(seen, [['org-1', EXPENSE_BACKSTOP_TICK_LIMIT]]);
  assertEquals(EXPENSE_BACKSTOP_TICK_LIMIT, 200);
});

Deno.test('AC-EXP-121 a gate refusal is recorded failed and nothing is driven', async () => {
  const d = deps([row('1')], { assertGate: async () => ({ ok: false, reason: 'expense-posting-actor-inactive' }) });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['record:1:failed:expense-posting-actor-inactive:']);
  assertEquals([r.refused, r.driven], [1, 0]);
});

Deno.test('AC-EXP-121 a resolver refusal is recorded failed with its code', async () => {
  const d = deps([row('1')], { resolve: async () => ({ outcome: 'refuse', code: 'employee-unlinked', message: 'no link' }) });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['record:1:failed:employee-unlinked: no link:']);
  assertEquals([r.refused, r.driven], [1, 0]);
});

Deno.test('AC-EXP-121 a wait leaves the intent untouched', async () => {
  const d = deps([row('1')], { resolve: async () => ({ outcome: 'wait', reason: 'expense-approval-journal-not-posted' }) });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals([d.log, r.waiting, r.driven], [[], 1, 0]);
});

Deno.test('AC-EXP-121 already-done is recorded pushed with the ERP name', async () => {
  const d = deps([row('1')], { resolve: async () => ({ outcome: 'already-done', erpName: 'ACC-JV-2026-00002' }) });
  await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['record:1:pushed::ACC-JV-2026-00002']);
});

Deno.test('AC-EXP-121 a ready intent is driven once with the gate truth and the resolved refs', async () => {
  const driven: unknown[] = [];
  const d = deps([row('1')], {
    resolve: async () => ({ outcome: 'ready', refs: { company: 'Co' } as never }),
    driveFresh: async (r, truth, refs) => { driven.push([r.id, truth, refs]); },
  });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals([driven, r.driven], [[['1', { mirror_id: '1' }, { company: 'Co' }]], 1]);
});

Deno.test('AC-EXP-121 an intent with an outbox row is replayed from its frozen payload, never re-decided', async () => {
  const d = deps([row('1')], {
    findOutbox: async () => ({ id: 'ob-1', state: 'failed' }),
    assertGate: async () => { throw new Error('gate must not run for a replay'); },
    resolve: async () => { throw new Error('resolve must not run for a replay'); },
  });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals([d.log, r.replayed, r.errors], [['replay:1'], 1, []]);
});

Deno.test('AC-EXP-121 a row that throws is recorded and the queue drains', async () => {
  const d = deps([row('1'), row('2')], {
    assertGate: async (r) => {
      if (r.id === '1') throw new Error('db down');
      return { ok: true, truth: {} as never };
    },
  });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(r.errors, [{ intentId: '1', error: 'db down' }]);
  assertEquals(d.log, ['drive:2']);
});
