// AC-ENA-CAD-008 (THEME-BACK-07): a full (hourly) run is stamped complete only when its passes finished.
// A truncated walk is continued on the next tick, a failed pass is retried after a short delay, and a
// slow org cannot stop later orgs' money passes. Drives the shipped cycle with recording deps.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle } = await import('./index.ts');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const org = (orgId: string, lastFullSweepAt: string | null = null) => ({
  orgId, siteUrl: 'https://erp.example.test', secretRef: 'synthetic-test-ref', company: 'Synthetic Co',
  config: {}, ownedDomains: ['revenue'], versionMajor: 16, lastFullSweepAt,
});

type Overrides = Partial<Parameters<typeof runErpSweepCycle>[0]>;

function harness(orgs: ReturnType<typeof org>[], overrides: Overrides = {}) {
  const log: string[] = [];
  const marks: string[] = [];
  const defers: Array<{ orgId: string; dueInSeconds: number }> = [];
  const deps = {
    listEmployingOrgs: () => Promise.resolve(orgs),
    reconcileOrgOutbox: (o: { orgId: string }) => { log.push(`reconcile:${o.orgId}`); return Promise.resolve({ reconciled: 0, errors: [] }); },
    sweepOrgDoctypes: (o: { orgId: string }) => { log.push(`sweep:${o.orgId}`); return Promise.resolve({ applied: 0, complete: true }); },
    repairOrgLinks: () => Promise.resolve({ repaired: 0 }),
    feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }),
    feedOrgPurchases: () => Promise.resolve({ fed: 0 }),
    refreshOrgAccounting: () => Promise.resolve({}),
    reconcileOrgBudgetPushes: (o: { orgId: string }) => { log.push(`budget:${o.orgId}`); return Promise.resolve({ driven: 0 }); },
    markFullSweepDone: (o: { orgId: string }) => { marks.push(o.orgId); return Promise.resolve(); },
    deferFullSweep: (o: { orgId: string }, dueInSeconds: number) => { defers.push({ orgId: o.orgId, dueInSeconds }); return Promise.resolve(); },
    ...overrides,
  };
  return { deps: deps as unknown as Parameters<typeof runErpSweepCycle>[0], log, marks, defers };
}

Deno.test('AC-ENA-CAD-008: a clean full run is stamped complete and never deferred', async () => {
  const h = harness([org('a')]);
  await runErpSweepCycle(h.deps);
  assert(h.marks.join() === 'a' && h.defers.length === 0, `clean run: marks=${h.marks} defers=${JSON.stringify(h.defers)}`);
});

Deno.test('AC-ENA-CAD-008: a truncated doctype walk is not stamped; the org is due again on the next tick', async () => {
  const h = harness([org('a')], { sweepOrgDoctypes: () => Promise.resolve({ applied: 3, complete: false }) });
  const r = await runErpSweepCycle(h.deps);
  assert(h.marks.length === 0, 'a truncated walk must not be stamped complete');
  assert(h.defers.length === 1 && h.defers[0]!.dueInSeconds === 0, `truncation defers with no delay: ${JSON.stringify(h.defers)}`);
  assert(r.perOrg[0]!.errors.length === 0, 'truncation is normal operation, not an error');
});

Deno.test('AC-ENA-CAD-008: an incomplete ledger catch-up is deferred without delay', async () => {
  const h = harness([org('a')], { feedOrgLedgers: () => Promise.resolve({ gl: 5, ple: 0, glCaughtUp: false, pleCaughtUp: true }) });
  await runErpSweepCycle(h.deps);
  assert(h.marks.length === 0 && h.defers[0]?.dueInSeconds === 0, `ledger backlog: marks=${h.marks} defers=${JSON.stringify(h.defers)}`);
});

Deno.test('AC-ENA-CAD-008: a failed hourly pass is retried after a short delay, not an hour later', async () => {
  for (const [name, patch] of [
    ['sweep', { sweepOrgDoctypes: () => Promise.resolve({ applied: 0, error: 'x: sweep failed' }) }],
    ['ledger', { feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true, error: 'x' }) }],
    ['purchases', { feedOrgPurchases: () => Promise.resolve({ fed: 0, error: 'x' }) }],
    ['accounting', { refreshOrgAccounting: () => Promise.resolve({ error: 'x' }) }],
    ['thrown', { sweepOrgDoctypes: () => Promise.reject(new Error('boom')) }],
  ] as Array<[string, Overrides]>) {
    const h = harness([org('a')], patch);
    await runErpSweepCycle(h.deps);
    assert(h.marks.length === 0, `${name}: failed run stamped complete`);
    assert(h.defers.length === 1 && h.defers[0]!.dueInSeconds === 300, `${name}: expected a 5-minute retry, got ${JSON.stringify(h.defers)}`);
  }
});

Deno.test('AC-ENA-CAD-008: statement-side errors retry on their own cadence and do not hold the hourly marker back', async () => {
  const h = harness([org('a')], {
    refreshNativeStatements: () => Promise.resolve({ errorCode: 'not-ready' }),
    feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true, statementError: 'pending' }),
  });
  await runErpSweepCycle(h.deps);
  assert(h.marks.join() === 'a' && h.defers.length === 0, `statement errors: marks=${h.marks} defers=${JSON.stringify(h.defers)}`);
});

Deno.test('AC-ENA-CAD-009: a slow first org cannot stop the second org money passes; its hourly work waits for the next tick', async () => {
  let clock = 0;
  const h = harness([org('slow'), org('next')], {
    nowMs: () => clock,
    hourlyDeadlineAtMs: 1_000,
    sweepOrgDoctypes: (o: { orgId: string }) => { clock += 5_000; return Promise.resolve({ applied: 0, complete: true }); },
  } as Overrides);
  const r = await runErpSweepCycle(h.deps);
  assert(h.log.includes('reconcile:next') && h.log.includes('budget:next'), `second org money passes must run: ${JSON.stringify(h.log)}`);
  assert(!h.log.includes('sweep:next'), 'second org hourly sweep must not start past the deadline');
  assert(!h.defers.some((d) => d.orgId === 'next'), `a run that never started keeps its wait marker: ${JSON.stringify(h.defers)}`);
  assert(!h.marks.includes('next'), 'a skipped hourly run must not be stamped');
  assert(r.orgs === 2, 'both orgs reported');
});

Deno.test('AC-ENA-CAD-009: the org starved longest runs its hourly work first', async () => {
  const h = harness([org('fresh', '2026-11-01T00:00:00Z'), org('starved', '2026-10-30T00:00:00Z'), org('never', null)]);
  await runErpSweepCycle(h.deps);
  const order = h.log.filter((l) => l.startsWith('reconcile:')).map((l) => l.slice(10)).join();
  assert(order === 'never,starved,fresh', `expected never-run, then oldest first, got ${order}`);
});

Deno.test('AC-ENA-CAD-008: a money-pass error does not turn a clean hourly run into a retry', async () => {
  const h = harness([org('a')], { reconcileOrgBudgetPushes: () => Promise.resolve({ driven: 0, error: 'refused' }) });
  await runErpSweepCycle(h.deps);
  assert(h.marks.join() === 'a' && h.defers.length === 0, `marks=${h.marks} defers=${JSON.stringify(h.defers)}`);
});

Deno.test('AC-ENA-CAD-008: an incomplete doctype walk still feeds the ledger and later passes; the run is deferred with no delay', async () => {
  const called: string[] = [];
  const h = harness([org('a')], {
    sweepOrgDoctypes: () => Promise.resolve({ applied: 3, complete: false }),
    repairOrgLinks: () => { called.push('repair'); return Promise.resolve({ repaired: 0 }); },
    feedOrgLedgers: () => { called.push('ledger'); return Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }); },
    feedOrgPurchases: () => { called.push('purchases'); return Promise.resolve({ fed: 0 }); },
    refreshOrgAccounting: () => { called.push('accounting'); return Promise.resolve({}); },
  });
  await runErpSweepCycle(h.deps);
  assert(called.join() === 'repair,ledger,purchases,accounting', `later passes must run: ${called}`);
  assert(h.marks.length === 0 && h.defers.length === 1 && h.defers[0]!.dueInSeconds === 0, `deferred, not stamped: ${JSON.stringify(h.defers)}`);
});

Deno.test('AC-ENA-CAD-009: across ticks a slow first org cannot starve the next org hourly work', async () => {
  let clock = Date.parse('2026-11-01T00:00:00Z');
  const markers = new Map<string, string | null>([['A', null], ['B', null]]);
  const ran: string[] = [];
  for (let tick = 0; tick < 3; tick++) {
    const orgs = ['A', 'B'].map((id) => org(id, markers.get(id)!));
    const h = harness(orgs, {
      nowMs: () => clock,
      hourlyDeadlineAtMs: clock + 1_000,
      sweepOrgDoctypes: (o: { orgId: string }) => { ran.push(`${tick}:${o.orgId}`); clock += 5_000; return Promise.resolve({ applied: 0, complete: false }); },
      deferFullSweep: (o: { orgId: string }) => { markers.set(o.orgId, new Date(clock - 55 * 60_000).toISOString()); return Promise.resolve(); },
    } as Overrides);
    await runErpSweepCycle(h.deps);
    clock += 5 * 60_000;
  }
  assert(ran.includes('1:B') || ran.includes('2:B'), `org B starved across ticks: ${JSON.stringify(ran)}`);
  assert(ran.some((r) => r.endsWith(':A')), `org A made progress: ${JSON.stringify(ran)}`);
});
