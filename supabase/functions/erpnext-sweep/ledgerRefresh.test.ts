// Ledger snapshots must not be stamped current while either bounded ledger backfill is incomplete.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle } = await import('./index.ts');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const org = {
  orgId: 'org-ledger-refresh', siteUrl: 'https://erp.example.test', secretRef: 'ledger-refresh-test',
  company: 'Example Co', config: {}, ownedDomains: ['revenue'], versionMajor: 15,
};

for (const [glCaughtUp, pleCaughtUp] of [[false, true], [true, false]] as const) {
  Deno.test(`accounting refresh is deferred when glCaughtUp=${glCaughtUp} and pleCaughtUp=${pleCaughtUp}`, async () => {
    let refreshed = 0;
    await runErpSweepCycle({
      listEmployingOrgs: async () => [org],
      reconcileOrgOutbox: async () => ({ reconciled: 0, errors: [] }),
      sweepOrgDoctypes: async () => ({ applied: 0 }),
      feedOrgLedgers: async () => ({ gl: 1, ple: 1, glCaughtUp, pleCaughtUp }),
      refreshOrgAccounting: async () => { refreshed += 1; return {}; },
    });
    assert(refreshed === 0, 'partial ledger mirrors must keep the prior accounting snapshot');
  });
}

Deno.test('accounting refresh runs when both ledger feeds caught up', async () => {
  let refreshed = 0;
  await runErpSweepCycle({
    listEmployingOrgs: async () => [org],
    reconcileOrgOutbox: async () => ({ reconciled: 0, errors: [] }),
    sweepOrgDoctypes: async () => ({ applied: 0 }),
    feedOrgLedgers: async () => ({ gl: 1, ple: 1, glCaughtUp: true, pleCaughtUp: true }),
    refreshOrgAccounting: async () => { refreshed += 1; return {}; },
  });
  assert(refreshed === 1, 'complete ledger mirrors refresh accounting');
});
