// AC-ENA-CAD-002 (owner ruling 2026-10-23): money postings reach ERPNext on EVERY tick. Between the
// hourly windows the shipped cycle runs only the outbound money passes — (1) outbox recovery,
// (5) budget, (6) timesheets, (7) expenses — and none of the inbound/statement work.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle, sweepCadenceAt } = await import('./index.ts');

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

Deno.test('AC-ENA-CAD-001: the hourly work runs once an hour; backfill keeps five-minute full ticks; every other tick is money-only', async () => {
  let reads = 0;
  const published = (value: boolean) => () => { reads += 1; return Promise.resolve(value); };
  const at = (iso: string) => Date.parse(iso);
  const cases: Array<[string, boolean, string, number]> = [
    ['2026-10-23T07:00:00.000Z', true, 'full', 0],
    ['2026-10-23T07:00:59.999Z', true, 'full', 0],
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
