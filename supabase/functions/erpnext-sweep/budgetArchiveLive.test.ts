import '../_shared/testing/publicErpDns.ts';
import { budgetAccountIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';

type ShippedHandler = (request: Request) => Response | Promise<Response>;
let shippedHandler: ShippedHandler | undefined;
const denoRuntime = globalThis.Deno as unknown as {
  serve: (handler: ShippedHandler) => unknown;
};
const originalServe = denoRuntime.serve;
denoRuntime.serve = (handler) => {
  shippedHandler = handler;
  return { finished: Promise.resolve() };
};
await import('./index.ts');
denoRuntime.serve = originalServe;

type Row = Record<string, unknown>;
type Job = {
  id: string;
  org_id: string;
  project_id: string;
  budget_version_id: string;
  source_mirror_id: string;
  actor_user_id: string;
  fiscal_year: string;
  erp_account: string;
  erp_budget_name: string;
  activated_at_witness: string;
  pushed_project_start_date: string;
  pushed_project_end_date: string;
  state: string;
};
type ErpBudget = {
  name: string;
  company: string;
  project: string;
  account: string;
  from_fiscal_year: string;
  to_fiscal_year: string;
  docstatus: number;
  budget_amount: number;
  modified: string;
};
type CapturedRequest = {
  origin: string;
  path: string;
  method: string;
  body: unknown;
};

const ORG = '11111111-1111-4111-8111-111111111111';
const BINDING = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const VERSION = '44444444-4444-4444-8444-444444444444';
const SUCCESSOR = '55555555-5555-4555-8555-555555555555';
const ACTOR = '66666666-6666-4666-8666-666666666666';
const ACTIVATED_AT = '2026-10-15T10:00:00.000Z';
const SWEEP_SECRET = 'synthetic-sweep-secret';
const NOW = Date.parse('2026-10-28T00:05:00.000Z');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message = ''): void {
  const got = JSON.stringify(actual);
  const want = JSON.stringify(expected);
  if (got !== want) {
    throw new Error(
      (message ? message + '\n' : '') + 'expected ' + want + '\n     got ' +
        got,
    );
  }
}

function intent(
  ordinal: number,
  fiscalYear: string,
  account: string,
  target: string,
  over: Partial<Job> = {},
): Job {
  const hex = ordinal.toString(16).padStart(12, '0');
  return {
    id: 'a0000000-0000-4000-8000-' + hex,
    org_id: ORG,
    project_id: PROJECT,
    budget_version_id: VERSION,
    source_mirror_id: 'b0000000-0000-4000-8000-' + hex,
    actor_user_id: ACTOR,
    fiscal_year: fiscalYear,
    erp_account: account,
    erp_budget_name: target,
    activated_at_witness: ACTIVATED_AT,
    pushed_project_start_date: '2026-01-01',
    pushed_project_end_date: '2026-12-31',
    state: 'pending',
    ...over,
  };
}

function budgetFor(
  job: Job,
  name = job.erp_budget_name,
  docstatus = 1,
): ErpBudget {
  return {
    name,
    company: 'Synthetic Company',
    project: 'ERP-PROJECT-1',
    account: job.erp_account,
    from_fiscal_year: job.fiscal_year,
    to_fiscal_year: job.fiscal_year,
    docstatus,
    budget_amount: 500,
    modified: '2026-10-15 10:00:00.000000',
  };
}

function matchesFilter(row: Row, key: string, value: string): boolean {
  if (
    key === 'select' || key === 'order' || key === 'limit' ||
    key === 'offset' || key === 'on_conflict'
  ) return true;
  const actual = key === 'budget_versions.project_id'
    ? (row.budget_versions as Row | undefined)?.project_id
    : row[key];
  if (value.startsWith('eq.')) return String(actual ?? '') === value.slice(3);
  if (value.startsWith('neq.')) return String(actual ?? '') !== value.slice(4);
  if (value === 'is.null') return actual === null || actual === undefined;
  if (value === 'not.is.null') return actual !== null && actual !== undefined;
  if (value.startsWith('in.(') && value.endsWith(')')) {
    const members = value.slice(4, -1).split(',').map((member) =>
      member.replace(/^"|"$/g, '')
    );
    return members.includes(String(actual ?? ''));
  }
  return true;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function makeFixture(args: {
  jobs: Job[];
  budgets: ErpBudget[];
  versionStatus?: string;
  versionActivatedAt?: string;
  successor?: { job: Job; target: string };
  crashAfterOutboxCommit?: boolean;
  transitionResult?: 'stale' | 'error';
  notificationError?: boolean;
}) {
  const nowIso = new Date(NOW).toISOString();
  const jobs = args.jobs.map((job) => ({ ...job }));
  const budgets = new Map(args.budgets.map((row) => [row.name, { ...row }]));
  const requests: CapturedRequest[] = [];
  const erpWrites: Array<{ name: string; body: unknown }> = [];
  let failOutboxRef = args.crashAfterOutboxCommit ?? false;
  let nextOutboxId = 0;
  const tables: Record<string, Row[]> = {
    external_org_bindings: [{
      id: BINDING,
      org_id: ORG,
      site_url: 'https://erp.synthetic.test',
      secret_ref: 'synthetic-secret-ref',
      config: {
        company: 'Synthetic Company',
        project_map: { [PROJECT]: 'ERP-PROJECT-1' },
      },
      activated_at: ACTIVATED_AT,
      version_major: 16,
      external_tier: 'erpnext',
      statement_full_ledger_replay_needed: false,
    }],
    external_domain_ownership: [],
    external_sync_watermarks: [],
    erp_sweep_full_run: [{
      org_id: ORG,
      completed_at: new Date(NOW - 10 * 60_000).toISOString(),
    }],
    budget_version_erp_mirror: [],
    budget_version_account_erp_mirror: jobs.map((job) => ({
      id: job.source_mirror_id,
      org_id: ORG,
      budget_version_id: job.budget_version_id,
      fiscal_year: job.fiscal_year,
      erp_account: job.erp_account,
      budget_intent: 'remove',
      push_state: 'pushed',
      erp_budget_name: job.erp_budget_name,
      erp_docstatus: 1,
      erp_cancelled_at: null,
      activated_at_witness: job.activated_at_witness,
      pushed_project_start_date: job.pushed_project_start_date,
      pushed_project_end_date: job.pushed_project_end_date,
      created_at: nowIso,
    })),
    budget_archive_cancel_intents: jobs,
    budget_versions: [{
      id: VERSION,
      org_id: ORG,
      project_id: PROJECT,
      status: args.versionStatus ?? 'Archived',
      activated_at: args.versionActivatedAt ?? ACTIVATED_AT,
    }],
    budget_category_account_map: [],
    projects: [{ id: PROJECT, org_id: ORG }],
    external_refs: jobs.map((job) => ({
      org_id: ORG,
      domain: 'budget',
      external_tier: 'erpnext',
      pmo_record_id: budgetAccountIdentity(
        job.budget_version_id,
        job.fiscal_year,
        job.erp_account,
      ),
      external_record_id: job.erp_budget_name,
    })),
    external_command_outbox: [],
    profiles: [],
  };

  if (args.successor) {
    const { job, target } = args.successor;
    (tables.budget_versions as Row[]).push({
      id: SUCCESSOR,
      org_id: ORG,
      project_id: PROJECT,
      status: 'Active',
      activated_at: '2026-10-20T10:00:00.000Z',
    });
    (tables.budget_version_account_erp_mirror as Row[]).push({
      id: 'c0000000-0000-4000-8000-000000000001',
      org_id: ORG,
      budget_version_id: SUCCESSOR,
      fiscal_year: job.fiscal_year,
      erp_account: job.erp_account,
      budget_intent: 'ensure',
      push_state: 'pushed',
      erp_budget_name: target,
      erp_docstatus: 1,
      erp_cancelled_at: null,
      activated_at_witness: '2026-10-20T10:00:00.000Z',
      pushed_project_start_date: '2026-01-01',
      pushed_project_end_date: '2026-12-31',
      created_at: nowIso,
      budget_versions: { project_id: PROJECT },
    });
    (tables.external_refs as Row[]).push({
      org_id: ORG,
      domain: 'budget',
      external_tier: 'erpnext',
      pmo_record_id: budgetAccountIdentity(
        SUCCESSOR,
        job.fiscal_year,
        job.erp_account,
      ),
      external_record_id: target,
    });
  }

  const tableRows = (table: string) => tables[table] ?? (tables[table] = []);
  const tableMatches = (table: string, url: URL) =>
    tableRows(table).filter((row) =>
      [...url.searchParams.entries()].every(([key, value]) =>
        matchesFilter(row, key, value)
      )
    );
  const outboxWireRow = (row: Row): Row => ({
    id: row.id,
    domain: row.domain,
    pmo_record_id: row.pmo_record_id,
    idempotency_key: row.idempotency_key,
    state: row.state,
    external_record_id: row.external_record_id ?? null,
    canonical: row.canonical ?? null,
    claim_generation: row.claim_generation ?? 0,
    payload_digest: row.payload_digest ?? null,
  });

  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const body = request.body ? parseBody(await request.clone().text()) : null;
    requests.push({
      origin: url.origin,
      path: url.pathname + url.search,
      method,
      body,
    });

    if (url.hostname === 'supabase.synthetic.test') {
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const rpc = decodeURIComponent(
          url.pathname.slice('/rest/v1/rpc/'.length),
        );
        const params = (body ?? {}) as Row;
        if (rpc === 'transition_budget_archive_cancel_intent') {
          if (args.transitionResult === 'error') return jsonResponse({ message: 'transaction failed', code: 'P0001' }, 500);
          if (args.transitionResult === 'stale') return jsonResponse('stale');
          const job = tableRows('budget_archive_cancel_intents').find((row) => row.id === params.p_intent_id && row.org_id === params.p_org_id);
          if (job && params.p_action !== 'retry') job.state = params.p_action;
          return jsonResponse('applied');
        }
        if (rpc === 'read_vault_secret') {
          return jsonResponse('synthetic-api-key:synthetic-api-secret');
        }
        if (
          rpc === 'org_has_active_erpnext_binding' ||
          rpc === 'domain_owned_by_tier'
        ) return jsonResponse(true);
        if (rpc === 'actor_authorization_state') {
          return jsonResponse({ role: 'Finance', active: true });
        }
        if (rpc === 'outbox_reconcile_candidates') {
          return jsonResponse(
            tableRows('external_command_outbox')
              .filter((row) =>
                ['pending', 'failed', 'committing', 'committed'].includes(
                  String(row.state),
                )
              )
              .map(outboxWireRow),
          );
        }
        if (rpc === 'outbox_retry_pending') return jsonResponse([]);
        if (
          rpc === 'claim_erp_sweep_lock' || rpc === 'release_erp_sweep_lock' ||
          rpc === 'mark_erp_full_sweep_done'
        ) return jsonResponse(true);
        if (rpc === 'claim_outbox_for_commit') {
          const row = tableRows('external_command_outbox').find((candidate) =>
            candidate.id === params.p_id
          );
          if (!row || !['pending', 'failed'].includes(String(row.state))) {
            return jsonResponse(null);
          }
          row.state = 'committing';
          row.claim_generation = Number(row.claim_generation ?? 0) + 1;
          return jsonResponse(outboxWireRow(row));
        }
        if (rpc === 'quarantine_committing') return jsonResponse(null);
        if (rpc === 'record_outbox_ref') {
          if (failOutboxRef) {
            failOutboxRef = false;
            return jsonResponse({
              code: 'synthetic-finalize-crash',
              message: 'synthetic crash after ERP cancellation committed',
            }, 503);
          }
          const ref = tableRows('external_refs').find((row) =>
            row.org_id === params.p_org_id && row.domain === params.p_domain &&
            row.pmo_record_id === params.p_pmo_record_id &&
            row.external_record_id === params.p_external_record_id
          );
          if (!ref) {
            tableRows('external_refs').push({
              org_id: params.p_org_id,
              domain: params.p_domain,
              external_tier: params.p_external_tier,
              pmo_record_id: params.p_pmo_record_id,
              external_record_id: params.p_external_record_id,
            });
          }
          return jsonResponse(1);
        }
        if (rpc === 'confirm_outbox') {
          const row = tableRows('external_command_outbox').find((candidate) =>
            candidate.id === params.p_id
          );
          if (row) row.state = 'confirmed';
          return jsonResponse(row ? 1 : 0);
        }
        if (rpc === 'mark_outbox_held') {
          const row = tableRows('external_command_outbox').find((candidate) =>
            candidate.id === params.p_id
          );
          if (row) row.state = 'held';
          return jsonResponse(row ? 1 : 0);
        }
        return jsonResponse(null);
      }

      const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
      const rows = tableMatches(table, url);
      if (table === 'notifications' && args.notificationError) return jsonResponse({ message: 'notification unavailable', code: 'P0001' }, 500);
      if (method === 'GET') {
        if (request.headers.get('Accept')?.includes('vnd.pgrst.object')) {
          return jsonResponse(rows[0] ?? null);
        }
        return jsonResponse(rows);
      }
      if (method === 'POST') {
        const inserts = Array.isArray(body) ? body as Row[] : [body as Row];
        const written: Row[] = [];
        for (const insert of inserts) {
          const row = { ...insert };
          if (table === 'external_command_outbox') {
            row.id = row.id ??
              'd0000000-0000-4000-8000-' +
                (++nextOutboxId).toString().padStart(12, '0');
            row.claim_generation = 0;
            row.external_record_id = null;
            row.canonical = null;
          }
          const conflictKeys =
            url.searchParams.get('on_conflict')?.split(',') ?? ['id'];
          const existing = tableRows(table).find((candidate) =>
            conflictKeys.every((key) =>
              candidate[key] !== undefined && candidate[key] === row[key]
            )
          );
          if (
            existing &&
            request.headers.get('Prefer')?.includes(
              'resolution=merge-duplicates',
            )
          ) Object.assign(existing, row);
          else tableRows(table).push(row);
          written.push(existing ?? row);
        }
        if (request.headers.get('Accept')?.includes('vnd.pgrst.object')) {
          return jsonResponse(written[0] ?? null);
        }
        return jsonResponse(written);
      }
      if (method === 'PATCH') {
        const patch = (body ?? {}) as Row;
        for (const row of rows) Object.assign(row, patch);
        return jsonResponse(
          request.headers.get('Prefer')?.includes('return=representation')
            ? rows
            : null,
        );
      }
      if (method === 'DELETE') {
        const selected = new Set(rows);
        tables[table] = tableRows(table).filter((row) => !selected.has(row));
        return jsonResponse(null);
      }
      return jsonResponse(
        { message: 'unsupported synthetic database method' },
        500,
      );
    }

    if (url.hostname === 'erp.synthetic.test') {
      if (url.pathname === '/api/resource/Budget') {
        let filters: unknown[] = [];
        try {
          filters = JSON.parse(
            url.searchParams.get('filters') ?? '[]',
          ) as unknown[];
        } catch { /* no filters */ }
        const found = [...budgets.values()].filter((budget) =>
          (filters as unknown[][]).every((filter) => {
            const [field, op, value] = filter;
            const actual = (budget as unknown as Row)[String(field)];
            if (op === '=') return actual === value;
            if (op === '<') return Number(actual) < Number(value);
            return true;
          })
        );
        return jsonResponse({ data: found });
      }
      if (url.pathname.startsWith('/api/resource/Budget/')) {
        const name = decodeURIComponent(
          url.pathname.slice('/api/resource/Budget/'.length),
        );
        const existing = budgets.get(name);
        if (!existing) {
          return jsonResponse({
            exception: 'frappe.exceptions.DoesNotExistError',
          }, 404);
        }
        if (method === 'PUT') {
          const patch = (body ?? {}) as Row;
          Object.assign(existing, patch);
          erpWrites.push({ name, body: patch });
          return jsonResponse({ data: existing });
        }
        return jsonResponse({ data: existing });
      }
      return jsonResponse({ data: [] });
    }

    return jsonResponse({
      message: 'unexpected synthetic host ' + url.hostname,
    }, 500);
  };

  async function invoke() {
    const handler = shippedHandler;
    if (!handler) {
      throw new Error(
        'registered handler from the shipped index.ts was not captured',
      );
    }
    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    const denoEnv = (globalThis.Deno as unknown as {
      env: { get: (name: string) => string | undefined };
    }).env;
    const originalEnvGet = denoEnv.get;
    const env = new Map<string, string>([
      ['ERPNEXT_SWEEP_SECRET', SWEEP_SECRET],
      ['SUPABASE_URL', 'https://supabase.synthetic.test'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role-key'],
      ['EXTERNAL_CONNECT_ENABLED', 'true'],
    ]);
    denoEnv.get = (name) => env.get(name);
    globalThis.fetch = fakeFetch;
    Date.now = () => NOW;
    try {
      return await handler(
        new Request('https://edge.synthetic.test/functions/v1/erpnext-sweep', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + SWEEP_SECRET,
            'Content-Type': 'application/json',
          },
          body: '{}',
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
      Date.now = originalNow;
      denoEnv.get = originalEnvGet;
    }
  }

  return { tables, budgets, requests, erpWrites, invoke };
}

Deno.test('AC-BUD-122 the registered sweep dispatches every archived account × year intent to its recorded predecessor', async () => {
  const jobs = [
    intent(1, '2025', 'Labor', 'BUD-LABOR-2025'),
    intent(2, '2025', 'Travel', 'BUD-TRAVEL-2025'),
    intent(3, '2026', 'Labor', 'BUD-LABOR-2026'),
    intent(4, '2026', 'Travel', 'BUD-TRAVEL-2026'),
  ];
  const fixture = makeFixture({
    jobs,
    budgets: jobs.map((job) => budgetFor(job)),
  });

  const response = await fixture.invoke();
  const body = await response.json() as Row;
  assert(
    response.status === 200,
    'the registered sweep should complete a valid tick',
  );
  assertEquals(
    fixture.erpWrites.map((write) => [write.name, write.body]),
    jobs.map((job) => [job.erp_budget_name, { docstatus: 2 }]),
    'each account/year intent must cancel its own recorded Budget exactly once',
  );
  assertEquals(
    (fixture.tables.budget_archive_cancel_intents as Row[]).map((job) =>
      job.state
    ),
    ['complete', 'complete', 'complete', 'complete'],
  );
  assertEquals(
    body.cadence,
    'money-only',
    'the handler invocation must run the normal money pass that owns archive intents',
  );
});

Deno.test('AC-BUD-122 a crash after ERP cancellation but before outbox finalization retries to convergence without a second ERP write', async () => {
  const job = intent(5, '2026', 'Labor', 'BUD-CRASH-RETRY');
  const fixture = makeFixture({
    jobs: [job],
    budgets: [budgetFor(job)],
    crashAfterOutboxCommit: true,
  });

  const firstResponse = await fixture.invoke();
  assert(
    firstResponse.status === 200,
    'the per-org sweep contains one failed archive row',
  );
  assertEquals(
    fixture.budgets.get(job.erp_budget_name)?.docstatus,
    2,
    'ERP accepted the cancellation before finalization failed',
  );
  assertEquals(
    (fixture.tables.budget_archive_cancel_intents as Row[])[0].state,
    'pending',
    'a crash before finalization must leave the durable intent retryable',
  );
  assertEquals(
    fixture.erpWrites.length,
    1,
    'the first dispatch reached ERP once',
  );

  const secondResponse = await fixture.invoke();
  assert(
    secondResponse.status === 200,
    'the next registered sweep should reconcile the same durable intent',
  );
  assertEquals(
    (fixture.tables.budget_archive_cancel_intents as Row[])[0].state,
    'complete',
    'the retry must finalize the existing intent',
  );
  assertEquals(
    fixture.erpWrites.length,
    1,
    'an already-cancelled predecessor converges without issuing a duplicate cancel',
  );
});

Deno.test('AC-BUD-122 an already-cancelled predecessor converges while a newer same-grain Budget stays live', async () => {
  const job = intent(6, '2026', 'Labor', 'BUD-OLD-CANCELLED');
  const newer = budgetFor(job, 'BUD-NEW-LIVE', 1);
  const fixture = makeFixture({
    jobs: [job],
    budgets: [budgetFor(job, job.erp_budget_name, 2), newer],
    successor: { job, target: newer.name },
  });
  const sourceMirror =
    (fixture.tables.budget_version_account_erp_mirror as Row[]).find((row) =>
      row.id === job.source_mirror_id
    )!;
  sourceMirror.erp_docstatus = 2;
  sourceMirror.erp_cancelled_at = '2026-10-20T10:00:00.000Z';

  const response = await fixture.invoke();
  assert(
    response.status === 200,
    'an already-cancelled exact predecessor is a successful convergence',
  );
  assertEquals(
    (fixture.tables.budget_archive_cancel_intents as Row[])[0].state,
    'complete',
  );
  assertEquals(fixture.budgets.get(job.erp_budget_name)?.docstatus, 2);
  assertEquals(
    fixture.budgets.get(newer.name)?.docstatus,
    1,
    'the successor remains live',
  );
  assertEquals(
    fixture.erpWrites,
    [],
    'no cancellation write may target the successor',
  );
  assert(
    fixture.requests.some((request) =>
      request.path.endsWith('/api/resource/Budget/' + job.erp_budget_name)
    ),
    'the handler must read the durable predecessor by its exact ERP name',
  );
});

Deno.test('AC-BUD-122 a same-grain successor cannot substitute for a missing archived predecessor', async () => {
  const job = intent(7, '2026', 'Labor', 'BUD-RECORDED-OLD');
  const newer = budgetFor(job, 'BUD-NEW-LIVE', 1);
  const fixture = makeFixture({
    jobs: [job],
    budgets: [newer],
    successor: { job, target: newer.name },
  });

  await fixture.invoke();
  assertEquals(
    fixture.erpWrites,
    [],
    'a same-grain occupant is not authority to cancel a different ERP document',
  );
  assertEquals(
    fixture.budgets.get(newer.name)?.docstatus,
    1,
    'the newer version’s live document must remain submitted',
  );
  assert(
    fixture.requests.some((request) =>
      request.method === 'GET' &&
      request.path.endsWith('/api/resource/Budget/' + job.erp_budget_name)
    ),
    'the failed dispatch must have requested the recorded predecessor itself',
  );
  assertEquals(
    (fixture.tables.budget_archive_cancel_intents as Row[])[0].state,
    'held',
    'a missing predecessor is held for operator reconciliation',
  );
});

Deno.test('AC-BUD-122 a reactivated version with a changed lifecycle witness cannot issue a stale archive cancel', async () => {
  const job = intent(8, '2026', 'Labor', 'BUD-STALE-INTENT');
  const fixture = makeFixture({
    jobs: [job],
    budgets: [budgetFor(job)],
    versionStatus: 'Active',
    versionActivatedAt: '2026-10-21T10:00:00.000Z',
    transitionResult: 'stale',
  });

  await fixture.invoke();
  assertEquals(
    fixture.erpWrites,
    [],
    'stale archive authority must be rejected before reaching ERP',
  );
  assertEquals(fixture.budgets.get(job.erp_budget_name)?.docstatus, 1);
  assertEquals(
    (fixture.tables.budget_archive_cancel_intents as Row[])[0].state,
    'pending',
    'the stale intent remains pending while its transaction records the operator signal',
  );
});

Deno.test('archive hold uses the service transaction through the registered sweep', async () => {
  const job = intent(20, '2026', 'Labor', 'BUD-HOLD');
  const fixture = makeFixture({ jobs: [job], budgets: [budgetFor(job)], versionStatus: 'Active' });
  await fixture.invoke();
  const calls = fixture.requests.filter((request) => request.path === '/rest/v1/rpc/transition_budget_archive_cancel_intent');
  assertEquals(calls.length, 1, 'the registered handler must invoke the atomic transition');
  assertEquals(calls[0].body, { p_org_id: ORG, p_intent_id: job.id, p_action: 'held', p_reason: 'version-not-archived' });
});

Deno.test('archive transaction failure and stale result leave the registered sweep intent pending', async () => {
  for (const transitionResult of ['error', 'stale'] as const) {
    const job = intent(21, '2026', 'Labor', 'BUD-REVIEW');
    const fixture = makeFixture({ jobs: [job], budgets: [budgetFor(job)], versionStatus: 'Active', transitionResult });
    await fixture.invoke();
    assertEquals((fixture.tables.budget_archive_cancel_intents as Row[])[0].state, 'pending');
    assertEquals(fixture.erpWrites.length, 0);
    assert(fixture.requests.some((request) => request.path === '/rest/v1/rpc/transition_budget_archive_cancel_intent'), 'the shipped handler must report the transaction outcome');
    // The queue's last-attempt stamp (0427) is a PATCH too; what must not happen is a terminal `state` write.
    assert(!fixture.requests.some((request) => request.method === 'PATCH' && request.path.includes('/budget_archive_cancel_intents') && 'state' in ((request.body ?? {}) as Row)), 'no separate terminal write follows a failed transaction');
  }
});

Deno.test('notification sink failure cannot undo the committed archive transaction', async () => {
  const job = intent(22, '2026', 'Labor', 'BUD-UNAVAILABLE');
  const fixture = makeFixture({ jobs: [job], budgets: [], notificationError: true });
  await fixture.invoke();
  assert(fixture.requests.some((request) => request.path === '/rest/v1/rpc/transition_budget_archive_cancel_intent' && (request.body as Row).p_action === 'held'), 'the registered handler must persist the hold before notification');
  assert(fixture.requests.some((request) => request.path.startsWith('/rest/v1/notifications')), 'the notification sink was attempted');
  assertEquals((fixture.tables.budget_archive_cancel_intents as Row[])[0].state, 'held', 'notification failure does not undo the committed transition');
});

Deno.test('the registered sweep settles a successor through the transaction and contains transaction errors', async () => {
  for (const transitionResult of [undefined, 'stale', 'error'] as const) {
    const job = intent(23, '2026', 'Labor', 'BUD-SUCCESSOR');
    const fixture = makeFixture({ jobs: [job], budgets: [budgetFor(job)], successor: { job, target: job.erp_budget_name }, transitionResult });
    (fixture.tables.budget_version_account_erp_mirror as Row[]).find((row) => row.id === job.source_mirror_id)!.push_state = 'pending';
    await fixture.invoke();
    const call = fixture.requests.find((request) => request.path === '/rest/v1/rpc/transition_budget_archive_cancel_intent');
    assert(call && (call.body as Row).p_action === 'superseded', 'the successor decision uses the transaction');
    assertEquals((fixture.tables.budget_archive_cancel_intents as Row[])[0].state, transitionResult ? 'pending' : 'superseded');
    assertEquals(fixture.erpWrites.length, 0, 'the successor Budget is not cancelled');
  }
});
