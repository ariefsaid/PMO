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
    listEmployingOrgs: async () => [org],
    reconcileOrgOutbox: async () => ({ reconciled: 0, errors: [] }),
    sweepOrgDoctypes: async () => ({ applied: 0 }),
    feedOrgLedgers: async () => { order.push('ledger'); return { gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }; },
    feedOrgPurchases: async () => { order.push('purchases'); throw new Error('erp down'); },
    refreshOrgAccounting: async () => { order.push('accounting'); return {}; },
  });
  assert(order.join(',') === 'ledger,purchases,accounting', `order was ${order.join(',')}`);
  assert(result.perOrg[0].errors.includes('purchases:erp down'), 'purchase failure is recorded per org');
});

Deno.test('a bounded purchase pass can yield without preventing accounting refresh', async () => {
  const order: string[] = [];
  await runErpSweepCycle({
    listEmployingOrgs: async () => [org],
    reconcileOrgOutbox: async () => ({ reconciled: 0, errors: [] }),
    sweepOrgDoctypes: async () => ({ applied: 0 }),
    feedOrgLedgers: async () => ({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }),
    feedOrgPurchases: async () => { order.push('purchases-yielded'); return { fed: 0 }; },
    refreshOrgAccounting: async () => { order.push('accounting'); return {}; },
  });
  assert(order.join(',') === 'purchases-yielded,accounting', `order was ${order.join(',')}`);
});
