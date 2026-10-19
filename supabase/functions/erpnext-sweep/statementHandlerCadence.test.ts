// AC-CAD handler-level proof: capture the callback registered by the shipped edge-function module.
type ShippedHandler = (request: Request) => Response | Promise<Response>;
let capturedHandler: ShippedHandler | undefined;
const denoRuntime = globalThis.Deno as unknown as { serve: (handler: ShippedHandler) => unknown };
const originalServe = denoRuntime.serve;
denoRuntime.serve = (handler) => {
  capturedHandler = handler;
  return { finished: Promise.resolve() };
};
await import('./index.ts');
denoRuntime.serve = originalServe;

type Binding = {
  id: string;
  org_id: string;
  site_url: string;
  secret_ref: string;
  config: { company?: unknown; project_map?: unknown };
  activated_at: string | null;
  version_major: number | null;
  external_tier: 'erpnext';
  statement_full_ledger_replay_needed: boolean;
};
type PublishedContext = {
  org_id: string;
  company: string;
  snapshot_id: string;
  source_generation: string;
  context: Record<string, unknown>;
};
type RecordedRequest = { origin: string; path: string; method: string; body: unknown };

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '33333333-3333-4333-8333-333333333333';
const BINDING_A = '22222222-2222-4222-8222-222222222222';
const BINDING_B = '44444444-4444-4444-8444-444444444444';
const PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const SYNTHETIC_SECRET = 'synthetic-sweep-secret';

function binding(
  orgId: string,
  bindingId: string,
  company: string,
  activatedAt = '2026-10-01T00:00:00+00:00',
  projectMap: Record<string, string> = { [PROJECT_ID]: 'PROJECT-1' },
): Binding {
  return {
    id: bindingId,
    org_id: orgId,
    site_url: `https://erp-${orgId}.synthetic.test`,
    secret_ref: `synthetic-${orgId}`,
    config: { company, project_map: projectMap },
    activated_at: activatedAt,
    version_major: 16,
    external_tier: 'erpnext',
    statement_full_ledger_replay_needed: false,
  };
}

function publicationFor(
  row: Binding,
  over: Partial<PublishedContext['context']> = {},
  identity: { snapshotId?: string; sourceGeneration?: string } = {},
): PublishedContext {
  return {
    org_id: row.org_id,
    company: typeof row.config.company === 'string' ? row.config.company : '',
    snapshot_id: identity.snapshotId ?? crypto.randomUUID(),
    source_generation: identity.sourceGeneration ?? crypto.randomUUID(),
    context: {
      company: row.config.company,
      binding: { id: row.id, activatedAt: row.activated_at, versionMajor: row.version_major },
      projectMap: row.config.project_map ?? {},
      ...over,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function queryValue(url: URL, key: string, prefix: string): string | null {
  const value = url.searchParams.get(key);
  return value?.startsWith(prefix) ? value.slice(prefix.length) : null;
}

function deepContains(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length <= actual.length && expected.every((value, index) => deepContains(actual[index], value));
  }
  if (Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) => deepContains((actual as Record<string, unknown>)[key], value));
}

async function invokeHandler(
  at: string,
  bindings: Binding[],
  published: PublishedContext[],
  options: { publicationReadError?: boolean; body?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; requests: RecordedRequest[]; errors: string[] }> {
  const handler = capturedHandler;
  if (!handler) throw new Error('the shipped index.ts handler was not captured from Deno.serve');

  const requests: RecordedRequest[] = [];
  const errors: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const originalConsoleError = console.error;
  const denoEnv = (globalThis.Deno as unknown as { env: { get: (name: string) => string | undefined } }).env;
  const originalEnvGet = denoEnv.get;
  const env = new Map<string, string>([
    ['ERPNEXT_SWEEP_SECRET', SYNTHETIC_SECRET],
    ['SUPABASE_URL', 'https://supabase.synthetic.test'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role-key'],
    ['EXTERNAL_CONNECT_ENABLED', 'true'],
  ]);
  const currentOrgIds = new Set(bindings.map((row) => row.org_id));

  denoEnv.get = (name) => env.get(name);
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  Date.now = () => Date.parse(at);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    let body: unknown = null;
    if (request.body) {
      const raw = await request.clone().text();
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }
    }
    requests.push({ origin: url.origin, path: `${url.pathname}${url.search}`, method, body });

    if (url.hostname === 'supabase.synthetic.test') {
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const rpcName = decodeURIComponent(url.pathname.slice('/rest/v1/rpc/'.length));
        if (rpcName === 'read_vault_secret') return jsonResponse('synthetic-api-key:synthetic-api-secret');
        if (rpcName === 'claim_erp_sweep_lock' || rpcName === 'release_erp_sweep_lock') return jsonResponse(true);
        if (rpcName === 'outbox_reconcile_candidates') return jsonResponse([]);
        if (rpcName === 'mark_erp_statement_report_refresh_attempt') return jsonResponse(null);
        if (rpcName === 'open_erp_statement_report_batch') return jsonResponse({
          batchId: '66666666-6666-4666-8666-666666666666',
          startedAt: at,
          nextRequest: null,
          complete: true,
        });
        if (rpcName === 'publish_erp_financial_statements') {
          const args = body as Record<string, unknown> | null;
          const orgId = typeof args?.p_org_id === 'string' ? args.p_org_id : '';
          const target = bindings.find((row) => row.org_id === orgId);
          const snapshotId = crypto.randomUUID();
          if (target) published.push(publicationFor(target, {}, {
            snapshotId,
            sourceGeneration: typeof args?.p_batch_id === 'string' ? args.p_batch_id : crypto.randomUUID(),
          }));
          return jsonResponse(snapshotId);
        }
        if (rpcName === 'mark_erp_statement_replay_for_missing_accounts') return jsonResponse(false);
        if (rpcName === 'finish_erp_gl_replay') return jsonResponse(true);
        return jsonResponse(null);
      }

      const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
      if (table === 'external_org_bindings') {
        const orgFilter = queryValue(url, 'org_id', 'eq.');
        const rows = bindings.filter((row) => currentOrgIds.has(row.org_id) && (!orgFilter || row.org_id === orgFilter));
        const secretOnly = url.searchParams.get('select') === 'secret_ref';
        const result = secretOnly ? rows.map(({ secret_ref }) => ({ secret_ref })) : rows;
        if (request.headers.get('Accept')?.includes('vnd.pgrst.object')) return jsonResponse(result[0] ?? null);
        return jsonResponse(result);
      }
      if (table === 'erp_financial_statement_published_context') {
        if (options.publicationReadError) return jsonResponse({ code: 'synthetic-read-failure', message: 'synthetic publication context read failure' }, 503);
        const orgFilter = queryValue(url, 'org_id', 'eq.');
        const companyFilter = queryValue(url, 'company', 'eq.');
        const bindingIdFilter = queryValue(url, 'context->binding->>id', 'eq.');
        const versionFilter = queryValue(url, 'context->binding->>versionMajor', 'eq.');
        const containsFilter = url.searchParams.get('context');
        let expected: unknown;
        if (containsFilter?.startsWith('cs.')) {
          try { expected = JSON.parse(containsFilter.slice('cs.'.length)); } catch { expected = undefined; }
        }
        const rangeHeader = request.headers.get('Range');
        const rangeMatch = rangeHeader?.match(/(?:items=)?(\d+)-(\d+)/);
        const from = rangeMatch ? Number(rangeMatch[1]) : 0;
        const to = rangeMatch ? Number(rangeMatch[2]) : Number.MAX_SAFE_INTEGER;
        const rows = published.filter((row) =>
          (!orgFilter || row.org_id === orgFilter) && (!companyFilter || row.company === companyFilter) &&
          (!bindingIdFilter || (row.context.binding as Record<string, unknown> | undefined)?.id === bindingIdFilter) &&
          (!versionFilter || String((row.context.binding as Record<string, unknown> | undefined)?.versionMajor) === versionFilter) &&
          (expected === undefined || deepContains(row.context, expected)));
        return jsonResponse(rows.slice(from, to + 1));
      }
      if (table === 'external_domain_ownership') {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    }

    if (url.hostname.endsWith('.synthetic.test')) {
      if (url.pathname === '/api/method/frappe.utils.change_log.get_versions') {
        return jsonResponse({ message: { erpnext: { version: '16.33.0' }, frappe: { version: '16.31.0' } } });
      }
      if (url.pathname === '/api/resource/Company') {
        return jsonResponse({ data: bindings.filter((row) => row.site_url === url.origin).map((row) => ({
          name: row.config.company, default_currency: 'IDR', default_finance_book: null,
        })) });
      }
      if (url.pathname === '/api/resource/Accounts%20Settings/Accounts%20Settings') {
        return jsonResponse({ data: { name: 'Accounts Settings', ignore_is_opening_check_for_reporting: 0, ignore_account_closing_balance: 0 } });
      }
      if (url.pathname === '/api/resource/Currency/IDR') {
        return jsonResponse({ data: { name: 'IDR', fraction_units: 100, number_format: '#,###.##' } });
      }
      if (url.pathname === '/api/resource/Finance%20Book') return jsonResponse({ data: [] });
      if (url.pathname === '/api/resource/Fiscal%20Year') {
        return jsonResponse({ data: [{ name: 'FY-2025' }, { name: 'FY-2026' }] });
      }
      if (url.pathname === '/api/resource/Fiscal%20Year/FY-2025') {
        return jsonResponse({ data: { name: 'FY-2025', disabled: 0, year_start_date: '2025-01-01', year_end_date: '2025-12-31', companies: [] } });
      }
      if (url.pathname === '/api/resource/Fiscal%20Year/FY-2026') {
        return jsonResponse({ data: { name: 'FY-2026', disabled: 0, year_start_date: '2026-01-01', year_end_date: '2026-12-31', companies: [] } });
      }
      if (url.pathname === '/api/resource/System%20Settings/System%20Settings' ||
        url.pathname === '/api/method/frappe.core.doctype.system_settings.system_settings.load') {
        return jsonResponse({ exc_type: 'PermissionError' }, 403);
      }
      return jsonResponse({ data: [] });
    }
    return jsonResponse({ error: 'unexpected synthetic test host' }, 500);
  }) as typeof fetch;

  try {
    const response = await handler(new Request('https://edge.synthetic.test/functions/v1/erpnext-sweep', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SYNTHETIC_SECRET}`, 'Content-Type': 'application/json' },
      body: options.body ?? '{}',
    }));
    let responseBody: Record<string, unknown> = {};
    try { responseBody = await response.json() as Record<string, unknown>; } catch { /* preserve status for assertion */ }
    return { status: response.status, body: responseBody, requests, errors };
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
    console.error = originalConsoleError;
    denoEnv.get = originalEnvGet;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNoSweepWork(requests: RecordedRequest[], label: string): void {
  const unexpected = requests.find(({ path, origin }) => origin.startsWith('https://erp-') ||
    !(path.startsWith('/rest/v1/external_org_bindings') || path.startsWith('/rest/v1/erp_financial_statement_published_context')));
  assert(!unexpected, `${label}: reached sweep work before cadence decision: ${unexpected?.path}`);
}

Deno.test('AC-CAD: the real handler gates all work by first native publication and UTC hourly boundary', async (t) => {
  const first = binding(ORG_A, BINDING_A, 'Synthetic Company A');
  const second = binding(ORG_B, BINDING_B, 'Synthetic Company B', '2026-10-02T00:00:00+00:00', {});

  await t.step('AC-CAD-001: midhour all-published handler returns a no-op before ERP and domain work', async () => {
    const result = await invokeHandler('2026-10-19T07:05:00.000Z', [first], [publicationFor(first, {
      binding: { id: first.id, activatedAt: '2026-10-01T00:00:00Z', versionMajor: first.version_major },
    })]);
    assert(result.status === 200 && result.body.ok === true && result.body.skipped === true, `expected successful no-op, got ${result.status} ${JSON.stringify(result.body)}`);
    assertNoSweepWork(result.requests, 'all-published midhour tick');
  });

  await t.step('AC-CAD-002: UTC minute 4 runs the cycle and minute 5 skips after publication exists', async () => {
    const publicationState: PublishedContext[] = [];
    const atMinuteFour = await invokeHandler('2026-10-19T07:04:00.000Z', [first], publicationState);
    assert(atMinuteFour.status === 200 && atMinuteFour.body.ok === true && atMinuteFour.body.skipped !== true,
      `minute 4 did not run the whole cycle: ${atMinuteFour.status} ${JSON.stringify(atMinuteFour.body)}`);
    assert(atMinuteFour.requests.some(({ path }) => path.startsWith('/rest/v1/rpc/claim_erp_sweep_lock')),
      'minute 4 did not reach the real per-org sweep lock');
    assert(atMinuteFour.requests.some(({ origin }) => origin.startsWith('https://erp-')),
      'minute 4 did not reach the real ERP-backed cycle');
    assert(atMinuteFour.requests.some(({ path }) => path.startsWith('/rest/v1/rpc/publish_erp_financial_statements')),
      'minute 4 did not complete a native first publication');
    assert(publicationState.some((row) => row.org_id === first.org_id && row.context.binding !== undefined),
      'the synthetic publisher did not persist the first current-binding generation');

    const afterPublication = await invokeHandler('2026-10-19T08:05:00.000Z', [first], publicationState);
    assert(afterPublication.status === 200 && afterPublication.body.ok === true && afterPublication.body.skipped === true,
      `a published binding did not return to hourly cadence: ${afterPublication.status} ${JSON.stringify(afterPublication.body)}`);
    assertNoSweepWork(afterPublication.requests, 'published binding after first publication');

    const nextHour = await invokeHandler('2026-10-19T09:04:00.000Z', [first], publicationState);
    assert(nextHour.status === 200 && nextHour.body.ok === true && nextHour.body.skipped !== true,
      `the next hourly window did not resume normal work: ${nextHour.status} ${JSON.stringify(nextHour.body)}`);
    assert(nextHour.requests.some(({ path }) => path.startsWith('/rest/v1/rpc/claim_erp_sweep_lock')),
      'the next hourly window did not reach the real per-org sweep lock');
  });

  await t.step('AC-CAD-003: one unpublished member of a two-binding org set runs the whole cycle', async () => {
    const result = await invokeHandler('2026-10-19T07:35:00.000Z', [first, second], [publicationFor(first)]);
    assert(result.status === 200 && result.body.ok === true && result.body.skipped !== true,
      `an unpublished active binding failed to activate the cycle: ${result.status} ${JSON.stringify(result.body)}`);
    const claimedOrgs = result.requests
      .filter(({ path }) => path.startsWith('/rest/v1/rpc/claim_erp_sweep_lock'))
      .map(({ body }) => (body as Record<string, unknown> | null)?.p_org_id)
      .sort();
    assert(claimedOrgs.includes(ORG_A) && claimedOrgs.includes(ORG_B), `not every active binding entered the cycle: ${JSON.stringify(claimedOrgs)}`);
  });

  await t.step('AC-CAD-003: only bindings eligible for native collection hold the first-publication cadence', async () => {
    const legacy = { ...binding(ORG_B, BINDING_B, 'Legacy Company'), version_major: 15 };
    const unknownVersion = {
      ...binding('77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888', 'Unknown Company'),
      version_major: null,
    };
    const missingCompany = {
      ...binding('99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ''),
    };
    const malformedProjectMap = {
      ...binding('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Malformed Company'),
      config: { company: 'Malformed Company', project_map: null },
    };
    const result = await invokeHandler('2026-10-19T07:35:00.000Z',
      [first, legacy, unknownVersion, missingCompany, malformedProjectMap], [publicationFor(first)]);
    assert(result.status === 200 && result.body.ok === true && result.body.skipped === true,
      `legacy or unusable bindings blocked a published native-eligible binding: ${result.status} ${JSON.stringify(result.body)}`);
    assertNoSweepWork(result.requests, 'published native-eligible binding with legacy or unusable neighbors');
  });

  await t.step('AC-CAD-004: a foreign binding or stale activation/project map cannot satisfy current publication', async () => {
    const foreignBinding = publicationFor(first, { binding: { id: BINDING_B, activatedAt: first.activated_at, versionMajor: first.version_major } });
    const staleActivation = publicationFor(first, { binding: { id: first.id, activatedAt: '2026-09-01T00:00:00.000Z', versionMajor: first.version_major } });
    const staleVersion = publicationFor(first, { binding: { id: first.id, activatedAt: first.activated_at, versionMajor: 15 } });
    const staleProjectMap = publicationFor(first, { projectMap: {} });
    const result = await invokeHandler('2026-10-19T07:35:00.000Z', [first], [foreignBinding, staleActivation, staleVersion, staleProjectMap]);
    assert(result.status === 200 && result.body.ok === true && result.body.skipped !== true,
      `an older/foreign generation was treated as current: ${result.status} ${JSON.stringify(result.body)}`);
    assert(result.requests.some(({ path }) => path.startsWith('/rest/v1/rpc/claim_erp_sweep_lock')),
      'stale publication identity did not activate the normal cycle');
  });

  await t.step('AC-CAD-002: UTC minute 5 is outside the hourly run window', async () => {
    const result = await invokeHandler('2026-10-19T07:05:00.000Z', [first], [publicationFor(first)]);
    assert(result.status === 200 && result.body.skipped === true, `minute 5 unexpectedly ran: ${JSON.stringify(result.body)}`);
    assertNoSweepWork(result.requests, 'UTC minute 5 boundary');
  });

  await t.step('AC-CAD-002: explicit maintenance requests remain outside the cadence no-op', async () => {
    const result = await invokeHandler('2026-10-19T07:35:00.000Z', [first], [publicationFor(first)], {
      body: JSON.stringify({ mode: 'repair-invoice-projects', org_id: first.org_id, after_id: null }),
    });
    assert(result.status === 404 && result.body.error === 'ORG_NOT_ELIGIBLE' && result.body.skipped !== true,
      `maintenance request was swallowed by the cadence gate: ${result.status} ${JSON.stringify(result.body)}`);
    assert(result.requests.some(({ path }) => path.startsWith('/rest/v1/external_domain_ownership')),
      'maintenance request did not reach its separate eligibility check');
  });

  await t.step('AC-CAD-002: publication-read failure is observable and runs instead of falsely skipping', async () => {
    const result = await invokeHandler('2026-10-19T07:35:00.000Z', [first], [], { publicationReadError: true });
    assert(result.status === 200 && result.body.ok === true && result.body.skipped !== true,
      `unknown readiness was treated as published: ${result.status} ${JSON.stringify(result.body)}`);
    assert(result.errors.some((message) => message.includes('publication readiness')),
      `publication readiness failure was not logged: ${JSON.stringify(result.errors)}`);
    assert(result.requests.some(({ path }) => path.startsWith('/rest/v1/rpc/claim_erp_sweep_lock')),
      'unknown readiness did not fail toward running the whole cycle');
  });
});
