// AC-005/006: exercise the shipped sweep cycle; ERP fetch remains mocked and the cycle owns the lock.
(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const originalFetch = globalThis.fetch;
const { listEmployingOrgsLive, runErpSweepCycle } = await import('./index.ts');
const { refreshStatementReportBatch, STATEMENT_READ_REQUEST_TIMEOUT_MS, STATEMENT_READ_STAGE_TIMEOUT_MS } = await import('../../../pmo-portal/src/lib/adapterSeam/erpnext/statementReportRefresh.ts');
const { SWEEP_TICK_TIME_BUDGET_MS } = await import('./index.ts');

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

Deno.test('AC-1202: statement request, stage, and invocation budgets admit a slow native report', () => {
  assert(STATEMENT_READ_REQUEST_TIMEOUT_MS === 25_000, `statement requests must allow 25s, got ${STATEMENT_READ_REQUEST_TIMEOUT_MS}`);
  assert(STATEMENT_READ_STAGE_TIMEOUT_MS === 75_000, `statement stage must allow 75s, got ${STATEMENT_READ_STAGE_TIMEOUT_MS}`);
  assert(SWEEP_TICK_TIME_BUDGET_MS >= STATEMENT_READ_STAGE_TIMEOUT_MS, 'the sweep tick must leave room for the statement stage');
  assert(SWEEP_TICK_TIME_BUDGET_MS <= 120_000, 'the sweep tick must remain bounded well below edge wall-clock limits');
});

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
            rpc(name: string, args: Record<string, unknown>) {
              attemptCalls.push({ name, args });
              return Promise.resolve({ data: null, error: { code: '55000', message: 'synthetic current-holder refusal' } });
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

Deno.test('AC-006: the shipped sweep publishes native reports when both System Settings endpoints return 403', async () => {
  const deniedSettingsPaths = new Set([
    '/api/resource/System%20Settings/System%20Settings',
    '/api/method/frappe.core.doctype.system_settings.system_settings.load',
  ]);
  const deniedSettingsRequests: string[] = [];
  const nativeRequests: Request[] = [];
  const rpcNames: string[] = [];
  let openCount = 0;
  let stageCount = 0;
  let publishCount = 0;
  const requests = [
    {
      statement: 'trial_balance', projectId: null, periodKind: 'fiscal_year',
      currentStart: '2025-01-01', currentEnd: '2025-12-31', priorStart: '2024-01-01', priorEnd: '2024-12-31', side: 'current',
    },
    {
      statement: 'trial_balance', projectId: null, periodKind: 'fiscal_year',
      currentStart: '2025-01-01', currentEnd: '2025-12-31', priorStart: '2024-01-01', priorEnd: '2024-12-31', side: 'prior',
    },
  ];
  const erpFetch = ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve().then(() => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (deniedSettingsPaths.has(url.pathname)) {
      deniedSettingsRequests.push(url.pathname);
      return new Response(JSON.stringify({ exc_type: 'PermissionError' }), { status: 403 });
    }
    if (url.pathname === '/api/method/frappe.utils.change_log.get_versions') {
      return new Response(JSON.stringify({ message: { erpnext: { version: '16.33.0' }, frappe: { version: '16.31.0' } } }));
    }
    if (url.pathname === '/api/resource/Company') {
      return new Response(JSON.stringify({ data: [{ name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: null }] }));
    }
    if (url.pathname === '/api/resource/Accounts%20Settings/Accounts%20Settings') {
      return new Response(JSON.stringify({ data: { name: 'Accounts Settings', ignore_is_opening_check_for_reporting: 0, ignore_account_closing_balance: 0 } }));
    }
    if (url.pathname === '/api/resource/Currency/IDR') {
      return new Response(JSON.stringify({ data: { name: 'IDR', fraction_units: 100, number_format: '#,###.##' } }));
    }
    if (url.pathname === '/api/resource/Finance%20Book') return new Response(JSON.stringify({ data: [] }));
    if (url.pathname === '/api/resource/Fiscal%20Year') {
      return new Response(JSON.stringify({ data: [{ name: 'FY-2024' }, { name: 'FY-2025' }] }));
    }
    if (url.pathname === '/api/resource/Fiscal%20Year/FY-2024') {
      return new Response(JSON.stringify({ data: { name: 'FY-2024', disabled: 0, year_start_date: '2024-01-01', year_end_date: '2024-12-31', companies: [] } }));
    }
    if (url.pathname === '/api/resource/Fiscal%20Year/FY-2025') {
      return new Response(JSON.stringify({ data: { name: 'FY-2025', disabled: 0, year_start_date: '2025-01-01', year_end_date: '2025-12-31', companies: [] } }));
    }
    if (url.pathname === '/api/method/frappe.desk.query_report.run') {
      nativeRequests.push(request);
      return new Response(JSON.stringify({
        message: {
          columns: [
            { fieldname: 'account', label: 'Account', fieldtype: 'Link' },
            ...['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit']
              .map((fieldname) => ({ fieldname, label: fieldname, fieldtype: 'Currency' })),
          ],
          result: [{ account: 'Synthetic Cash', opening_debit: '0.00', opening_credit: '0.00', debit: '10.00', credit: '0.00', closing_debit: '10.00', closing_credit: '0.00' }],
        },
      }));
    }
    throw new Error(`unexpected synthetic ERP path ${url.pathname}`);
  })) as typeof fetch;
  const service = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcNames.push(name);
      assert(args.p_org_id === org.orgId && args.p_holder === '33333333-3333-4333-8333-333333333333', 'native RPC lost its org/lease fence');
      if (name === 'mark_erp_statement_report_refresh_attempt' || name === 'mark_erp_statement_report_attempt') return Promise.resolve({ data: null, error: null });
      if (name === 'open_erp_statement_report_batch') {
        const request = requests[openCount] ?? null;
        openCount += 1;
        return Promise.resolve({ data: {
          batchId: '44444444-4444-4444-8444-444444444444',
          startedAt: '2026-10-18T10:00:00.000Z',
          nextRequest: request,
          complete: request === null,
        }, error: null });
      }
      if (name === 'stage_erp_statement_report') { stageCount += 1; return Promise.resolve({ data: null, error: null }); }
      if (name === 'publish_erp_financial_statements') { publishCount += 1; return Promise.resolve({ data: '55555555-5555-4555-8555-555555555555', error: null }); }
      return Promise.resolve({ data: null, error: { code: '42883', message: 'unexpected RPC' } });
    },
  };
  const events: string[] = [];
  try {
    const result = await runErpSweepCycle({
      ...quietPasses,
      listEmployingOrgs: () => Promise.resolve([org]),
      claimStatementLock: () => Promise.resolve(true),
      refreshNativeStatements: (boundOrg) => {
        events.push('native');
        return refreshStatementReportBatch({
          orgId: boundOrg.orgId,
          holder: '33333333-3333-4333-8333-333333333333',
          binding: {
            id: boundOrg.bindingId!, activatedAt: boundOrg.activatedAt!, versionMajor: boundOrg.versionMajor!,
            company: boundOrg.company!, projectMap: {},
          },
          client: { apiKey: 'synthetic-key', apiSecret: 'synthetic-secret', baseUrl: boundOrg.siteUrl, maxRetries: 0, timeoutMs: 5_000, fetchImpl: erpFetch },
          service,
        });
      },
      feedOrgLedgers: () => { events.push('raw'); return Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }); },
      refreshOrgAccounting: () => { events.push('accounting'); return Promise.resolve({}); },
      releaseStatementLock: () => Promise.resolve(),
    });
    assert(result.perOrg[0]?.errors.every((error) => !error.startsWith('native-statement:')), 'the shipped sweep did not record native publication success');
    assert(deniedSettingsRequests.length === 0, `collector requested a denied System Settings endpoint: ${deniedSettingsRequests}`);
    assert(nativeRequests.length === 2, `expected both native report sides to be fetched, got ${nativeRequests.length}`);
    assert(stageCount === 2, `expected both native sides to be staged, got ${stageCount}`);
    assert(publishCount === 1, `expected one complete native publication, got ${publishCount}`);
    assert(rpcNames.includes('publish_erp_financial_statements'), 'shipped sweep never reached the native publisher');
    assert(events.join(',') === 'native,raw,accounting', `unexpected sweep sequence ${events}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
