// AC-ENA-CAD-002 (owner ruling 2026-10-23): money postings reach ERPNext on EVERY tick. Between the
// hourly windows the shipped cycle runs only the outbound money passes — (1) outbox recovery,
// (5) budget, (6) timesheets, (7) expenses — and none of the inbound/statement work.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle, sweepCadenceAt, fullSweepDue, SWEEP_FULL_INTERVAL_MS } = await import('./index.ts');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const org = (orgId: string) => ({
  orgId, siteUrl: 'https://erp.example.test', secretRef: 'synthetic-test-ref', company: 'Synthetic Co',
  config: {}, ownedDomains: ['revenue', 'timesheets', 'expenses'], versionMajor: 16,
});

const MONEY_PASSES = ['reconcile', 'budget', 'timesheet', 'expenses'];
const HOURLY_PASSES = ['sweep', 'repair', 'native-statement', 'ledger', 'purchases', 'accounting'];

function recordingDeps(visited: string[], held = new Set<string>()) {
  return {
    listEmployingOrgs: () => Promise.resolve([org('org-a')]),
    claimStatementLock: (orgId: string) => Promise.resolve(held.has(orgId) ? false : (held.add(orgId), true)),
    releaseStatementLock: (orgId: string) => { held.delete(orgId); return Promise.resolve(); },
    reconcileOrgOutbox: () => { visited.push('reconcile'); return Promise.resolve({ reconciled: 0, errors: [] }); },
    sweepOrgDoctypes: () => { visited.push('sweep'); return Promise.resolve({ applied: 0 }); },
    repairOrgLinks: () => { visited.push('repair'); return Promise.resolve({ repaired: 0 }); },
    refreshNativeStatements: () => { visited.push('native-statement'); return Promise.resolve({}); },
    feedOrgLedgers: () => { visited.push('ledger'); return Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }); },
    feedOrgPurchases: () => { visited.push('purchases'); return Promise.resolve({ fed: 0 }); },
    refreshOrgAccounting: () => { visited.push('accounting'); return Promise.resolve({}); },
    reconcileOrgBudgetPushes: () => { visited.push('budget'); return Promise.resolve({ driven: 0 }); },
    reconcileOrgTimesheetPushes: () => { visited.push('timesheet'); return Promise.resolve({ driven: 0 }); },
    reconcileOrgExpensePostings: () => { visited.push('expenses'); return Promise.resolve({ driven: 0 }); },
  };
}

Deno.test('AC-ENA-CAD-002: a money-only tick runs every outbound money pass and no hourly pass', async () => {
  const visited: string[] = [];
  const result = await runErpSweepCycle(recordingDeps(visited), undefined, 'money-only');
  assert(JSON.stringify(visited) === JSON.stringify(MONEY_PASSES),
    `money-only must run exactly the money passes in order, got ${JSON.stringify(visited)}`);
  assert(result.orgs === 1 && result.perOrg[0]?.errors.length === 0,
    `money-only tick must report the org without errors: ${JSON.stringify(result)}`);
  assert(result.perOrg[0]?.ledger === undefined && result.perOrg[0]?.sweep === undefined,
    'money-only must not report inbound results it did not produce');
});

Deno.test('AC-ENA-CAD-002: a full tick (the default) still runs the hourly passes and the money passes', async () => {
  const visited: string[] = [];
  await runErpSweepCycle(recordingDeps(visited));
  for (const pass of [...MONEY_PASSES, ...HOURLY_PASSES]) {
    assert(visited.includes(pass), `full cadence skipped ${pass}: ${JSON.stringify(visited)}`);
  }
});

Deno.test('AC-ENA-CAD-003: a money-only tick still takes the per-org sweep lock — an overlapping tick posts nothing for that org', async () => {
  const visited: string[] = [];
  const result = await runErpSweepCycle(recordingDeps(visited, new Set(['org-a'])), undefined, 'money-only');
  assert(visited.length === 0, `a held org must not run money passes concurrently: ${JSON.stringify(visited)}`);
  assert(result.perOrg[0]?.errors.includes('statement-lock-held') === true,
    `the overlap skip must be reported, got ${JSON.stringify(result.perOrg)}`);
});

Deno.test('AC-ENA-CAD-003: a money-only tick releases the org lock even when a money pass throws', async () => {
  const visited: string[] = [];
  const held = new Set<string>();
  const deps = { ...recordingDeps(visited, held), reconcileOrgBudgetPushes: () => Promise.reject(new Error('synthetic budget failure')) };
  const result = await runErpSweepCycle(deps, undefined, 'money-only');
  assert(held.size === 0, 'the lock must be released after a money-only tick');
  assert(result.perOrg[0]?.errors.includes('budget:synthetic budget failure') === true,
    `the failing pass must be reported, got ${JSON.stringify(result.perOrg)}`);
  assert(visited.includes('timesheet') && visited.includes('expenses'), 'one failing money pass must not stop the others');
});

Deno.test('AC-ENA-CAD-001: the tick forces the full sweep only for a backfilling binding on a five-minute tick; otherwise each org decides', async () => {
  let reads = 0;
  const published = (value: boolean) => () => { reads += 1; return Promise.resolve(value); };
  const at = (iso: string) => Date.parse(iso);
  const cases: Array<[string, boolean, string, number]> = [
    ['2026-10-23T07:00:00.000Z', true, 'money-only', 1],
    ['2026-10-23T07:00:00.000Z', false, 'full', 1],
    ['2026-10-23T07:01:00.000Z', true, 'money-only', 0],
    ['2026-10-23T07:02:00.000Z', true, 'money-only', 0],
    ['2026-10-23T07:07:00.000Z', true, 'money-only', 0],
    ['2026-10-23T07:35:00.000Z', true, 'money-only', 1],
    ['2026-10-23T07:35:00.000Z', false, 'full', 1],
    ['2026-10-23T07:37:00.000Z', false, 'money-only', 0],
  ];
  for (const [iso, allPublished, expected, expectedReads] of cases) {
    reads = 0;
    const cadence = await sweepCadenceAt(at(iso), published(allPublished));
    assert(cadence === expected, `${iso} (allPublished=${allPublished}) → ${cadence}, expected ${expected}`);
    assert(reads === expectedReads, `${iso}: readiness read ${reads} times, expected ${expectedReads}`);
  }
});

Deno.test('AC-ENA-CAD-006: an org whose last full run is older than 55 minutes (or unknown) is due', () => {
  const now = Date.parse('2026-10-23T07:03:00.000Z');
  assert(SWEEP_FULL_INTERVAL_MS === 55 * 60_000, `unexpected full-run interval ${SWEEP_FULL_INTERVAL_MS}`);
  assert(fullSweepDue(null, now) && fullSweepDue(undefined, now) && fullSweepDue('not-a-date', now), 'an unknown last run must be due');
  assert(fullSweepDue(new Date(now - SWEEP_FULL_INTERVAL_MS).toISOString(), now), 'exactly 55 minutes is due');
  assert(!fullSweepDue(new Date(now - SWEEP_FULL_INTERVAL_MS + 1).toISOString(), now), 'under 55 minutes is not due');
});

Deno.test('AC-ENA-CAD-006: on a money-only tick an org due for its full run runs everything and stamps it; an org not due runs money only', async () => {
  const visited: string[] = [];
  const stamped: string[] = [];
  const base = recordingDeps(visited);
  const result = await runErpSweepCycle({
    ...base,
    listEmployingOrgs: () => Promise.resolve([org('org-due'), org('org-fresh')]),
    isFullSweepDue: (o) => o.orgId === 'org-due',
    markFullSweepDone: (o) => { stamped.push(o.orgId); return Promise.resolve(); },
  }, undefined, 'money-only');
  assert(JSON.stringify(result.perOrg.map((p) => [p.orgId, p.cadence])) === JSON.stringify([['org-due', 'full'], ['org-fresh', 'money-only']]),
    `per-org cadence wrong: ${JSON.stringify(result.perOrg)}`);
  assert(visited.filter((v) => v === 'ledger').length === 1, `only the due org may run the hourly work: ${JSON.stringify(visited)}`);
  assert(JSON.stringify(stamped) === JSON.stringify(['org-due']), `only a completed full run is stamped: ${JSON.stringify(stamped)}`);
});

Deno.test('AC-ENA-CAD-006: a missed full run (lock held at the top of the hour) runs on the next tick that gets the lock', async () => {
  const visited: string[] = [];
  const stamped: string[] = [];
  let lastFull: string | null = '2026-10-23T06:00:00.000Z';
  const now = Date.parse('2026-10-23T07:00:00.000Z');
  const held = new Set<string>(['org-a']);
  const deps = {
    ...recordingDeps(visited, held),
    isFullSweepDue: () => fullSweepDue(lastFull, now),
    markFullSweepDone: (o: { orgId: string }) => { stamped.push(o.orgId); lastFull = new Date(now).toISOString(); return Promise.resolve(); },
  };
  const missed = await runErpSweepCycle(deps, undefined, 'money-only');
  assert(missed.perOrg[0]?.errors.includes('statement-lock-held') === true && visited.length === 0 && stamped.length === 0,
    `the overlapped tick must do nothing and stamp nothing: ${JSON.stringify(missed.perOrg)} ${JSON.stringify(visited)}`);
  held.clear();
  const next = await runErpSweepCycle(deps, undefined, 'money-only');
  assert(next.perOrg[0]?.cadence === 'full' && visited.includes('ledger') && JSON.stringify(stamped) === JSON.stringify(['org-a']),
    `the next tick that got the lock did not run the missed full sweep: ${JSON.stringify(next.perOrg)} ${JSON.stringify(visited)}`);
  visited.length = 0;
  const after = await runErpSweepCycle(deps, undefined, 'money-only');
  assert(after.perOrg[0]?.cadence === 'money-only' && !visited.includes('ledger'), 'once stamped, the org is not due again within the hour');
});

Deno.test('AC-ENA-CAD-006: a forced full tick stamps every org it ran in full; a money-only org is never stamped', async () => {
  const stamped: string[] = [];
  const visited: string[] = [];
  await runErpSweepCycle({ ...recordingDeps(visited), isFullSweepDue: () => false,
    markFullSweepDone: (o) => { stamped.push(o.orgId); return Promise.resolve(); } }, undefined, 'full');
  assert(JSON.stringify(stamped) === JSON.stringify(['org-a']), `forced full run not stamped: ${JSON.stringify(stamped)}`);
  stamped.length = 0;
  await runErpSweepCycle({ ...recordingDeps(visited), isFullSweepDue: () => false,
    markFullSweepDone: (o) => { stamped.push(o.orgId); return Promise.resolve(); } }, undefined, 'money-only');
  assert(stamped.length === 0, 'a money-only run must not stamp a full run');
});

Deno.test('AC-ENA-CAD-004: a full tick runs the money backstops BEFORE the hourly block, so an isolate death in the hourly block never starves money postings', async () => {
  const visited: string[] = [];
  const deps = {
    ...recordingDeps(visited),
    // Simulates the hourly block dying (CPU-limit kill): its first step fails and records the call first.
    sweepOrgDoctypes: () => { visited.push('sweep'); return Promise.reject(new Error('synthetic isolate death')); },
  };
  await runErpSweepCycle(deps, undefined, 'full');
  const sweepAt = visited.indexOf('sweep');
  assert(sweepAt >= 0, `the hourly block must still run: ${JSON.stringify(visited)}`);
  for (const pass of ['reconcile', 'budget', 'timesheet', 'expenses']) {
    const at = visited.indexOf(pass);
    assert(at >= 0 && at < sweepAt, `${pass} must run before the hourly sweep, got ${JSON.stringify(visited)}`);
  }
  assert(visited[0] === 'reconcile', `outbox recovery must stay first, got ${JSON.stringify(visited)}`);
});
