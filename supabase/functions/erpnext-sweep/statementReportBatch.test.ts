// AC-005/006: exercise the shipped sweep cycle; ERP fetch remains mocked and the cycle owns the lock.
(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const originalFetch = globalThis.fetch;
const { listEmployingOrgsLive, runErpSweepCycle } = await import('./index.ts');
const { refreshStatementReportBatch } = await import('../../../pmo-portal/src/lib/adapterSeam/erpnext/statementReportRefresh.ts');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const org = {
  orgId: '11111111-1111-4111-8111-111111111111',
  siteUrl: 'https://erp.synthetic.test',
  secretRef: 'synthetic-ref',
  company: 'Synthetic Co',
  config: { project_map: {} },
  ownedDomains: ['finance'],
  versionMajor: 16,
  activatedAt: '2026-10-01T00:00:00.000Z',
  bindingId: '22222222-2222-4222-8222-222222222222',
};
const quietPasses = {
  reconcileOrgOutbox: () => Promise.resolve({ reconciled: 0, errors: [] }),
  sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
  feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }),
  refreshOrgAccounting: () => Promise.resolve({}),
};

Deno.test('AC-006: live binding enumeration carries the actual binding id without substituting org identity', async () => {
  const selected: Record<string, string> = {};
  const data: Record<string, unknown> = {
    external_org_bindings: [{
      id: '22222222-2222-4222-8222-222222222222', org_id: org.orgId, site_url: org.siteUrl,
      secret_ref: org.secretRef, config: org.config, activated_at: org.activatedAt, version_major: 16,
      statement_full_ledger_replay_needed: false,
    }],
    external_domain_ownership: [],
    external_sync_watermarks: [],
  };
  const service = {
    from(table: string) {
      const builder = {
        select(columns: string) { selected[table] = columns; return builder; },
        eq() { return builder; },
        in() { return builder; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: data[table] ?? [], error: null })); },
      };
      return builder;
    },
  };
  const bindings = await listEmployingOrgsLive(service as never);
  assert(selected.external_org_bindings?.split(',').includes('id'), 'live binding selection omitted the actual row id');
  assert(bindings.length === 1 && bindings[0]?.bindingId === '22222222-2222-4222-8222-222222222222', 'live binding id was not mapped from external_org_bindings.id');
  assert(bindings[0]?.bindingId !== bindings[0]?.orgId, 'organization id was substituted for binding id');
});

Deno.test('AC-006: native report segment runs under the claimed holder even when raw catch-up is incomplete', async () => {
  globalThis.fetch = (() => Promise.reject(new Error('network must remain mocked'))) as typeof fetch;
  const events: string[] = [];
  let held = false;
  let holder: string | null = null;
  let erpFetches = 0;
  const attemptCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  try {
    const result = await runErpSweepCycle({
      ...quietPasses,
      listEmployingOrgs: () => Promise.resolve([org]),
      claimStatementLock: (_orgId, claimedHolder) => {
        held = true;
        holder = claimedHolder;
        events.push('claim');
        return Promise.resolve(true);
      },
      refreshNativeStatements: (boundOrg) => {
        events.push('native');
        assert(held && boundOrg.statementLockHolder === holder, 'native segment did not receive the currently claimed lock holder');
        return refreshStatementReportBatch({
          orgId: boundOrg.orgId,
          holder: boundOrg.statementLockHolder!,
          binding: {
            id: boundOrg.bindingId!, activatedAt: boundOrg.activatedAt!, versionMajor: boundOrg.versionMajor!,
            company: boundOrg.company!, projectMap: {},
          },
          client: {
            apiKey: 'synthetic-key', apiSecret: 'synthetic-secret', baseUrl: boundOrg.siteUrl,
            maxRetries: 0, timeoutMs: 5_000,
            fetchImpl: (() => { erpFetches += 1; return Promise.reject(new Error('ERP request was not expected')); }) as typeof fetch,
          },
          service: {
            async rpc(name: string, args: Record<string, unknown>) {
              attemptCalls.push({ name, args });
              return { data: null, error: { code: '55000', message: 'synthetic current-holder refusal' } };
            },
          },
        }).then((result) => ({ errorCode: result.errorCode }));
      },
      feedOrgLedgers: () => {
        events.push('raw-feed');
        return Promise.resolve({ gl: 0, ple: 0, glCaughtUp: false, pleCaughtUp: true, error: 'synthetic raw incompleteness' });
      },
      refreshOrgAccounting: () => {
        events.push('accounting');
        return Promise.resolve({});
      },
      releaseStatementLock: (_orgId, releasedHolder) => {
        events.push('release');
        assert(releasedHolder === holder, 'cycle released a different holder');
        held = false;
        return Promise.resolve();
      },
    });
    assert(events.indexOf('native') >= 0 && events.indexOf('native') < events.indexOf('raw-feed'), 'native segment was gated behind raw ledger readiness');
    assert(events.includes('raw-feed'), 'raw feed did not continue after the native segment failure');
    assert(attemptCalls.length === 1 && attemptCalls[0]?.name === 'mark_erp_statement_report_refresh_attempt', 'collector did not invoke the fenced admission RPC first');
    assert(attemptCalls[0]?.args.p_holder === holder && attemptCalls[0]?.args.p_org_id === org.orgId, 'collector admission did not carry its claimed org and holder');
    assert(erpFetches === 0, 'collector performed an ERP context/report request without admitted status');
    assert(!attemptCalls.some(({ name }) => name === 'open_erp_statement_report_batch' || name === 'stage_erp_statement_report' || name === 'publish_erp_financial_statements'), 'refused collector continued to batch/storage RPCs');
    assert(!events.includes('accounting'), 'legacy accounting must retain its existing raw caught-up gate');
    assert(events.at(-1) === 'release' && !held, 'sweep lock was not released in finally');
    assert(result.perOrg[0]?.errors.includes('native-statement:native-batch-unavailable'), 'safe native failure was not recorded on the org');
    assert(!JSON.stringify(result).includes('synthetic-ref'), 'cycle result exposed a credential reference');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('AC-006: native report failure does not skip the ordinary accounting pass after raw catch-up', async () => {
  globalThis.fetch = (() => Promise.reject(new Error('network must remain mocked'))) as typeof fetch;
  const events: string[] = [];
  try {
    const result = await runErpSweepCycle({
      ...quietPasses,
      listEmployingOrgs: () => Promise.resolve([org]),
      claimStatementLock: () => Promise.resolve(true),
      releaseStatementLock: () => Promise.resolve(),
      refreshNativeStatements: () => {
        events.push('native-failed');
        return Promise.resolve({ errorCode: 'native-batch-unavailable' });
      },
      feedOrgLedgers: () => {
        events.push('raw-complete');
        return Promise.resolve({ gl: 1, ple: 1, glCaughtUp: true, pleCaughtUp: true });
      },
      refreshOrgAccounting: () => {
        events.push('legacy-accounting');
        return Promise.resolve({});
      },
    });
    assert(events.join(',') === 'native-failed,raw-complete,legacy-accounting', `ordinary accounting did not continue after native failure: ${events}`);
    assert(result.perOrg[0]?.errors.includes('native-statement:native-batch-unavailable'), 'native failure was not surfaced separately');
    assert(!result.perOrg[0]?.errors.some((error) => error.startsWith('ledger:') || error.startsWith('accounting:')), 'native-only failure poisoned ordinary accounting status');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
