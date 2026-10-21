// FR-EPR-001: the read-only purchases pass runs after the ledger feed and never blocks the accounting refresh.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle } = await import('./index.ts');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const org = {
  orgId: 'org-purchases', siteUrl: 'https://erp.example.test', secretRef: 'purchases-test',
  company: 'Example Co', config: {}, ownedDomains: [], versionMajor: 15,
};

Deno.test('purchases pass runs after the ledger feed; its failure is recorded and accounting still refreshes', async () => {
  const order: string[] = [];
  const result = await runErpSweepCycle({
    listEmployingOrgs: () => Promise.resolve([org]),
    reconcileOrgOutbox: () => Promise.resolve({ reconciled: 0, errors: [] }),
    sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
    feedOrgLedgers: () => { order.push('ledger'); return Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }); },
    feedOrgPurchases: () => { order.push('purchases'); return Promise.reject(new Error('erp down')); },
    refreshOrgAccounting: () => { order.push('accounting'); return Promise.resolve({}); },
  });
  assert(order.join(',') === 'ledger,purchases,accounting', `order was ${order.join(',')}`);
  assert(result.perOrg[0].errors.includes('purchases:erp down'), 'purchase failure is recorded per org');
});

Deno.test('a bounded purchase pass can yield without preventing accounting refresh', async () => {
  const order: string[] = [];
  await runErpSweepCycle({
    listEmployingOrgs: () => Promise.resolve([org]),
    reconcileOrgOutbox: () => Promise.resolve({ reconciled: 0, errors: [] }),
    sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
    feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }),
    feedOrgPurchases: () => { order.push('purchases-yielded'); return Promise.resolve({ fed: 0 }); },
    refreshOrgAccounting: () => { order.push('accounting'); return Promise.resolve({}); },
  });
  assert(order.join(',') === 'purchases-yielded,accounting', `order was ${order.join(',')}`);
});
