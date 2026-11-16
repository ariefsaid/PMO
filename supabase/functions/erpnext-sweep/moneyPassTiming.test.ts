import "../_shared/testing/publicErpDns.ts";

/**
 * #2149 Part A [Deno] — the sweep's money recovery passes stop starting new rows once this organisation's
 * ERPNext has not answered on this tick, or once a full minimum ERP try no longer fits the invocation's one
 * deadline budget (each try gets min(120 s, time left − the outcome-write margin)); each queue row is stamped
 * when its turn comes, so a stopped batch is resumed, not re-stamped.
 *
 * Why: every ERP call waits its own deadline (a recovery probe 20 s, a write 120 s), and the function's
 * wall-clock cap is 150 s. The stop keeps one silent ERPNext from making each later row wait the same deadline
 * in turn, and keeps every try, writes included, ending before the cap with time to record its outcome. A row
 * the pass does not reach is left exactly as it is (no claim, no outcome recorded, attempts unchanged) and the
 * next tick takes it. An organisation whose ERPNext did not answer on an hourly tick is counted as a failed run (#1642) and goes
 * after the others on later ticks; the hourly passes' tries end by 115 s, so the next organisation's money passes
 * still get a full minimum try.
 *
 * Drives the shipped handlers: `reconcileOrgOutbox` / `runErpSweepCycle` (index.ts), the four backstop cores,
 * the sweep's per-organisation ERP fetch (`sweepShared.ts`) and a live ERP read in `moneyWriteLive.ts`.
 *
 * Verify: deno test --config supabase/functions/erpnext-sweep/deno.json supabase/functions/erpnext-sweep/moneyPassTiming.test.ts
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { reconcileOrgOutbox, runErpSweepCycle, STATEMENT_SWEEP_WALL_CLOCK_CAP_MS } = await import('./index.ts');
import {
  erpClientForBinding, watchErpAnswer, moneyRowsStopped, orgErpFetch, orgErpTransport, sweepTryTimeoutMs, sweepTryFits, SweepDeadlineError,
  SWEEP_MIN_TRY_MS, SWEEP_OUTCOME_WRITE_MARGIN_MS, SWEEP_STAGE_WRITE_ALLOWANCE_MS, SWEEP_TRY_CAP_MS, type OrgBinding, type SweepBudget,
} from './sweepShared.ts';
import { readErpFiscalYearsLive } from './moneyWriteLive.ts';
import { HOURLY_INVOCATION_DEADLINE_MS, HOURLY_TRY_DEADLINE_MS, SWEEP_FULL_INTERVAL_MS, SWEEP_INVOCATION_DEADLINE_MS, fullSweepDue, sweepRetryDelaySeconds } from './sweepCadence.ts';
import { reconcileOrgBudgetPushes, type BudgetBackstopDeps } from './budgetBackstop.ts';
import { reconcileOrgTimesheetPushes, type TimesheetBackstopDeps } from './timesheetBackstop.ts';
import { reconcileOrgExpensePostings, type ExpenseBackstopDeps } from './expensePostingBackstop.ts';
import { reconcileOrgBudgetArchiveCancellations, type BudgetArchiveBackstopDeps } from './budgetArchiveBackstop.ts';
import { ERP_PROBE_TIMEOUT_MS, ERP_REQUEST_TIMEOUT_MS, erpnextRequest } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
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
  const delays: number[] = [];
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
    deferFullSweep: (o: OrgBinding, dueInSeconds: number) => { settled.push(`defer:${o.orgId}`); delays.push(dueInSeconds); return Promise.resolve(); },
    ...overrides,
  };
  return { deps: deps as unknown as Parameters<typeof runErpSweepCycle>[0], log, settled, delays };
}

Deno.test('#2149: an organisation whose ERPNext did not answer runs no further pass this tick; the next organisation runs in full', async () => {
  const h = cycleHarness([bindingOf('silent'), bindingOf('healthy')], 'silent');
  const r = await runErpSweepCycle(h.deps);
  const silent = h.log.filter((l) => l.includes(':silent'));
  assert(silent.join() === 'reconcile:silent:open', `the silent organisation runs nothing after the outbox pass: ${silent.join()}`);
  assert(h.settled.filter((s) => s.endsWith(':silent')).join() === 'defer:silent', `its run is deferred as failed (#1642), never stamped done: ${h.settled.join()}`);
  assert(h.delays[0] === sweepRetryDelaySeconds(0), `with the first failure's retry delay: ${h.delays.join()}`);
  assert(r.perOrg[0]!.errors.some((e) => e.startsWith('erp-unanswered')), `the stop is reported once: ${JSON.stringify(r.perOrg[0]!.errors)}`);
  const healthy = h.log.filter((l) => l.includes(':healthy'));
  for (const name of ['reconcile', 'budget', 'timesheet', 'expenses', 'imprest', 'connect', 'sends', 'sweep', 'ledger', 'accounting']) {
    assert(healthy.some((l) => l.startsWith(`${name}:`)), `the healthy organisation still runs ${name}: ${healthy.join()}`);
  }
  assert(h.settled.includes('done:healthy'), `the healthy organisation's run is stamped: ${h.settled.join()}`);
});

Deno.test('#2149: an organisation whose ERPNext stays silent goes after the others on the next tick, so their money passes get a full try', async () => {
  // Two ticks over the stored full-run marker, as `defer_erp_full_sweep` / `mark_erp_full_sweep_done` (0918) write it.
  const INTERVAL_MS = 55 * 60_000;
  let wallMs = Date.parse('2026-11-16T10:00:00Z');
  const stored = new Map<string, { at: string | null; failures: number }>([
    ['a', { at: null, failures: 0 }], // never run: without a stop it sorts first
    // b completed recently: a's deferred marker (55 min − the retry delay ago) is still the older one, so only the failure
    // count can put a after b
    ['b', { at: new Date(wallMs - 10 * 60_000).toISOString(), failures: 0 }],
  ]);
  const tick = async () => {
    let clock = 0; // the invocation's own clock
    const firstTry: Record<string, number> = {};
    const orgs = [...stored].map(([id, s]) => ({ ...bindingOf(id), lastFullSweepAt: s.at, fullSweepFailures: s.failures }));
    const h = cycleHarness(orgs, null, {
      nowMs: () => clock, invocationDeadlineAtMs: SWEEP_INVOCATION_DEADLINE_MS,
      reconcileOrgOutbox: (o: OrgBinding) => {
        firstTry[o.orgId] = moneyRowsStopped(o) ? 0 : sweepTryTimeoutMs(o.sweepBudget!);
        if (o.orgId === 'a') { clock += ERP_REQUEST_TIMEOUT_MS; o.erpUnanswered = true; } // a's ERPNext never answers
        return Promise.resolve({ reconciled: 0, errors: [] });
      },
      deferFullSweep: (o: OrgBinding, dueInSeconds: number) => {
        const s = stored.get(o.orgId)!;
        stored.set(o.orgId, { at: new Date(wallMs - INTERVAL_MS + dueInSeconds * 1000).toISOString(), failures: s.failures + (dueInSeconds > 0 ? 1 : 0) });
        return Promise.resolve();
      },
      markFullSweepDone: (o: OrgBinding) => { stored.set(o.orgId, { at: new Date(wallMs).toISOString(), failures: 0 }); return Promise.resolve(); },
    });
    await runErpSweepCycle(h.deps, undefined, 'full');
    wallMs += 60_000;
    return firstTry;
  };
  await tick(); // tick 1: a goes first and spends the client's whole attempt
  const second = await tick();
  assert((second.b ?? 0) >= SWEEP_MIN_TRY_MS, `on tick 2, b's money pass starts with at least a minimum try: ${JSON.stringify(second)}`);
  assert(stored.get('a')!.failures > 0, `a's silent run is counted as a failed run (#1642's stamp): ${JSON.stringify([...stored])}`);
});

Deno.test('#2149: an hourly pass whose ERP try the hourly deadline refused leaves the run unfinished (next tick), not failed (no back-off)', async () => {
  let clock = 90_000; // an hourly try still fits the 125 s hourly deadline: 125 − 90 − 10 = 25 s
  const h = cycleHarness([bindingOf('a')], null, {
    nowMs: () => clock, invocationDeadlineAtMs: SWEEP_INVOCATION_DEADLINE_MS, hourlyTryDeadlineAtMs: HOURLY_TRY_DEADLINE_MS,
    sweepOrgDoctypes: async (o: OrgBinding) => {
      clock += 10_000; // database work first; then 125 − 100 − 10 = 15 s is less than a minimum try
      try {
        await orgErpFetch(o)('https://erp.example.test/api/resource/Customer');
        return { applied: 0, complete: true };
      } catch (err) {
        return { applied: 0, error: String(err) };
      }
    },
  });
  await runErpSweepCycle(h.deps, undefined, 'full');
  assert(h.settled.join() === 'defer:a' && h.delays.join() === '0', `deferred to the next tick without a failure delay: ${h.settled.join()} ${h.delays.join()}`);
  // The same pass failing on its own (ERPNext answered with an error) is a failed run and backs off.
  clock = 0;
  const failing = cycleHarness([bindingOf('a')], null, {
    nowMs: () => clock, invocationDeadlineAtMs: SWEEP_INVOCATION_DEADLINE_MS, hourlyTryDeadlineAtMs: HOURLY_TRY_DEADLINE_MS,
    sweepOrgDoctypes: () => Promise.resolve({ applied: 0, error: 'ERPNext answered 500' }),
  });
  await runErpSweepCycle(failing.deps, undefined, 'full');
  assert(failing.delays.join() === String(sweepRetryDelaySeconds(0)), `a real failure keeps its back-off: ${failing.delays.join()}`);
});

Deno.test('#2149: the hourly tries\' deadline leaves the next money try a full minimum before the invocation deadline', () => {
  const hourlyTriesEndBy = HOURLY_TRY_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS;
  const lastMoneyTryStart = SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - SWEEP_MIN_TRY_MS;
  assert(hourlyTriesEndBy <= lastMoneyTryStart, `hourly tries end by ${hourlyTriesEndBy} ≤ last money try start ${lastMoneyTryStart}`);
  assert(hourlyTriesEndBy - SWEEP_MIN_TRY_MS < HOURLY_INVOCATION_DEADLINE_MS, 'the last hourly try starts before the hourly start limit');
});

Deno.test('#2149: once a full minimum try no longer fits, the money passes and the hourly passes start nothing new', async () => {
  let clock = 0;
  const deadline = { nowMs: () => clock, invocationDeadlineAtMs: 145_000 };
  const early = cycleHarness([bindingOf('a')], null, deadline);
  await runErpSweepCycle(early.deps);
  assert(early.log.includes('reconcile:a:open') && early.log.includes('budget:a') && early.log.includes('sweep:a'), `with time left everything runs: ${early.log.join()}`);
  clock = 145_000 - SWEEP_OUTCOME_WRITE_MARGIN_MS - SWEEP_MIN_TRY_MS; // exactly one minimum try still fits
  const edge = cycleHarness([bindingOf('a')], null, deadline);
  await runErpSweepCycle(edge.deps);
  assert(edge.log.includes('reconcile:a:open') && edge.log.includes('imprest:a'), `a try that just fits still starts: ${edge.log.join()}`);
  clock += 1;
  const late = cycleHarness([bindingOf('a')], null, deadline);
  await runErpSweepCycle(late.deps);
  assert(late.log.includes('reconcile:a:stopped'), `the outbox pass sees the stop: ${late.log.join()}`);
  for (const name of ['budget', 'timesheet', 'expenses', 'imprest', 'sweep', 'ledger', 'accounting']) {
    assert(!late.log.includes(`${name}:a`), `${name} must not start once no try fits: ${late.log.join()}`);
  }
  assert(!late.settled.includes('done:a'), `a run that did nothing is not stamped done: ${late.settled.join()}`);
});

Deno.test('#2149: the cycle hands each organisation the one invocation budget its ERP fetch spends, and takes it back after', async () => {
  const seen: Array<number | undefined> = [];
  const orgs = [bindingOf('a'), bindingOf('b')];
  const h = cycleHarness(orgs, null, {
    nowMs: () => 0, invocationDeadlineAtMs: 145_000,
    reconcileOrgOutbox: (o: OrgBinding) => { seen.push(o.sweepBudget?.deadlineAtMs); return Promise.resolve({ reconciled: 0, errors: [] }); },
  });
  await runErpSweepCycle(h.deps);
  assert(seen.join() === '145000,145000', `both organisations share the one deadline: ${seen.join()}`);
  assert(orgs.every((o) => o.sweepBudget === undefined), 'the budget does not outlive the tick');
});

Deno.test('#2149: the invocation deadline sits under the wall-clock cap; a minimum try is the recovery probe', () => {
  assert(SWEEP_INVOCATION_DEADLINE_MS < STATEMENT_SWEEP_WALL_CLOCK_CAP_MS, `${SWEEP_INVOCATION_DEADLINE_MS} < ${STATEMENT_SWEEP_WALL_CLOCK_CAP_MS}`);
  assert(SWEEP_MIN_TRY_MS === ERP_PROBE_TIMEOUT_MS, 'a minimum try is one full recovery-probe attempt');
  assert(SWEEP_TRY_CAP_MS === ERP_REQUEST_TIMEOUT_MS, 'a try is never given more than the client gives one attempt');
  assert(SWEEP_OUTCOME_WRITE_MARGIN_MS > 0, 'the outcome write has a margin');
  // Money keeps priority: the hourly passes stop starting while money rows still can, so a later organisation's
  // money still runs after an earlier organisation's hourly work.
  const lastTryStartMs = SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - SWEEP_MIN_TRY_MS;
  assert(HOURLY_INVOCATION_DEADLINE_MS < lastTryStartMs, `hourly deadline ${HOURLY_INVOCATION_DEADLINE_MS} < last money try start ${lastTryStartMs}`);
});

// ── the deadline budget: one deadline, each try min(cap, left − margin), no try unless a minimum fits ──

const budgetAt = (clock: { now: number }, timers: Array<{ ms: number; fire: () => void; cancelled: boolean }> = []): SweepBudget => ({
  deadlineAtMs: SWEEP_INVOCATION_DEADLINE_MS,
  nowMs: () => clock.now,
  setTimer: (fn, ms) => {
    const t = { ms, fire: fn, cancelled: false };
    timers.push(t);
    return () => { t.cancelled = true; };
  },
});

Deno.test('#2149: from any start, a try that starts ends by the deadline minus the outcome margin, and none starts without a full minimum', () => {
  const clock = { now: 0 };
  const b = budgetAt(clock);
  for (clock.now = 0; clock.now <= SWEEP_INVOCATION_DEADLINE_MS + 1_000; clock.now += 250) {
    const t = sweepTryTimeoutMs(b);
    assert(t <= SWEEP_TRY_CAP_MS, `a try never exceeds the cap (at ${clock.now}: ${t})`);
    if (sweepTryFits(b)) {
      assert(t >= SWEEP_MIN_TRY_MS, `a try that starts is a full minimum try (at ${clock.now}: ${t})`);
      assert(clock.now + t <= SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS, `the outcome write keeps its margin (at ${clock.now})`);
    }
  }
  clock.now = SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - SWEEP_MIN_TRY_MS + 1;
  assert(!sweepTryFits(b), 'a try that cannot be a full minimum does not start');
  assert(sweepTryFits(undefined), 'outside a sweep tick there is no budget to spend');
});

function hangingErp(onCall: (init: RequestInit | undefined) => void): typeof fetch {
  return (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = (init as RequestInit | undefined)?.signal;
    signal?.addEventListener('abort', () => reject(signal.reason));
    onCall(init as RequestInit | undefined);
  });
}

Deno.test('#2149: a slow first try leaves no second try: the retry is refused before anything is sent', async () => {
  const clock = { now: 0 };
  const org = { ...bindingOf('slow'), sweepBudget: budgetAt(clock) };
  let calls = 0;
  const f = withFetch(hangingErp((init) => {
    calls += 1;
    clock.now += ERP_REQUEST_TIMEOUT_MS; // ERPNext is silent for the client's whole attempt
  }));
  const client = { fetchImpl: orgErpFetch(org), apiKey: 'k', apiSecret: 's', baseUrl: org.siteUrl, sleep: () => Promise.resolve(), timeoutMs: 5 };
  let failure: unknown;
  try {
    await erpnextRequest(client, { method: 'GET', path: '/api/resource/Budget' });
  } catch (err) {
    failure = err;
  } finally {
    f.restore();
  }
  assert(calls === 1, `only the first try reached ERPNext; got ${calls}`);
  assert((failure as { code?: string } | undefined)?.code === 'external-unreachable', `the caller sees a retryable failure: ${String(failure)}`);
  assert(org.erpUnanswered === true, 'the silent first try still marks the organisation');
});

Deno.test('#2149: a try that does not fit is refused before sending, and our own stop is not ERPNext silence', async () => {
  const clock = { now: SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - SWEEP_MIN_TRY_MS + 1 };
  const org = { ...bindingOf('late'), sweepBudget: budgetAt(clock) };
  let calls = 0;
  const f = withFetch(() => { calls += 1; return Promise.resolve(new Response('{}')); });
  let failure: unknown;
  try {
    await orgErpFetch(org)('https://erp.example.test/api/resource/X', { method: 'POST' });
  } catch (err) {
    failure = err;
  } finally {
    f.restore();
  }
  assert(calls === 0, 'nothing is sent');
  assert(failure instanceof SweepDeadlineError && failure.message.startsWith('sweep-deadline'), `refused with the budget's own error: ${String(failure)}`);
  assert(org.erpUnanswered === undefined, 'the organisation is not marked silent');
});

Deno.test('#2149: a try with less than the cap left is cut at time left minus the margin, body read included; the cut is our stop', async () => {
  const clock = { now: SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - 30_000 };
  const timers: Array<{ ms: number; fire: () => void; cancelled: boolean }> = [];
  const org = { ...bindingOf('cut'), sweepBudget: budgetAt(clock, timers) };
  const f = withFetch((_input, init) => {
    const signal = (init as RequestInit).signal!;
    return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode('{"data":')); },
      pull: () => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    }), { status: 200 }));
  });
  let failure: unknown;
  try {
    const res = await orgErpFetch(org)('https://erp.example.test/api/resource/X');
    assert(timers.length === 1 && timers[0]!.ms === 30_000, `the try gets the time left minus the margin: ${JSON.stringify(timers.map((t) => t.ms))}`);
    const reading = res.text();
    timers[0]!.fire();
    await reading;
  } catch (err) {
    failure = err;
  } finally {
    f.restore();
  }
  assert(failure instanceof SweepDeadlineError, `the body read is cut by the budget: ${String(failure)}`);
  assert(org.erpUnanswered === undefined, 'a cut the budget made does not mark the organisation silent');
});

Deno.test('#2149: a try with the full cap left arms no budget timer; a completed answer clears any timer it armed', async () => {
  const clock = { now: 0 };
  const timers: Array<{ ms: number; fire: () => void; cancelled: boolean }> = [];
  const org = { ...bindingOf('ok'), sweepBudget: budgetAt(clock, timers) };
  const f = withFetch(() => Promise.resolve(new Response('{"data":[]}', { status: 200 })));
  try {
    await (await orgErpFetch(org)('https://erp.example.test/x')).text();
    assert(timers.length === 0, 'the client\'s own per-attempt deadline is the whole bound');
    clock.now = SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - 40_000;
    assert((await (await orgErpFetch(org)('https://erp.example.test/x')).text()) === '{"data":[]}', 'the answer passes through');
    assert(timers.length === 1 && timers[0]!.ms === 40_000 && timers[0]!.cancelled, 'the timer is cleared once the body is read');
    const failing = withFetch(() => Promise.reject(new TypeError('error sending request')));
    try {
      await orgErpFetch(org)('https://erp.example.test/x').catch(() => undefined);
    } finally {
      failing.restore();
    }
    assert(timers.length === 2 && timers[1]!.cancelled, 'the timer is cleared when the request fails');
  } finally {
    f.restore();
  }
});

// ── a batch is resumed, not re-stamped: each row is stamped when its turn comes ──────────────────

function fairQueue(ids: string[]) {
  const stampedAt = new Map<string, number>();
  let tick = 0;
  return {
    stampedAt,
    nextTick: () => { tick += 1; },
    list: () => [...ids].sort((a, b) => (stampedAt.get(a) ?? -1) - (stampedAt.get(b) ?? -1) || a.localeCompare(b)),
    stamp: (stamped: string[]) => { for (const id of stamped) stampedAt.set(id, tick); },
  };
}

Deno.test('#2149: each backstop stamps a row only when it starts it; a stopped batch leaves the rest unstamped and the next tick resumes from them', async () => {
  const runs: Array<[string, (q: ReturnType<typeof fairQueue>, stopAfterFirst: () => boolean, done: string[]) => Promise<unknown>]> = [
    ['budget', (q, stop, done) => reconcileOrgBudgetPushes({
      listPendingBudgetPushes: () => Promise.resolve(q.list().map((id) => ({ id, budget_version_id: id, push_state: 'pending' }))),
      readBudgetVersion: (id) => Promise.resolve({ id, status: 'Active', activated_at: '2026-01-01T00:00:00Z' }),
      driveBudgetPush: (row) => { done.push(row.budget_version_id); return Promise.resolve(); },
      markAttempted: (_o, rows) => { q.stamp(rows.map((r) => String(r.id))); return Promise.resolve(); },
      stopNewRows: stop,
    }, { orgId: 'org-1' })],
    ['timesheet', (q, stop, done) => reconcileOrgTimesheetPushes({
      listPendingTimesheetPushes: () => Promise.resolve(q.list().map((id) => ({ timesheet_id: id, push_state: 'pending' }) as never)),
      assertApprovedForPush: () => Promise.resolve({ ok: true, approvedAt: '2026-01-01T00:00:00Z' }),
      recordGateRefusal: () => Promise.resolve(),
      driveTimesheetPush: (row) => { done.push(row.timesheet_id); return Promise.resolve(); },
      markAttempted: (_o, rows) => { q.stamp(rows.map((r) => r.timesheet_id)); return Promise.resolve(); },
      stopNewRows: stop,
    }, { orgId: 'org-1' })],
    ['expense / site float', (q, stop, done) => reconcileOrgExpensePostings({
      listStranded: () => Promise.resolve([]),
      listPending: () => Promise.resolve(q.list().map((id) => ({ id }))),
      markAttempted: (_o: string, ids: string[]) => { q.stamp(ids); return Promise.resolve(); },
      findOutbox: () => Promise.resolve(null),
      replay: () => Promise.resolve('completed' as never),
      assertGate: () => Promise.resolve({ ok: true, truth: {} } as never),
      resolve: () => Promise.resolve({ outcome: 'ready', refs: {} } as never),
      recordOutcome: () => Promise.resolve(),
      driveFresh: (row: { id: string }) => { done.push(row.id); return Promise.resolve(); },
      stopNewRows: stop,
    } as unknown as ExpenseBackstopDeps<{ id: string }, unknown, unknown>, { orgId: 'org-1' })],
    ['budget archive', (q, stop, done) => reconcileOrgBudgetArchiveCancellations({
      listPending: () => Promise.resolve(q.list().map((id) => ({ id, activated_at_witness: 'w' })) as never),
      readLifecycle: () => Promise.resolve({ status: 'Archived', activatedAt: 'w', activeSuccessorUsesTarget: false }),
      targetIsStillLiveAndOwned: () => Promise.resolve(true),
      driveCancellation: (job) => { done.push(job.id); return Promise.resolve(true); },
      markComplete: () => Promise.resolve(),
      markSuperseded: () => Promise.resolve(),
      markHeld: () => Promise.resolve(),
      noteRetry: () => Promise.resolve(),
      markAttempted: (_o, jobs) => { q.stamp(jobs.map((j) => j.id)); return Promise.resolve(); },
      stopNewRows: stop,
    }, 'org-1')],
  ];
  for (const [name, run] of runs) {
    const q = fairQueue(['r1', 'r2', 'r3']);
    const done: string[] = [];
    const stamps: string[] = [];
    const originalStamp = q.stamp;
    q.stamp = (ids) => { stamps.push(`${ids.join('+')}@${done.length}`); originalStamp(ids); };
    // tick 1: the deadline hits after the first row
    await run(q, () => done.length >= 1, done);
    assert(done.join() === 'r1', `${name}: one row runs before the stop: ${done.join()}`);
    assert(stamps.join() === 'r1@0', `${name}: only the started row is stamped, before it runs: ${stamps.join()}`);
    assert(!q.stampedAt.has('r2') && !q.stampedAt.has('r3'), `${name}: rows the tick never reached keep their place`);
    // tick 2: resumed from the first untried row, not re-stamped from the top
    q.nextTick();
    await run(q, () => false, done);
    assert(done.join() === 'r1,r2,r3,r1', `${name}: the next tick resumes at r2: ${done.join()}`);
  }
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

Deno.test('#2149: a body the caller cancels while a read is pending clears the timer once and is not counted as no answer', async () => {
  const clock = { now: SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - 40_000 };
  const timers: Array<{ ms: number; fire: () => void; cancelled: boolean }> = [];
  const org = { ...bindingOf('cancel'), sweepBudget: budgetAt(clock, timers) };
  let release: (() => void) | undefined;
  const f = withFetch(() => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode('{"data":')); },
    // The next chunk arrives only after the caller has cancelled (an over-cap body is cancelled mid-stream).
    pull: (c) => new Promise<void>((resolve) => { release = () => { try { c.close(); } catch { /* already cancelled */ } resolve(); }; }),
  }), { status: 200 })));
  try {
    const res = await orgErpFetch(org)('https://erp.example.test/x');
    const reader = res.body!.getReader();
    await reader.read();
    const pending = reader.read();
    await new Promise((r) => setTimeout(r, 0));
    await reader.cancel('over the byte cap');
    release?.();
    await pending.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    f.restore();
  }
  assert(timers.length === 1 && timers[0]!.cancelled, 'the timer is cleared on cancel');
  assert(org.erpUnanswered === undefined, 'a body the caller cancelled is an answer, not silence');
});

Deno.test('#2149: a redirect (never read by the client) clears its timer at once', async () => {
  const clock = { now: SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - 40_000 };
  const timers: Array<{ ms: number; fire: () => void; cancelled: boolean }> = [];
  const org = { ...bindingOf('redirect'), sweepBudget: budgetAt(clock, timers) };
  const f = withFetch(() => Promise.resolve(new Response('moved', { status: 302, headers: { Location: 'https://elsewhere.test/' } })));
  try {
    const res = await orgErpFetch(org)('https://erp.example.test/x');
    assert(res.status === 302, 'the redirect passes through for the client to refuse');
  } finally {
    f.restore();
  }
  assert(timers.length === 1 && timers[0]!.cancelled, 'no timer is left armed for a body nobody reads');
});

Deno.test('#2149: a client retry wait that would leave no full try is skipped, so waits never carry tries past the budget', async () => {
  const clock = { now: SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - 25_000 }; // one try fits, not after 15 s
  const waited: number[] = [];
  const org = {
    ...bindingOf('busy'),
    sweepBudget: { ...budgetAt(clock), sleep: (ms: number) => { waited.push(ms); clock.now += ms; return Promise.resolve(); } },
  };
  let calls = 0;
  const f = withFetch(() => { calls += 1; return Promise.resolve(new Response('busy', { status: 503, headers: { 'Retry-After': '15' } })); });
  let failure: unknown;
  try {
    const client = await erpClientForBinding(null as unknown as SupabaseClient, org, new Map([[org.orgId, Promise.resolve({ apiKey: 'k', apiSecret: 's' })]]) as never);
    await erpnextRequest(client, { method: 'GET', path: '/api/resource/Budget' });
  } catch (err) {
    failure = err;
  } finally {
    f.restore();
  }
  assert(calls === 1, `the busy answer is not retried once no try would fit after the wait (the retry is refused unsent): ${calls}`);
  assert(waited.length === 0, `no wait is spent: ${waited.join()}`);
  assert((failure as { code?: string } | undefined)?.code === 'external-unreachable', `a retryable failure: ${String(failure)}`);
  // With time for a try after the wait, the client waits and retries as before.
  clock.now = 0;
  await orgErpTransport(org).sleep(1_500);
  assert(waited.join() === '1500', `a wait that leaves a full try is kept: ${waited.join()}`);
});

Deno.test('#2149: a write that records a "started" stage first may start only while a full try still fits after that stage write', () => {
  const clock = { now: 0 };
  const org = { ...bindingOf('stage'), sweepBudget: budgetAt(clock) };
  const lastTryStart = SWEEP_INVOCATION_DEADLINE_MS - SWEEP_OUTCOME_WRITE_MARGIN_MS - SWEEP_MIN_TRY_MS;
  const t = orgErpTransport(org);
  assert(t.writeMayStart(), 'with time left the write may start');
  clock.now = lastTryStart - SWEEP_STAGE_WRITE_ALLOWANCE_MS;
  assert(t.writeMayStart(), 'exactly enough for the stage write and a full try');
  clock.now += 1;
  assert(!t.writeMayStart(), 'not when the try after the stage write would be refused');
  assert(orgErpTransport(bindingOf('no-budget')).writeMayStart(), 'outside a sweep tick nothing is withheld');
});

Deno.test('#2149: a money-only tick whose ERPNext did not answer records no failed run and defers nothing', async () => {
  const h = cycleHarness([{ ...bindingOf('silent'), lastFullSweepAt: new Date().toISOString(), fullSweepFailures: 3 }], 'silent', {
    isFullSweepDue: () => false,
  });
  const r = await runErpSweepCycle(h.deps, undefined, 'money-only');
  assert(r.perOrg[0]!.cadence === 'money-only', `the tick ran money-only: ${r.perOrg[0]!.cadence}`);
  assert(r.perOrg[0]!.errors.some((e) => e.startsWith('erp-unanswered')), `the stop is still reported: ${JSON.stringify(r.perOrg[0]!.errors)}`);
  assert(h.settled.length === 0, `a money-only tick settles no full run: ${h.settled.join()} (delays ${h.delays.join()})`);
});

Deno.test('#2149: after a silent spell on money-only ticks, the next hourly pass runs at its normal time once ERPNext answers again', async () => {
  // The stored full-run marker, as `defer_erp_full_sweep` / `mark_erp_full_sweep_done` (0918) write it.
  const t0 = Date.parse('2026-11-16T10:00:00Z');
  let stored = { at: new Date(t0).toISOString(), failures: 0 };
  const hourlyRanAt: number[] = [];
  const tick = async (wallMs: number, silent: boolean) => {
    const org = { ...bindingOf('a'), lastFullSweepAt: stored.at, fullSweepFailures: stored.failures };
    const h = cycleHarness([org], silent ? 'a' : null, {
      isFullSweepDue: (o: OrgBinding) => fullSweepDue(o.lastFullSweepAt, wallMs),
      sweepOrgDoctypes: () => { hourlyRanAt.push(wallMs); return Promise.resolve({ applied: 0, complete: true }); },
      deferFullSweep: (_o: OrgBinding, dueInSeconds: number) => {
        stored = { at: new Date(wallMs - SWEEP_FULL_INTERVAL_MS + dueInSeconds * 1000).toISOString(), failures: stored.failures + (dueInSeconds > 0 ? 1 : 0) };
        return Promise.resolve();
      },
      markFullSweepDone: () => { stored = { at: new Date(wallMs).toISOString(), failures: 0 }; return Promise.resolve(); },
    });
    await runErpSweepCycle(h.deps, undefined, 'money-only');
  };
  const MIN = 60_000;
  for (let m = 40; m <= 50; m++) await tick(t0 + m * MIN, true); // ERPNext silent for ten minutes, hourly work not yet due
  for (let m = 51; m <= 60; m++) await tick(t0 + m * MIN, false); // ERPNext answers again
  assert(hourlyRanAt.length > 0 && hourlyRanAt[0] === t0 + SWEEP_FULL_INTERVAL_MS,
    `the hourly pass runs at its normal time, 55 min after the last completed run: ${hourlyRanAt.map((ms) => (ms - t0) / MIN).join()} (stored ${JSON.stringify(stored)})`);
});
