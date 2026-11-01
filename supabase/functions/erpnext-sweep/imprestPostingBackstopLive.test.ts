// AC-IMP-072 [Deno, live wiring] — pass (7b)'s live deps (`imprestPostingBackstopDepsLive`, the SHIPPED export of
// index.ts) against a recording fake service client: the org-scoped work queue and its retry delay, the key/identity an
// outbox row is found by, the stranded listing (impt: keys only), the gate's refusal classes, the compare-and-set outcome
// write on the IMPREST mirror, and an actor refusal that never reaches the outbox.
// Verify: cd supabase/functions/erpnext-sweep && deno test imprestPostingBackstopLive.test.ts --config deno.json --allow-env --allow-net --allow-read

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { imprestPostingBackstopDepsLive, imprestResolveDepsLive } = await import('./index.ts');
type OrgBinding = Parameters<typeof imprestPostingBackstopDepsLive>[1];
type IntentRow = Parameters<ReturnType<typeof imprestPostingBackstopDepsLive>['findOutbox']>[0];
function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\nexpected ${e}\n     got ${a}`);
}

const ORG = '00000000-0000-4000-8000-0000000000e1';
const REP = '15150000-0000-0000-0000-0000000000e3';
const STAMP = '2026-10-07T10:00:00.123+00:00';
const KEY = `impt:${REP}:${Date.parse('2026-10-07T10:00:00.123Z')}`;

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
  id: 'mirror-1', posting_identity: `${REP}:replenishment`, replenishment_id: REP, state_stamp: STAMP, push_state: 'pending', push_error: null, ...over,
});

type OutboxRow = Parameters<typeof imprestPostingBackstopDepsLive>[2][number];
const outboxRow = (id: string, state: string, over: Partial<OutboxRow> = {}): OutboxRow => ({
  id, domain: 'expenses', pmoRecordId: `${REP}:replenishment`, idempotencyKey: KEY, state,
  externalRecordId: null, canonical: null, claimGeneration: 1, payloadDigest: null, ...over,
} as OutboxRow);
const deps = (client: unknown, eligible: Array<string | OutboxRow> = []) =>
  imprestPostingBackstopDepsLive(client as never, ORG_BINDING, eligible.map((e) => (typeof e === 'string' ? outboxRow(e, 'pending') : e)));
const noise = (c: Call) => (c.table === 'profiles' ? { data: [{ id: 'admin-1' }], error: null } : { data: c.op === 'select' ? [] : null, error: null });

Deno.test('AC-IMP-072 the work queue is this org\'s pending and failed intents, round robin, bounded; a failed one waits out its delay', async () => {
  const old = new Date(Date.now() - 3 * 3600_000).toISOString();
  const recent = new Date(Date.now() - 1000).toISOString();
  const f = fakeClient({ respond: () => ({ error: null, data: [
    { ...intent({ id: 'a' }), last_attempt_at: null },
    { ...intent({ id: 'b', push_state: 'failed', attempt_count: 2 }), last_attempt_at: old },
    { ...intent({ id: 'c', push_state: 'failed', attempt_count: 2 }), last_attempt_at: recent },
  ] }) });
  const rows = await deps(f.client).listPending(ORG, 200);
  assertEquals(rows.map((r) => r.id), ['a', 'b']);
  assertEquals(f.calls[0].table, 'imprest_posting_erp_mirror');
  assertEquals(f.calls[0].ops.slice(1), [['eq', 'org_id', ORG], ['in', 'push_state', ['pending', 'failed']], ['is', 'erp_cancelled_at', null],
    ['order', 'last_attempt_at', { ascending: true, nullsFirst: true }], ['order', 'created_at', { ascending: true }], ['limit', 200]]);
});

Deno.test('AC-IMP-072 a failed outcome counts the failure on the imprest mirror; other outcomes do not', async () => {
  const f = fakeClient({ respond: noise });
  await deps(f.client).recordOutcome(intent({ attempt_count: 2 }), { state: 'failed', reason: 'refused' });
  await deps(f.client).recordOutcome(intent({ attempt_count: 2 }), { state: 'held', reason: 'command-held' });
  const updates = f.calls.filter((c) => c.table === 'imprest_posting_erp_mirror' && c.op === 'update');
  assertEquals(updates.map((u) => (u.payload as Record<string, unknown>).attempt_count), [3, undefined]);
  assertEquals(updates[0].ops, [['eq', 'org_id', ORG], ['eq', 'id', 'mirror-1'], ['in', 'push_state', ['pending', 'failed']], ['is', 'erp_cancelled_at', null]]);
  assertEquals(f.calls.some((c) => c.table === 'expense_posting_erp_mirror'), false);
});

Deno.test('AC-IMP-072 only a committed impt: command whose intent is already pushed is stranded', async () => {
  const f = fakeClient({ respond: () => ({ data: [intent({ push_state: 'pushed' })], error: null }) });
  const stranded = await deps(f.client, [outboxRow('ob-1', 'committed'),
    outboxRow('ob-2', 'committed', { pmoRecordId: 'x:approval', idempotencyKey: 'expj:x:1' }),
    outboxRow('ob-3', 'pending')]).listStranded(ORG);
  assertEquals(stranded.map((s) => [s.row.id, s.outbox.id]), [['mirror-1', 'ob-1']]);
  assertEquals(f.calls[0].ops.at(-1), ['in', 'posting_identity', [`${REP}:replenishment`]]);
  const h = fakeClient();
  assertEquals(await deps(h.client, [outboxRow('ob-4', 'committed', { idempotencyKey: 'expj:x:1' })]).listStranded(ORG), []);
  assertEquals(h.calls.length, 0);
});

Deno.test('AC-IMP-072 an outbox row is found by the replenishment identity and the re-derived key', async () => {
  const f = fakeClient();
  await deps(f.client).findOutbox(intent());
  assertEquals(f.calls[0].ops.filter((o) => o[0] === 'eq'),
    [['eq', 'org_id', ORG], ['eq', 'domain', 'expenses'], ['eq', 'pmo_record_id', `${REP}:replenishment`], ['eq', 'idempotency_key', KEY]]);
});

Deno.test('AC-IMP-072 a replay that could post anew re-asserts the gate; a refusal never reaches the outbox', async () => {
  const f = fakeClient({
    rpc: (fn) => (fn === 'imprest_posting_for_push' ? { data: null, error: { code: '42501', message: 'imprest-posting-actor-not-authorized' } } : { data: null, error: null }),
    respond: noise,
  });
  await deps(f.client, ['ob-1']).replay(intent(), { id: 'ob-1', state: 'failed' } as never);
  assertEquals(f.rpcs[0], ['imprest_posting_for_push', { p_org_id: ORG, p_mirror_id: 'mirror-1' }]);
  assertEquals(f.calls.some((c) => c.table === 'external_command_outbox'), false);
  assertEquals(f.calls.find((c) => c.table === 'imprest_posting_erp_mirror' && c.op === 'update')?.payload,
    { push_state: 'failed', push_error: 'imprest-posting-actor-not-authorized', attempt_count: 1 });
});

for (const [state, reason] of [['confirmed', 'expense-posting-mirror-diverged'], ['held', 'command-held'], ['failed', 'expense-posting-attempts-exhausted']] as const) {
  Deno.test(`AC-IMP-072 an outbox row in '${state}' that 0131 no longer offers parks the intent held (${reason}) and notifies`, async () => {
    const f = fakeClient({ respond: noise });
    await deps(f.client).replay(intent(), { id: 'ob-1', state } as never);
    assertEquals(f.calls.find((c) => c.table === 'imprest_posting_erp_mirror' && c.op === 'update')?.payload, { push_state: 'held', push_error: reason });
    assertEquals(JSON.stringify(f.calls.find((c) => c.table === 'notifications' && c.op === 'insert')?.payload).includes('imprest-posting-held'), true);
  });
}

Deno.test('AC-IMP-072 the gate: a refusal class is a recorded refusal, anything else throws; a good answer is parsed, not cast', async () => {
  for (const code of ['P0001', 'P0002', '42501']) {
    const f = fakeClient({ rpc: () => ({ data: null, error: { code, message: 'refused' } }) });
    assertEquals(await deps(f.client).assertGate(intent()), { ok: false, reason: 'refused' });
  }
  const boom = fakeClient({ rpc: () => ({ data: null, error: { code: 'XX000', message: 'db down' } }) });
  let thrown = '';
  try { await deps(boom.client).assertGate(intent()); } catch (e) { thrown = (e as Error).message; }
  assertEquals(thrown, 'db down');
  const bad = fakeClient({ rpc: () => ({ data: { amount: 800000 }, error: null }) });
  thrown = '';
  try { await deps(bad.client).assertGate(intent()); } catch (e) { thrown = (e as Error).message; }
  assertEquals(thrown.includes('imprest-gate-truth-malformed'), true);
});

Deno.test('AC-IMP-071 head office is the binding\'s bank account; a company cash account alone is not a funding source', async () => {
  const read = (config: Record<string, unknown>) =>
    imprestResolveDepsLive(fakeClient().client as never, { ...ORG_BINDING, config } as never).readBinding();
  assertEquals((await read({ default_bank_account: 'Bank - X', default_cash_account: 'Cash - X' })).headOfficeAccount, 'Bank - X');
  assertEquals((await read({ default_cash_account: 'Cash - X' })).headOfficeAccount, null);
});

Deno.test('AC-IMP-072 replay dispositions: not-due waiting, parked held, refused actor, failed dispatch', async () => {
  // not due (committing / retry delay) -> waiting, nothing written
  const f1 = fakeClient();
  assertEquals(await deps(f1.client).replay(intent(), { id: 'ob-1', state: 'committing' } as never), 'waiting');
  const retrying = imprestPostingBackstopDepsLive(f1.client as never, ORG_BINDING, [], undefined, new Set(['ob-2']));
  assertEquals(await retrying.replay(intent({ push_state: 'failed' }), { id: 'ob-2', state: 'failed' } as never), 'waiting');
  assertEquals(f1.calls, [], 'a command that is not due is left alone');
  // not offered by 0131 and not in a wait window -> held
  const f2 = fakeClient({ respond: noise });
  assertEquals(await deps(f2.client).replay(intent(), { id: 'ob-3', state: 'confirmed' } as never), 'held');
  // gate refusal -> refused
  const f3 = fakeClient({
    rpc: () => ({ data: null, error: { code: '42501', message: 'imprest-posting-actor-not-authorized' } }),
    respond: noise,
  });
  assertEquals(await deps(f3.client, ['ob-4']).replay(intent(), { id: 'ob-4', state: 'failed' } as never), 'refused');
  // dispatch throws on a pending intent -> recorded failed, reported failed (never 'completed')
  const f4 = fakeClient({ respond: noise });
  assertEquals(await deps(f4.client, [outboxRow('ob-5', 'committed')]).replay(intent(), outboxRow('ob-5', 'committed') as never), 'failed');
  const update = f4.calls.find((c) => c.table === 'imprest_posting_erp_mirror' && c.op === 'update');
  assertEquals((update?.payload as Record<string, unknown>).push_state, 'failed');
});
