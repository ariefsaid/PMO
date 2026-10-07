// AC-EXP-121 [Deno, live wiring] — pass (7)'s live deps (`expensePostingBackstopDepsLive`, the SHIPPED export of
// index.ts) against a recording fake service client: the work-queue query, the key/identity an outbox row is found
// by, the hold reasons for an outbox row 0131 no longer offers, the compare-and-set outcome write + its notice, the
// gate's refusal classes, and an actor refusal that never reaches the outbox.
// Verify: cd supabase/functions/erpnext-sweep && deno test expensePostingBackstopLive.test.ts --config deno.json --allow-env --allow-net --allow-read

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { expensePostingBackstopDepsLive } = await import('./index.ts');
type OrgBinding = Parameters<typeof expensePostingBackstopDepsLive>[1];
type IntentRow = Parameters<ReturnType<typeof expensePostingBackstopDepsLive>['findOutbox']>[0];

function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\nexpected ${e}\n     got ${a}`);
}

const ORG = '00000000-0000-4000-8000-0000000000e1';
const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';
const RETURN_ID = '1c8b9d3f-2222-4333-8444-555566667777';
const STAMP = '2026-10-07T10:00:00.123+00:00';

interface Call {
  table: string;
  op: string;
  payload?: unknown;
  ops: Array<[string, ...unknown[]]>;
}

/** Records every query; `respond(call)` decides what a terminal read/write returns. */
function fakeClient(opts: {
  respond?: (call: Call) => { data: unknown; error: unknown };
  rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
} = {}) {
  const calls: Call[] = [];
  const rpcs: Array<[string, Record<string, unknown>]> = [];
  const respond = opts.respond ?? (() => ({ data: null, error: null }));
  const builder = (table: string, op: string, payload?: unknown) => {
    const call: Call = { table, op, payload, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'contains', 'like']) {
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, ...args]);
        return chain;
      };
    }
    chain.maybeSingle = () => Promise.resolve(respond(call));
    chain.single = () => Promise.resolve(respond(call));
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(respond(call)).then(resolve);
    return chain;
  };
  const client = {
    from: (table: string) => ({
      select: (...a: unknown[]) => {
        const b = builder(table, 'select');
        (b.select as (...x: unknown[]) => unknown)(...a);
        return b;
      },
      insert: (p: unknown) => builder(table, 'insert', p),
      update: (p: unknown) => builder(table, 'update', p),
      upsert: (p: unknown) => builder(table, 'upsert', p),
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push([fn, args]);
      return Promise.resolve(opts.rpc ? opts.rpc(fn, args) : { data: null, error: null });
    },
  };
  return { client, calls, rpcs };
}

const ORG_BINDING = {
  orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'ref', company: 'Example Co', config: {},
  ownedDomains: ['expenses'], versionMajor: 15,
} as OrgBinding;

const intent = (over: Partial<IntentRow> = {}): IntentRow => ({
  id: 'mirror-1', posting: 'approval', posting_identity: `${CLAIM}:approval`, claim_id: CLAIM, return_id: null,
  state_stamp: STAMP, push_state: 'pending', push_error: null, ...over,
});

type OutboxRow = Parameters<typeof expensePostingBackstopDepsLive>[2][number];
const outboxRow = (id: string, state: string, over: Partial<OutboxRow> = {}): OutboxRow => ({
  id, domain: 'expenses', pmoRecordId: `${CLAIM}:approval`, idempotencyKey: `expj:${CLAIM}:1791367200123`, state,
  externalRecordId: null, canonical: null, claimGeneration: 1, payloadDigest: null, ...over,
} as OutboxRow);
const deps = (client: unknown, eligible: Array<string | OutboxRow> = []) =>
  expensePostingBackstopDepsLive(client as never, ORG_BINDING,
    eligible.map((e) => (typeof e === 'string' ? outboxRow(e, 'pending') : e)));
const GATE_TRUTH = {
  mirror_id: 'mirror-1', posting: 'approval', posting_identity: `${CLAIM}:approval`, subject_id: CLAIM, claim_id: CLAIM,
  claim_number: 'EXP-1', claimant_id: 'u-claimant', project_id: null, currency: 'IDR', amount: '100.00', lines: [],
  state_stamp: STAMP, posting_date: '2026-10-07', approval_posting_exists: true, actor_id: 'u-pm',
};

Deno.test('AC-EXP-121 the work queue is this org\'s pending/failed, not ERP-cancelled intents, least recently attempted first, bounded', async () => {
  const f = fakeClient({ respond: () => ({ data: [intent()], error: null }) });
  const rows = await deps(f.client).listPending(ORG, 200);
  assertEquals(rows.length, 1);
  assertEquals(f.calls[0].table, 'expense_posting_erp_mirror');
  assertEquals(f.calls[0].ops.slice(1), [
    ['eq', 'org_id', ORG], ['in', 'push_state', ['pending', 'failed']], ['is', 'erp_cancelled_at', null],
    ['order', 'last_attempt_at', { ascending: true, nullsFirst: true }], ['order', 'created_at', { ascending: true }], ['limit', 200],
  ]);
});

Deno.test('AC-EXP-121 the listed intents are stamped attempted in one org-scoped write', async () => {
  const f = fakeClient();
  await deps(f.client).markAttempted(ORG, ['mirror-1', 'mirror-2']);
  assertEquals(f.calls.length, 1);
  assertEquals([f.calls[0].table, f.calls[0].op, typeof (f.calls[0].payload as Record<string, unknown>).last_attempt_at], ['expense_posting_erp_mirror', 'update', 'string']);
  assertEquals(f.calls[0].ops, [['eq', 'org_id', ORG], ['in', 'id', ['mirror-1', 'mirror-2']]]);
});

Deno.test('AC-EXP-121 a committed expenses command whose intent is already pushed is listed as stranded; nothing else is', async () => {
  const f = fakeClient({ respond: () => ({ data: [intent({ push_state: 'pushed' })], error: null }) });
  const committed = outboxRow('ob-1', 'committed');
  const stranded = await deps(f.client, [committed, outboxRow('ob-2', 'pending', { pmoRecordId: 'other:claim-payment', idempotencyKey: 'expp:other:1' }),
    outboxRow('ob-3', 'committed', { domain: 'procurement' })]).listStranded(ORG);
  assertEquals(stranded.map((s) => [s.row.id, s.outbox.id]), [['mirror-1', 'ob-1']]);
  assertEquals(f.calls[0].ops.slice(1), [['eq', 'org_id', ORG], ['eq', 'push_state', 'pushed'], ['in', 'posting_identity', [`${CLAIM}:approval`]]]);
  // A cancel command left committed is keyed by its own prefix, so it maps to the approval-cancel intent.
  const g = fakeClient({ respond: () => ({ data: [], error: null }) });
  await deps(g.client, [outboxRow('ob-4', 'committed', { idempotencyKey: `expx:${CLAIM}:1` })]).listStranded(ORG);
  assertEquals(g.calls[0].ops.at(-1), ['in', 'posting_identity', [`${CLAIM}:approval-cancel`]]);
  // No committed expenses command ⇒ no read at all.
  const h = fakeClient();
  assertEquals(await deps(h.client, [outboxRow('ob-5', 'pending')]).listStranded(ORG), []);
  assertEquals(h.calls.length, 0);
});

Deno.test('AC-EXP-121 a replay that could post anew re-checks the recorded actor\'s role; a demoted, still active payer is refused before the outbox is touched', async () => {
  const f = fakeClient({
    rpc: (fn) => (fn === 'expense_posting_actor_check'
      ? { data: null, error: { code: '42501', message: 'expense-posting-actor-not-authorized' } }
      : { data: null, error: null }),
    respond: (c) => (c.table === 'profiles' ? { data: [{ id: 'admin-1' }], error: null } : { data: c.op === 'select' ? [] : null, error: null }),
  });
  await deps(f.client, ['ob-1']).replay(intent({ posting: 'claim-payment', posting_identity: `${CLAIM}:claim-payment` }), { id: 'ob-1', state: 'failed' } as never);
  assertEquals(f.rpcs[0], ['expense_posting_actor_check', { p_org_id: ORG, p_mirror_id: 'mirror-1' }]);
  assertEquals(f.calls.some((c) => c.table === 'external_command_outbox'), false);
  const update = f.calls.find((c) => c.table === 'expense_posting_erp_mirror' && c.op === 'update');
  assertEquals(update?.payload, { push_state: 'failed', push_error: 'expense-posting-actor-not-authorized' });
});

Deno.test('AC-EXP-121 finishing a committed command (no new ERP write) does not re-check the actor', async () => {
  const f = fakeClient({ respond: () => ({ data: null, error: null }) });
  let thrown = '';
  try {
    await deps(f.client, [outboxRow('ob-1', 'committed')]).replay(intent({ push_state: 'pushed' }), outboxRow('ob-1', 'committed') as never);
  } catch (err) {
    thrown = (err as Error).message;
  }
  assertEquals(f.rpcs.some(([fn]) => fn === 'expense_posting_actor_check'), false);
  assertEquals(f.calls[0]?.table, 'external_command_outbox');
  // The intent is already pushed: a failed finish is reported to the pass, not recorded on it or notified.
  assertEquals(thrown.includes('not readable for reconcile'), true, thrown);
  assertEquals(f.calls.some((c) => c.table === 'notifications' || (c.table === 'expense_posting_erp_mirror' && c.op === 'update')), false);
});

Deno.test('AC-EXP-121 an outbox row is found by the posting\'s outbox identity and re-derived key', async () => {
  const f = fakeClient();
  await deps(f.client).findOutbox(intent({ posting: 'approval-cancel', posting_identity: `${CLAIM}:approval-cancel` }));
  await deps(f.client).findOutbox(intent({ posting: 'advance-return', return_id: RETURN_ID, posting_identity: `${RETURN_ID}:advance-return` }));
  const eqs = f.calls.map((c) => c.ops.filter((o) => o[0] === 'eq'));
  assertEquals(eqs[0], [['eq', 'org_id', ORG], ['eq', 'domain', 'expenses'], ['eq', 'pmo_record_id', `${CLAIM}:approval`],
    ['eq', 'idempotency_key', `expx:${CLAIM}:${Date.parse('2026-10-07T10:00:00.123Z')}`]]);
  assertEquals(eqs[1][2], ['eq', 'pmo_record_id', `${RETURN_ID}:advance-return`]);
  assertEquals((eqs[1][3][2] as string).startsWith(`expr:${RETURN_ID}:`), true);
});

for (const [state, reason] of [
  ['confirmed', 'expense-posting-mirror-diverged'],
  ['held', 'command-held'],
  ['failed', 'expense-posting-attempts-exhausted'],
] as const) {
  Deno.test(`AC-EXP-121 an outbox row in '${state}' that 0131 no longer offers parks the intent held (${reason}) and notifies`, async () => {
    const f = fakeClient({
      respond: (c) => (c.table === 'profiles' ? { data: [{ id: 'admin-1' }], error: null } : { data: c.op === 'select' ? [] : null, error: null }),
    });
    await deps(f.client).replay(intent(), { id: 'ob-1', state } as never);
    const update = f.calls.find((c) => c.table === 'expense_posting_erp_mirror' && c.op === 'update');
    assertEquals(update?.payload, { push_state: 'held', push_error: reason });
    assertEquals(update?.ops, [['eq', 'org_id', ORG], ['eq', 'id', 'mirror-1'], ['in', 'push_state', ['pending', 'failed']], ['is', 'erp_cancelled_at', null]]);
    const notice = f.calls.find((c) => c.table === 'notifications' && c.op === 'insert');
    assertEquals(JSON.stringify(notice?.payload).includes('expense-posting-held'), true);
  });
}

Deno.test('AC-EXP-121 an outbox row still committing or quarantined is left alone (not due yet)', async () => {
  const f = fakeClient();
  await deps(f.client).replay(intent(), { id: 'ob-1', state: 'committing' } as never);
  await deps(f.client).replay(intent(), { id: 'ob-2', state: 'quarantined' } as never);
  assertEquals(f.calls.length, 0);
});

Deno.test('AC-EXP-121 a pushed outcome records the ERP name and raises no notice', async () => {
  const f = fakeClient();
  await deps(f.client).recordOutcome(intent(), { state: 'pushed', reason: null, erpName: 'ACC-JV-2026-00002' });
  const update = f.calls.find((c) => c.op === 'update');
  const patch = update?.payload as Record<string, unknown>;
  assertEquals([patch.push_state, patch.push_error, patch.erp_name, typeof patch.pushed_at], ['pushed', null, 'ACC-JV-2026-00002', 'string']);
  assertEquals(f.calls.some((c) => c.table === 'notifications'), false);
});

Deno.test('AC-EXP-121 the gate: a refusal class is a recorded refusal, anything else throws', async () => {
  const refusal = fakeClient({ rpc: () => ({ data: null, error: { code: '42501', message: 'expense-posting-actor-inactive' } }) });
  assertEquals(await deps(refusal.client).assertGate(intent()), { ok: false, reason: 'expense-posting-actor-inactive' });
  assertEquals(refusal.rpcs, [['expense_posting_for_push', { p_org_id: ORG, p_mirror_id: 'mirror-1' }]]);
  const outage = fakeClient({ rpc: () => ({ data: null, error: { code: '08006', message: 'connection lost' } }) });
  let thrown = '';
  try {
    await deps(outage.client).assertGate(intent());
  } catch (err) {
    thrown = (err as Error).message;
  }
  assertEquals(thrown, 'connection lost');
  const ok = fakeClient({ rpc: () => ({ data: GATE_TRUTH, error: null }) });
  assertEquals(await deps(ok.client).assertGate(intent()), { ok: true, truth: GATE_TRUTH });
  const malformed = fakeClient({ rpc: () => ({ data: { mirror_id: 'mirror-1' }, error: null }) });
  let refused = '';
  try {
    await deps(malformed.client).assertGate(intent());
  } catch (err) {
    refused = (err as Error).message;
  }
  assertEquals(refused.startsWith('expense-gate-truth-malformed'), true, refused);
});

Deno.test('AC-EXP-121 a fresh posting whose recorded actor is no longer active is recorded failed before any outbox write', async () => {
  const f = fakeClient({
    rpc: (fn) => {
      if (fn === 'domain_owned_by_tier') return { data: true, error: null };
      if (fn === 'actor_authorization_state') return { data: { role: 'Finance', active: false }, error: null };
      return { data: null, error: null };
    },
    respond: (c) => (c.table === 'profiles' ? { data: [{ id: 'admin-1' }], error: null } : { data: c.op === 'select' ? [] : null, error: null }),
  });
  await deps(f.client).driveFresh(intent({ posting: 'claim-payment', posting_identity: `${CLAIM}:claim-payment` }), {
    mirror_id: 'mirror-1', posting: 'claim-payment', posting_identity: `${CLAIM}:claim-payment`, subject_id: CLAIM, claim_id: CLAIM,
    claim_number: 'EXP-1', claimant_id: 'u-claimant', project_id: null, currency: 'IDR', amount: '100.00', lines: [],
    state_stamp: STAMP, posting_date: '2026-10-07', approval_posting_exists: false, actor_id: 'u-finance',
  }, {
    company: 'Example Co', employee: 'HR-EMP-1', payableAccount: 'Employee Payable - EX', advanceAccount: null, expenseAccounts: {},
    erpProject: null, costCenter: null, cashAccount: 'Cash - EX', approvalJournal: null,
  });
  assertEquals(f.calls.some((c) => c.table === 'external_command_outbox'), false);
  const update = f.calls.find((c) => c.table === 'expense_posting_erp_mirror' && c.op === 'update');
  assertEquals((update?.payload as Record<string, unknown>).push_state, 'failed');
  assertEquals(String((update?.payload as Record<string, unknown>).push_error).includes('not an active member'), true);
});
