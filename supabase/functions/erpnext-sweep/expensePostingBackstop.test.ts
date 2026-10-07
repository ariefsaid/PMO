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
    markAttempted: async (_orgId, ids) => { log.push(`attempted:${ids.join(',')}`); },
    listStranded: async () => [],
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
  assertEquals(d.log, ['attempted:1', 'record:1:failed:expense-posting-actor-inactive:']);
  assertEquals([r.refused, r.driven], [1, 0]);
});

Deno.test('AC-EXP-121 a resolver refusal is recorded failed with its code', async () => {
  const d = deps([row('1')], { resolve: async () => ({ outcome: 'refuse', code: 'employee-unlinked', message: 'no link' }) });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['attempted:1', 'record:1:failed:employee-unlinked: no link:']);
  assertEquals([r.refused, r.driven], [1, 0]);
});

Deno.test('AC-EXP-121 a wait leaves the intent untouched', async () => {
  const d = deps([row('1')], { resolve: async () => ({ outcome: 'wait', reason: 'expense-approval-journal-not-posted' }) });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals([d.log, r.waiting, r.driven], [['attempted:1'], 1, 0]);
});

Deno.test('AC-EXP-121 already-done is recorded pushed with the ERP name', async () => {
  const d = deps([row('1')], { resolve: async () => ({ outcome: 'already-done', erpName: 'ACC-JV-2026-00002' }) });
  await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['attempted:1', 'record:1:pushed::ACC-JV-2026-00002']);
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
  assertEquals([d.log, r.replayed, r.errors], [['attempted:1', 'replay:1'], 1, []]);
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
  // Q3: the throw is recorded on the intent (failed — still retried) so the claim page and the Admin see it.
  assertEquals(d.log, ['attempted:1,2', 'record:1:failed:db down:', 'drive:2']);
});

Deno.test('AC-EXP-121 a row whose failure cannot even be recorded still lets the queue drain', async () => {
  const d = deps([row('1'), row('2')], {
    assertGate: async (r) => {
      if (r.id === '1') throw new Error('db down');
      return { ok: true, truth: {} as never };
    },
    recordOutcome: async () => { throw new Error('still down'); },
  });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(r.errors, [{ intentId: '1', error: 'db down' }]);
  assertEquals(d.log, ['attempted:1,2', 'drive:2']);
});

Deno.test('AC-EXP-121 every listed intent is stamped attempted before any is processed (round robin, NFR-EXP-013)', async () => {
  const d = deps([row('1'), row('2'), row('3')], {
    resolve: async () => ({ outcome: 'wait', reason: 'expense-approval-journal-not-posted' }),
  });
  await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['attempted:1,2,3']);
});

Deno.test('AC-EXP-121 an empty queue stamps nothing', async () => {
  const d = deps([]);
  await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, []);
});

Deno.test('AC-EXP-121 an approval whose claim was cancelled before it posted is parked held (never retried)', async () => {
  const d = deps([row('1')], { assertGate: async () => ({ ok: false, reason: 'expense-posting-claim-cancelled' }) });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['attempted:1', 'record:1:held:expense-posting-claim-cancelled:']);
  assertEquals([r.refused, r.driven], [1, 0]);
});

Deno.test('AC-EXP-121 a posting stranded between its mirror write and its outbox confirm is finished first, so the following cancel can enter the outbox', async () => {
  // One record may hold one unfinished outbox command (0134): the cancel shares the approval's outbox identity.
  let approvalOutbox: 'committed' | 'confirmed' = 'committed';
  const approval: ExpenseIntentRow = { ...row('a'), push_state: 'pushed' };
  const cancel: ExpenseIntentRow = { ...row('x'), posting: 'approval-cancel', posting_identity: 'c-a:approval-cancel', claim_id: 'c-a' };
  const d = deps([cancel], {
    listStranded: async () => [{ row: approval, outbox: { id: 'ob-a', state: 'committed' } }],
    replay: async (r, ob) => {
      d.log.push(`replay:${r.id}:${ob.state}`);
      approvalOutbox = 'confirmed';
    },
    driveFresh: async (r) => {
      if (approvalOutbox !== 'confirmed') throw new Error('23505: one unfinished command per record');
      d.log.push(`drive:${r.id}`);
    },
  });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(d.log, ['replay:a:committed', 'attempted:x', 'drive:x']);
  assertEquals([r.finished, r.driven, r.errors], [1, 1, []]);
});

Deno.test('AC-EXP-121 a stranded posting that throws is contained', async () => {
  const d = deps([row('1')], {
    listStranded: async () => [{ row: { ...row('a'), push_state: 'pushed' }, outbox: { id: 'ob-a', state: 'committed' } }],
    replay: async (r) => { if (r.id === 'a') throw new Error('erp down'); },
  });
  const r = await reconcileOrgExpensePostings(d.deps, { orgId: 'org-1' });
  assertEquals(r.errors, [{ intentId: 'a', error: 'erp down' }]);
  assertEquals([r.finished, r.driven], [0, 1]);
});
