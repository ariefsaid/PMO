// AC-005/006 support: exercise the shipped sweep cycle; lock ownership is modeled by the
// same atomic claim/release contract implemented by the database RPCs.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle, STATEMENT_SWEEP_LOCK_TTL_MS, STATEMENT_SWEEP_WALL_CLOCK_CAP_MS } = await import('./index.ts');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const org = (orgId: string) => ({
  orgId, siteUrl: 'https://erp.example.test', secretRef: 'synthetic-test-ref', company: 'Synthetic Co',
  config: {}, ownedDomains: [], versionMajor: 16,
});
const originalFetch = globalThis.fetch;
const noOpDeps = {
  reconcileOrgOutbox: () => Promise.resolve({ reconciled: 0, errors: [] }),
  sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
  feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }),
  refreshOrgAccounting: () => Promise.resolve({}),
};

Deno.test('AC-005: single-flight TTL is longer than the documented edge wall-clock cap', () => {
  assert(STATEMENT_SWEEP_LOCK_TTL_MS > STATEMENT_SWEEP_WALL_CLOCK_CAP_MS, 'lock TTL must exceed function wall-clock cap');
});

Deno.test('AC-005: overlapping ticks skip only the org whose lock is already held', async () => {
  globalThis.fetch = (() => Promise.resolve(new Response('{}'))) as typeof fetch;
  const held = new Set<string>();
  let releaseFirst!: () => void;
  const waitForRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let entered = 0;
  const deps = {
    ...noOpDeps,
    listEmployingOrgs: () => Promise.resolve([org('org-a')]),
    claimStatementLock: (orgId: string) => Promise.resolve(!held.has(orgId) && Boolean(held.add(orgId))),
    releaseStatementLock: (orgId: string) => { held.delete(orgId); return Promise.resolve(); },
    feedOrgLedgers: async () => { entered += 1; if (entered === 1) await waitForRelease; return { gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }; },
  };
  try {
    const first = runErpSweepCycle(deps);
    while (entered === 0) await Promise.resolve();
    const second = await runErpSweepCycle(deps);
    assert(second.perOrg[0]?.errors.includes('statement-lock-held'), 'a concurrent same-org tick must be skipped');
    releaseFirst();
    await first;
  } finally {
    releaseFirst();
    globalThis.fetch = originalFetch;
  }
});

Deno.test('AC-005: a held org does not prevent another org from running', async () => {
  const held = new Set(['org-a']);
  const visited: string[] = [];
  const result = await runErpSweepCycle({
    ...noOpDeps,
    listEmployingOrgs: () => Promise.resolve([org('org-a'), org('org-b')]),
    claimStatementLock: (orgId) => Promise.resolve(held.has(orgId) ? false : (held.add(orgId), true)),
    releaseStatementLock: (orgId) => { held.delete(orgId); return Promise.resolve(); },
    reconcileOrgOutbox: (o) => { visited.push(`reconcile:${o.orgId}`); return Promise.resolve({ reconciled: 0, errors: [] }); },
    sweepOrgDoctypes: (o) => { visited.push(`sweep:${o.orgId}`); return Promise.resolve({ applied: 0 }); },
    feedOrgLedgers: (o) => { visited.push(`ledger:${o.orgId}`); return Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }); },
    refreshOrgAccounting: (o) => { visited.push(`refresh:${o.orgId}`); return Promise.resolve({}); },
  });
  assert(result.perOrg[0]?.errors.includes('statement-lock-held'), 'the held org should be skipped');
  assert(visited.every((entry) => entry.endsWith('org-b')), 'the other org must continue');
});

Deno.test('AC-005: a thrown pass still releases its org lock', async () => {
  let held = false;
  await runErpSweepCycle({
    ...noOpDeps,
    listEmployingOrgs: () => Promise.resolve([org('org-a')]),
    claimStatementLock: () => { held = true; return Promise.resolve(true); },
    releaseStatementLock: () => { held = false; return Promise.resolve(); },
    feedOrgLedgers: () => Promise.reject(new Error('synthetic feed failure')),
  });
  assert(!held, 'the lock must release in finally after a pass throws');
});
