// AC-ENA-CAD-010 (#1642): a repeatedly failing hourly run backs off 5, 10, 20, 40 min, then the hourly
// interval, instead of re-running the whole hourly workload every five minutes. A completed run resets
// the count (in the same SQL statement as its stamp: pgTAP 1642_sweep_failure_backoff). Drives the shipped
// cycle with recording deps, like fullSweepCompletion.test.ts.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle } = await import('./index.ts');
const { sweepRetryDelaySeconds, SWEEP_FULL_INTERVAL_MS, SWEEP_RETRY_DELAY_SECONDS, STATEMENT_PASS_RETRY_DELAY_SECONDS } = await import('./sweepCadence.ts');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const org = (fullSweepFailures: number | undefined) => ({
  orgId: 'a', siteUrl: 'https://erp.example.test', secretRef: 'synthetic-test-ref', company: 'Synthetic Co',
  config: {}, ownedDomains: ['revenue'], versionMajor: 16, lastFullSweepAt: null, fullSweepFailures,
});

function harness(fullSweepFailures: number | undefined, overrides: Record<string, unknown> = {}) {
  const defers: number[] = [];
  const statementDefers: number[] = [];
  const marks: string[] = [];
  const deps = {
    listEmployingOrgs: () => Promise.resolve([org(fullSweepFailures)]),
    reconcileOrgOutbox: () => Promise.resolve({ reconciled: 0, errors: [] }),
    sweepOrgDoctypes: () => Promise.resolve({ applied: 0, complete: true }),
    repairOrgLinks: () => Promise.resolve({ repaired: 0 }),
    feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }),
    feedOrgPurchases: () => Promise.resolve({ fed: 0 }),
    refreshOrgAccounting: () => Promise.resolve({}),
    reconcileOrgBudgetPushes: () => Promise.resolve({ driven: 0 }),
    markFullSweepDone: (o: { orgId: string }) => { marks.push(o.orgId); return Promise.resolve(); },
    deferFullSweep: (_o: unknown, s: number) => { defers.push(s); return Promise.resolve(); },
    deferStatementPass: (_o: unknown, s: number) => { statementDefers.push(s); return Promise.resolve(); },
    ...overrides,
  };
  return { deps: deps as unknown as Parameters<typeof runErpSweepCycle>[0], defers, statementDefers, marks };
}

const failing = { sweepOrgDoctypes: () => Promise.resolve({ applied: 0, error: 'x: sweep failed' }) };

Deno.test('AC-ENA-CAD-010: the retry delay doubles from 300 s and is capped at the hourly interval', () => {
  const got = [0, 1, 2, 3, 4, 5, 40].map(sweepRetryDelaySeconds);
  assert(got.join() === '300,600,1200,2400,3300,3300,3300', `delays: ${got}`);
  assert(sweepRetryDelaySeconds(0) === SWEEP_RETRY_DELAY_SECONDS, 'the first failure keeps the 5-minute retry');
  assert(sweepRetryDelaySeconds(99) === SWEEP_FULL_INTERVAL_MS / 1000, 'the cap is the hourly interval');
  assert(sweepRetryDelaySeconds(-1) === 300 && sweepRetryDelaySeconds(Number.NaN) === 300, 'a bad count falls back to the first delay');
});

Deno.test('AC-ENA-CAD-010: a failing run is deferred 300, 600, then doubling, using the stored failure count', async () => {
  const seen: number[] = [];
  for (const n of [undefined, 0, 1, 2, 3, 4, 9]) {
    const h = harness(n, failing);
    await runErpSweepCycle(h.deps);
    assert(h.marks.length === 0 && h.defers.length === 1, `failure n=${n}: marks=${h.marks} defers=${h.defers}`);
    seen.push(h.defers[0]!);
  }
  assert(seen.join() === '300,300,600,1200,2400,3300,3300', `deferrals: ${seen}`);
});

Deno.test('AC-ENA-CAD-010: a clean run after failures is stamped complete, never deferred', async () => {
  const h = harness(4);
  await runErpSweepCycle(h.deps);
  assert(h.marks.join() === 'a' && h.defers.length === 0, `clean: marks=${h.marks} defers=${h.defers}`);
});

Deno.test('AC-ENA-CAD-010: a truncated (not failed) run is still deferred with no delay, whatever the count', async () => {
  const h = harness(4, { sweepOrgDoctypes: () => Promise.resolve({ applied: 3, complete: false }) });
  await runErpSweepCycle(h.deps);
  assert(h.defers.join() === '0', `truncation: ${h.defers}`);
});

Deno.test('AC-ENA-CAD-010: the statement-pass retry delay does not follow the hourly failure count', async () => {
  const h = harness(4, { refreshNativeStatements: () => Promise.resolve({ status: 'failed' }) });
  await runErpSweepCycle(h.deps);
  assert(STATEMENT_PASS_RETRY_DELAY_SECONDS === 300, 'the statement retry stays five minutes');
  assert(h.statementDefers.length > 0 && h.statementDefers.every((s) => s === STATEMENT_PASS_RETRY_DELAY_SECONDS), `statement defers: ${h.statementDefers}`);
});
