import "../_shared/testing/publicErpDns.ts";

/**
 * #2149 Part A [Deno] — the sweep's money recovery passes stop starting new rows once this organisation's
 * ERPNext has not answered on this tick, or once the invocation is past the money row-start deadline.
 *
 * Why: every ERP call waits its own deadline (a recovery probe 20 s, a write 120 s), and the function's
 * wall-clock cap is 150 s. Without a stop, one silent ERPNext made each later row wait the same deadline in
 * turn, so a single organisation could spend the whole invocation, and a row started near the cap could be
 * cut off mid-write and then sit out the outbox quarantine window. A row the pass does not reach is left
 * exactly as it is (no claim, no outcome recorded, attempts unchanged) and the next tick takes it.
 *
 * Drives the shipped handlers: `reconcileOrgOutbox` / `runErpSweepCycle` (index.ts), the four backstop cores,
 * the sweep's per-organisation ERP fetch (`sweepShared.ts`) and a live ERP read in `moneyWriteLive.ts`.
 *
 * Verify: deno test --config supabase/functions/erpnext-sweep/deno.json supabase/functions/erpnext-sweep/moneyPassTiming.test.ts
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { reconcileOrgOutbox, runErpSweepCycle, STATEMENT_SWEEP_WALL_CLOCK_CAP_MS } = await import('./index.ts');
import { erpClientForBinding, watchErpAnswer, moneyRowsStopped, type OrgBinding } from './sweepShared.ts';
import { readErpFiscalYearsLive } from './moneyWriteLive.ts';
import { HOURLY_INVOCATION_DEADLINE_MS, MONEY_ROW_START_DEADLINE_MS } from './sweepCadence.ts';
import { reconcileOrgBudgetPushes, type BudgetBackstopDeps } from './budgetBackstop.ts';
import { reconcileOrgTimesheetPushes, type TimesheetBackstopDeps } from './timesheetBackstop.ts';
import { reconcileOrgExpensePostings, type ExpenseBackstopDeps } from './expensePostingBackstop.ts';
import { reconcileOrgBudgetArchiveCancellations, type BudgetArchiveBackstopDeps } from './budgetArchiveBackstop.ts';
import { ERP_PROBE_TIMEOUT_MS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const candidate = (id: string, overrides: Partial<OutboxRow> = {}): OutboxRow => ({
  id, domain: 'procurement', pmoRecordId: `pmo-${id}`, idempotencyKey: `key-${id}`, state: 'pending',
  externalRecordId: null, canonical: { id }, claimGeneration: 1, payloadDigest: null, ...overrides,
} as OutboxRow);

Deno.test('#2149: the outbox recovery pass starts no further row once the organisation is stopped; skipped rows are untouched and not reported', async () => {
  let stopped = false;
  const org = { orgId: 'org-1', ownedDomains: ['procurement'], stopNewMoneyRows: () => stopped };
  const driven: string[] = [];
  const result = await reconcileOrgOutbox(
    () => Promise.resolve([candidate('a'), candidate('b'), candidate('c')]),
    org,
    (row) => ({ row } as never),
    ((deps: { row: OutboxRow }) => {
      driven.push(deps.row.id);
      stopped = true; // ERPNext did not answer on the first row
      return Promise.reject(new Error('external system unreachable — try again'));
    }) as never,
  );
  assert(driven.join() === 'a', `only the first row may be driven; got ${driven.join()}`);
  assert(result.errors.length === 1 && result.errors[0]!.id === 'a', `only the driven row reports: ${JSON.stringify(result.errors)}`);
});

Deno.test('#2149: a stopped organisation still reports a row held for an operator (no ERP call is needed to say so)', async () => {
  const org = { orgId: 'org-1', ownedDomains: ['revenue'], stopNewMoneyRows: () => true };
  const driven: string[] = [];
  const result = await reconcileOrgOutbox(
    () => Promise.resolve([candidate('held'), candidate('owned', { domain: 'revenue' })]),
    org,
    (row) => ({ row } as never),
    ((deps: { row: OutboxRow }) => { driven.push(deps.row.id); return Promise.resolve(); }) as never,
  );
  assert(driven.length === 0, `no row may be driven: ${driven.join()}`);
  assert(result.errors.length === 1 && result.errors[0]!.error.startsWith('domain-not-owned'), `the hold is still reported: ${JSON.stringify(result.errors)}`);
});

Deno.test('#2149: the budget backstop starts no further push once stopped', async () => {
  let stopped = false;
  const driven: string[] = [];
  const deps: BudgetBackstopDeps = {
    listPendingBudgetPushes: () => Promise.resolve(['v1', 'v2', 'v3'].map((id) => ({ budget_version_id: id, push_state: 'pending' }))),
    readBudgetVersion: (id) => Promise.resolve({ id, status: 'Active', activated_at: '2026-01-01T00:00:00Z' }),
    driveBudgetPush: (row) => { driven.push(row.budget_version_id); stopped = true; return Promise.reject(new Error('unreachable')); },
    stopNewRows: () => stopped,
  };
  const result = await reconcileOrgBudgetPushes(deps, { orgId: 'org-1' });
  assert(driven.join() === 'v1', `only v1 driven, got ${driven.join()}`);
  assert(result.errors.length === 1, `only the driven row reports: ${JSON.stringify(result.errors)}`);
});

Deno.test('#2149: the timesheet backstop starts no further push once stopped', async () => {
  let stopped = false;
  const driven: string[] = [];
  const gates: string[] = [];
  const deps: TimesheetBackstopDeps = {
    listPendingTimesheetPushes: () => Promise.resolve(['t1', 't2'].map((id) => ({ timesheet_id: id, push_state: 'pending' }) as never)),
    assertApprovedForPush: (row) => { gates.push(row.timesheet_id); return Promise.resolve({ ok: true, approvedAt: '2026-01-01T00:00:00Z' }); },
    recordGateRefusal: () => Promise.resolve(),
    driveTimesheetPush: (row) => { driven.push(row.timesheet_id); stopped = true; return Promise.resolve(); },
    stopNewRows: () => stopped,
  };
  await reconcileOrgTimesheetPushes(deps, { orgId: 'org-1' });
  assert(driven.join() === 't1' && gates.join() === 't1', `t2 must not even be gated: driven=${driven} gates=${gates}`);
});

Deno.test('#2149: the expense (and site float) backstop starts no further intent once stopped and records nothing on the skipped ones', async () => {
  let stopped = false;
  const touched: string[] = [];
  const recorded: string[] = [];
  const deps: ExpenseBackstopDeps<{ id: string }, unknown, unknown> = {
    listStranded: () => Promise.resolve([{ row: { id: 's1' }, outbox: {} as never }, { row: { id: 's2' }, outbox: {} as never }]),
    listPending: () => Promise.resolve([{ id: 'p1' }, { id: 'p2' }]),
    markAttempted: () => Promise.resolve(),
    findOutbox: (row) => { touched.push(row.id); return Promise.resolve(null); },
    replay: (row) => { touched.push(row.id); stopped = true; return Promise.reject(new Error('unreachable')); },
    assertGate: () => Promise.resolve({ ok: true, truth: {} } as never),
    resolve: () => Promise.resolve({ outcome: 'wait' } as never),
    recordOutcome: (row) => { recorded.push(row.id); return Promise.resolve(); },
    driveFresh: () => Promise.resolve(),
    stopNewRows: () => stopped,
  };
  await reconcileOrgExpensePostings(deps, { orgId: 'org-1' });
  assert(touched.join() === 's1', `only the first stranded intent may run: ${touched.join()}`);
  assert(recorded.length === 0, `a skipped intent records no outcome: ${recorded.join()}`);
});

Deno.test('#2149: the budget archive cancellation backstop starts no further cancellation once stopped', async () => {
  let stopped = false;
  const read: string[] = [];
  const deps: BudgetArchiveBackstopDeps = {
    listPending: () => Promise.resolve([{ id: 'j1' }, { id: 'j2' }] as never),
    readLifecycle: (job) => { read.push(job.id); stopped = true; return Promise.reject(new Error('unreachable')); },
    targetIsStillLiveAndOwned: () => Promise.resolve(true),
    driveCancellation: () => Promise.resolve(true),
    markComplete: () => Promise.resolve(),
    markSuperseded: () => Promise.resolve(),
    markHeld: () => Promise.resolve(),
    noteRetry: () => Promise.resolve(),
    stopNewRows: () => stopped,
  };
  await reconcileOrgBudgetArchiveCancellations(deps, 'org-1');
  assert(read.join() === 'j1', `only j1 may run: ${read.join()}`);
});

const bindingOf = (orgId: string): OrgBinding => ({
  orgId, siteUrl: 'https://erp.example.test', secretRef: 'synthetic-test-ref', company: 'Synthetic Co',
  config: {}, ownedDomains: ['revenue'], versionMajor: 16, lastFullSweepAt: null,
});

function cycleHarness(orgs: OrgBinding[], silentOrg: string | null, overrides: Record<string, unknown> = {}) {
  const log: string[] = [];
  const settled: string[] = [];
  const pass = (name: string, result: Record<string, unknown>) => (o: OrgBinding) => { log.push(`${name}:${o.orgId}`); return Promise.resolve(result); };
  const deps = {
    listEmployingOrgs: () => Promise.resolve(orgs),
    reconcileOrgOutbox: (o: OrgBinding) => {
      log.push(`reconcile:${o.orgId}:${moneyRowsStopped(o) ? 'stopped' : 'open'}`);
      if (o.orgId === silentOrg) o.erpUnanswered = true;
      return Promise.resolve({ reconciled: 0, errors: [] });
    },
    reconcileOrgBudgetPushes: pass('budget', { driven: 0 }),
    reconcileOrgTimesheetPushes: pass('timesheet', { driven: 0 }),
    reconcileOrgExpensePostings: pass('expenses', { driven: 0 }),
    reconcileOrgImprestPostings: pass('imprest', { driven: 0 }),
    advanceConnectRun: pass('connect', {}),
    drainConnectSends: pass('sends', {}),
    sweepOrgDoctypes: pass('sweep', { applied: 0, complete: true }),
    repairOrgLinks: pass('repair', { repaired: 0 }),
    feedOrgLedgers: pass('ledger', { gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }),
    feedOrgPurchases: pass('purchases', { fed: 0 }),
    refreshOrgAccounting: pass('accounting', {}),
    markFullSweepDone: (o: OrgBinding) => { settled.push(`done:${o.orgId}`); return Promise.resolve(); },
    deferFullSweep: (o: OrgBinding) => { settled.push(`defer:${o.orgId}`); return Promise.resolve(); },
    ...overrides,
  };
  return { deps: deps as unknown as Parameters<typeof runErpSweepCycle>[0], log, settled };
}

Deno.test('#2149: an organisation whose ERPNext did not answer runs no further pass this tick; the next organisation runs in full', async () => {
  const h = cycleHarness([bindingOf('silent'), bindingOf('healthy')], 'silent');
  const r = await runErpSweepCycle(h.deps);
  const silent = h.log.filter((l) => l.includes(':silent'));
  assert(silent.join() === 'reconcile:silent:open', `the silent organisation runs nothing after the outbox pass: ${silent.join()}`);
  assert(!h.settled.some((s) => s.endsWith(':silent')), `its hourly marker is left as it is: ${h.settled.join()}`);
  assert(r.perOrg[0]!.errors.some((e) => e.startsWith('erp-unanswered')), `the stop is reported once: ${JSON.stringify(r.perOrg[0]!.errors)}`);
  const healthy = h.log.filter((l) => l.includes(':healthy'));
  for (const name of ['reconcile', 'budget', 'timesheet', 'expenses', 'imprest', 'connect', 'sends', 'sweep', 'ledger', 'accounting']) {
    assert(healthy.some((l) => l.startsWith(`${name}:`)), `the healthy organisation still runs ${name}: ${healthy.join()}`);
  }
  assert(h.settled.includes('done:healthy'), `the healthy organisation's run is stamped: ${h.settled.join()}`);
});

Deno.test('#2149: past the money row-start deadline the money passes start nothing new; the clock before it leaves them open', async () => {
  let clock = 0;
  const h = cycleHarness([bindingOf('a')], null, { nowMs: () => clock, moneyDeadlineAtMs: 1_000 });
  await runErpSweepCycle(h.deps);
  assert(h.log.includes('reconcile:a:open') && h.log.includes('budget:a'), `before the deadline the money passes run: ${h.log.join()}`);
  clock = 1_000;
  const late = cycleHarness([bindingOf('a')], null, { nowMs: () => clock, moneyDeadlineAtMs: 1_000 });
  await runErpSweepCycle(late.deps);
  assert(late.log.includes('reconcile:a:stopped'), `the outbox pass sees the stop: ${late.log.join()}`);
  for (const name of ['budget', 'timesheet', 'expenses', 'imprest']) {
    assert(!late.log.includes(`${name}:a`), `${name} must not start past the deadline: ${late.log.join()}`);
  }
});

Deno.test('#2149: the money row-start deadline leaves a started row time for its recovery probe inside the wall-clock cap, and runs past the hourly deadline', () => {
  assert(MONEY_ROW_START_DEADLINE_MS + ERP_PROBE_TIMEOUT_MS < STATEMENT_SWEEP_WALL_CLOCK_CAP_MS,
    `${MONEY_ROW_START_DEADLINE_MS} + ${ERP_PROBE_TIMEOUT_MS} must be under ${STATEMENT_SWEEP_WALL_CLOCK_CAP_MS}`);
  assert(MONEY_ROW_START_DEADLINE_MS > HOURLY_INVOCATION_DEADLINE_MS, 'money passes keep running after the hourly passes stop starting');
});

// ── the sweep's ERP fetch notices an ERPNext that does not answer ─────────────────────────────────

function stalledBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('{"data":')); },
    pull() { return Promise.reject(new Error('the connection was reset')); },
  });
}

Deno.test('#2149: a request that fails, or a body that stops, counts as no answer; a complete answer (even an error status) does not', async () => {
  const cases: Array<[string, () => Promise<Response>, boolean]> = [
    ['network failure', () => Promise.reject(new TypeError('error sending request')), true],
    ['body stops', () => Promise.resolve(new Response(stalledBody(), { status: 200 })), true],
    ['answered 200', () => Promise.resolve(new Response('{"data":[]}', { status: 200 })), false],
    ['answered 503', () => Promise.resolve(new Response('busy', { status: 503 })), false],
    ['answered 204', () => Promise.resolve(new Response(null, { status: 204 })), false],
    ['destination refused', () => Promise.reject(new Error('ERPNext destination is not permitted')), false],
  ];
  for (const [name, inner, expectSilent] of cases) {
    let silent = false;
    const watched = watchErpAnswer(() => inner(), () => { silent = true; });
    try {
      const res = await watched('https://erp.example.test/api/resource/X');
      await res.text();
    } catch { /* the caller sees the same failure */ }
    assert(silent === expectSilent, `${name}: expected no-answer=${expectSilent}, got ${silent}`);
  }
});

Deno.test('#2149: a watched answer passes status, headers and body through unchanged', async () => {
  const watched = watchErpAnswer(() => Promise.resolve(new Response('{"data":[1]}', { status: 417, headers: { 'X-T': 'v' } })), () => {});
  const res = await watched('https://erp.example.test/x');
  assert(res.status === 417 && res.headers.get('X-T') === 'v' && (await res.text()) === '{"data":[1]}', 'pass-through');
});

function withFetch(impl: typeof fetch): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return { restore: () => { globalThis.fetch = original; } };
}

Deno.test('#2149: the per-organisation ERP client the passes share marks its organisation when ERPNext does not answer', async () => {
  const org = bindingOf('org-x');
  const cache = new Map([[org.orgId, Promise.resolve({ apiKey: 'k', apiSecret: 's' })]]);
  const f = withFetch(() => Promise.reject(new TypeError('error sending request')));
  try {
    const client = await erpClientForBinding(null as unknown as SupabaseClient, org, cache as never);
    await client.fetchImpl('https://erp.example.test/api/resource/X').catch(() => undefined);
  } finally {
    f.restore();
  }
  assert(org.erpUnanswered === true, 'the organisation is marked');
  assert(bindingOf('org-y').erpUnanswered === undefined, 'another organisation is not');
});

Deno.test('#2149: a money pass ERP read outside the shared client (the fiscal calendar) marks the organisation too', async () => {
  const org = bindingOf('org-f');
  const cache = new Map([[org.orgId, Promise.resolve({ apiKey: 'k', apiSecret: 's' })]]);
  const f = withFetch(() => Promise.reject(new TypeError('error sending request')));
  try {
    await readErpFiscalYearsLive(null as unknown as SupabaseClient, org, cache as never).catch(() => undefined);
  } finally {
    f.restore();
  }
  assert(org.erpUnanswered === true, 'the organisation is marked');
});
