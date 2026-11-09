import '../_shared/testing/publicErpDns.ts';
import { budgetRangeIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';

/**
 * rm-1472 — the units parked on `waiting-for-budget-archive-cancellation` must be RESUMED.
 *
 * The defect: `adapter-dispatch`'s budget gate answers `202 budget-cancellation-pending` (no outbox row
 * is written at all — the fan-out never begins) while an archive cancellation is unsettled. Nothing
 * re-ran that gate once the cancels settled, and the sweep backstop only looked for an EXISTING outbox
 * row, so it parked every such unit `held` as `budget-push-no-outbox-candidate`. ERPNext cancelled the
 * old Budgets and never received the new one: ERP budget control ran against nothing while PMO said
 * "Version activated".
 *
 * These tests drive the SHIPPED sweep handler (registered by `./index.ts`), so every assertion below is
 * about the code that runs in production, not a copy of it.
 */
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

const ORG = '11111111-1111-4111-8111-111111111111';
const BINDING = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const VERSION = '44444444-4444-4444-8444-444444444444';
const ACTOR = '66666666-6666-4666-8666-666666666666';
const ACCOUNT = '5100 - Salary - Co';
const FY = '2026';

const OTHER_ORG = '11111111-1111-4111-8111-111111111112';
const OTHER_BINDING = '22222222-2222-4222-8222-222222222223';
const OTHER_PROJECT = '33333333-3333-4333-8333-333333333334';
const OTHER_VERSION = '44444444-4444-4444-8444-444444444445';
const OTHER_ACTOR = '66666666-6666-4666-8666-666666666667';

const ACTIVATED_AT = '2026-10-15T10:00:00.000Z';
const WAIT = 'waiting-for-budget-archive-cancellation';
const SWEEP_SECRET = 'synthetic-sweep-secret';
const NOW = Date.parse('2026-10-28T00:05:00.000Z');
/** The person who activated VERSION (the resume's only correct attribution). */
const ACTIVATOR = '88888888-8888-4888-8888-888888888888';
/** Someone who manually archived a version on the same project AFTER that activation. */
const MANUAL_ARCHIVER = '99999999-9999-4999-8999-999999999999';
/** The archived predecessor of VERSION — the `budget_version_id` an activation-queued request names. */
const PREDECESSOR = '55555555-5555-4555-8555-555555555555';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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

function matchesFilter(row: Row, key: string, value: string): boolean {
  if (
    key === 'select' || key === 'order' || key === 'limit' || key === 'offset' ||
    key === 'on_conflict'
  ) return true;
  const actual = key === 'budget_versions.project_id'
    ? (row.budget_versions as Row | undefined)?.project_id
    : row[key];
  if (value.startsWith('eq.')) return String(actual ?? '') === value.slice(3);
  if (value.startsWith('neq.')) return String(actual ?? '') !== value.slice(4);
  if (value === 'is.null') return actual === null || actual === undefined;
  if (value === 'not.is.null') return actual !== null && actual !== undefined;
  if (value.startsWith('in.(') && value.endsWith(')')) {
    const members = value.slice(4, -1).split(',').map((member) => member.replace(/^"|"$/g, ''));
    return members.includes(String(actual ?? ''));
  }
  return true;
}

/** The occupied (company, project, fiscal-year) grain the ERPNext Budget duplicate guard enforces. */
type ErpBudgetDoc = {
  name: string;
  owner: string;
  modified: string;
  docstatus: number;
  [field: string]: unknown;
};

function makeFixture(args: {
  orgOneIntents: string[];
  orgTwoIntents?: string[];
  /** rm-1472 — an extra parked `remove` unit for an account the re-derived plan no longer desires. */
  orgOneDroppedAccount?: string;
  /** ⚑ I-1 — how the ACTIVATION's own archive request reads back: `queued` (the normal, recorded case),
   *  `none` (that activation queued no cancellation, so no activator is recorded) or `ambiguous` (two
   *  rows claim the same activation timestamp, so no single person can be attributed). */
  activationRequest?: 'queued' | 'none' | 'ambiguous';
  /** ⚑ I-1 — someone manually archived on this project AFTER the activation. Their settled intent is the
   *  newest on the project, which is what the shipped code wrongly attributed the resumed mint to. */
  manualArchiveBy?: string;
  /** ⚑ I-1 — an EARLIER activation on the same project also queued a cancellation (`queued_by_activation`,
   *  a different `created_at`). Attribution must key on THIS version's activation stamp, not merely on
   *  "some activation-queued request exists on the project". */
  priorActivationRequestBy?: string;
  /** ⚑ M-2 — the activator's CURRENT authorization as `actor_authorization_state` reports it. */
  actorState?: { role: string | null; active: boolean };
  /** ⚑ M-4 — make the fence read as settled on its first read and unsettled from this read (1-based)
   *  onwards, so the resume's own check passes and the gate's re-check answers 202. */
  unsettleFenceOnRead?: number;
  /** ⚑ M-4 — drop the category→ERP-account mapping so the re-derived gate refuses (422) on resume. */
  dropCategoryMapping?: boolean;
}) {
  let nextOutboxId = 0;
  let nextBudgetId = 0;
  let fenceReads = 0;
  const nowIso = new Date(NOW).toISOString();
  const budgets = new Map<string, ErpBudgetDoc>();
  const erpCreates: Array<{ name: string; body: Row }> = [];
  const erpSubmits: string[] = [];

  const waitingUnit = (ordinal: number, orgId: string, bindingId: string, project: string, version: string) => ({
    id: 'b0000000-0000-4000-8000-' + ordinal.toString(16).padStart(12, '0'),
    org_id: orgId,
    budget_version_id: version,
    fiscal_year: FY,
    to_fiscal_year: FY,
    erp_account: ACCOUNT,
    budget_intent: 'ensure',
    push_state: 'pending',
    push_error: WAIT,
    erp_budget_name: null,
    erp_docstatus: null,
    erp_cancelled_at: null,
    activated_at_witness: ACTIVATED_AT,
    pushed_project_start_date: '2026-02-01',
    pushed_project_end_date: '2026-11-30',
    created_at: nowIso,
    binding: bindingId,
    project,
  });

  const intent = (ordinal: number, orgId: string, project: string, version: string, actor: string, state: string, updatedAt: string = nowIso) => ({
    id: 'a0000000-0000-4000-8000-' + ordinal.toString(16).padStart(12, '0'),
    org_id: orgId,
    request_id: '90000000-0000-4000-8000-' + ordinal.toString(16).padStart(12, '0'),
    project_id: project,
    budget_version_id: version,
    source_mirror_id: 'c0000000-0000-4000-8000-' + ordinal.toString(16).padStart(12, '0'),
    source_kind: 'account',
    actor_user_id: actor,
    fiscal_year: FY,
    to_fiscal_year: FY,
    erp_modified: '2026-10-15 10:00:00.000000',
    erp_account: ACCOUNT,
    erp_budget_name: 'BUD-PREDECESSOR',
    activated_at_witness: '2026-09-01T10:00:00.000Z',
    pushed_project_start_date: '2026-02-01',
    pushed_project_end_date: '2026-11-30',
    state,
    updated_at: updatedAt,
  });

  const binding = (id: string, orgId: string, project: string) => ({
    id,
    org_id: orgId,
    site_url: 'https://erp.synthetic.test',
    secret_ref: 'synthetic-secret-ref',
    config: { company: 'Synthetic Company', project_map: { [project]: 'ERP-PROJECT-1' } },
    activated_at: ACTIVATED_AT,
    version_major: 16,
    external_tier: 'erpnext',
    statement_full_ledger_replay_needed: false,
  });

  const liveBudgetShape = (orgId: string, project: string, version: string) => ({
    org_id: orgId,
    project_id: project,
    status: 'Active',
    activated_at: ACTIVATED_AT,
    budget_mode: 'whole_project',
    id: version,
  });

  const request = (ordinal: number, orgId: string, project: string, version: string, requestedBy: string, queuedByActivation: boolean, createdAt: string) => ({
    id: '90000000-0000-4000-8000-' + ordinal.toString(16).padStart(12, '0'),
    org_id: orgId,
    project_id: project,
    budget_version_id: version,
    requested_by: requestedBy,
    cancel_erp: true,
    live_target_count: 1,
    queued_by_activation: queuedByActivation,
    created_at: createdAt,
  });

  const activationRequests = args.activationRequest ?? 'queued';
  const orgOneRequests = activationRequests === 'none'
    ? []
    : activationRequests === 'ambiguous'
      ? [
        request(30, ORG, PROJECT, PREDECESSOR, ACTIVATOR, true, ACTIVATED_AT),
        request(31, ORG, PROJECT, PREDECESSOR, MANUAL_ARCHIVER, true, ACTIVATED_AT),
      ]
      : [request(30, ORG, PROJECT, PREDECESSOR, ACTIVATOR, true, ACTIVATED_AT)];
  // The manual archive of a DIFFERENT version on the same project, recorded later: its settled intent is
  // the newest on the project, so a project-wide "latest settled actor" read answers with ITS actor.
  const manualRequest = args.manualArchiveBy
    ? [request(32, ORG, PROJECT, PREDECESSOR, args.manualArchiveBy, false, '2026-10-20T09:00:00.000Z')]
    : [];
  // A cancellation queued by an EARLIER activation of the same project: same `queued_by_activation`
  // flag, a different transaction stamp.
  const priorActivationRequest = args.priorActivationRequestBy
    ? [request(33, ORG, PROJECT, PREDECESSOR, args.priorActivationRequestBy, true, '2026-08-01T08:00:00.000Z')]
    : [];

  const tables: Record<string, Row[]> = {
    external_org_bindings: [
      binding(BINDING, ORG, PROJECT),
      binding(OTHER_BINDING, OTHER_ORG, OTHER_PROJECT),
    ],
    external_domain_ownership: [],
    external_sync_watermarks: [],
    erp_sweep_full_run: [
      { org_id: ORG, completed_at: new Date(NOW - 10 * 60_000).toISOString() },
      { org_id: OTHER_ORG, completed_at: new Date(NOW - 10 * 60_000).toISOString() },
    ],
    budget_versions: [
      liveBudgetShape(ORG, PROJECT, VERSION),
      liveBudgetShape(OTHER_ORG, OTHER_PROJECT, OTHER_VERSION),
    ],
    projects: [
      { id: PROJECT, org_id: ORG, start_date: '2026-02-01', end_date: '2026-11-30' },
      { id: OTHER_PROJECT, org_id: OTHER_ORG, start_date: '2026-02-01', end_date: '2026-11-30' },
    ],
    budget_line_items: [
      { id: 'd0000000-0000-4000-8000-000000000001', budget_version_id: VERSION, category: 'Labor', budgeted_amount: '90000.00', fiscal_year: null },
      { id: 'd0000000-0000-4000-8000-000000000002', budget_version_id: OTHER_VERSION, category: 'Labor', budgeted_amount: '90000.00', fiscal_year: null },
    ],
    budget_category_account_map: [
      ...(args.dropCategoryMapping
        ? []
        : [{ id: 'e0000000-0000-4000-8000-000000000001', org_id: ORG, category: 'Labor', erp_account: ACCOUNT, is_push_target: true }]),
      { id: 'e0000000-0000-4000-8000-000000000002', org_id: OTHER_ORG, category: 'Labor', erp_account: ACCOUNT, is_push_target: true },
    ],
    budget_distribution_plans: [
      {
        org_id: ORG, budget_version_id: VERSION, method: 'by_days', inputs: {},
        basis: { projectStart: '2026-02-01', projectEnd: '2026-11-30', years: [{ name: FY, start: '2026-01-01', end: '2026-12-31' }] },
        category_overrides: {},
      },
      {
        org_id: OTHER_ORG, budget_version_id: OTHER_VERSION, method: 'by_days', inputs: {},
        basis: { projectStart: '2026-02-01', projectEnd: '2026-11-30', years: [{ name: FY, start: '2026-01-01', end: '2026-12-31' }] },
        category_overrides: {},
      },
    ],
    budget_year_distributions: [
      { id: 'f0000000-0000-4000-8000-000000000001', org_id: ORG, budget_version_id: VERSION, category: 'Labor', fiscal_year: FY, ordinal: 0, amount: '90000.00', method: 'by_days', is_override: false },
      { id: 'f0000000-0000-4000-8000-000000000002', org_id: OTHER_ORG, budget_version_id: OTHER_VERSION, category: 'Labor', fiscal_year: FY, ordinal: 0, amount: '90000.00', method: 'by_days', is_override: false },
    ],
    // ⚑ The parked state under test: a durable account unit queued by the 202 gate, no outbox row.
    budget_version_account_erp_mirror: [
      waitingUnit(1, ORG, BINDING, PROJECT, VERSION),
      waitingUnit(2, OTHER_ORG, OTHER_BINDING, OTHER_PROJECT, OTHER_VERSION),
      ...(args.orgOneDroppedAccount
        ? [{
          ...waitingUnit(3, ORG, BINDING, PROJECT, VERSION),
          erp_account: args.orgOneDroppedAccount,
          budget_intent: 'remove',
        }]
        : []),
    ],
    budget_version_erp_mirror: [],
    budget_archive_cancel_intents: [
      ...args.orgOneIntents.map((state, index) => intent(10 + index, ORG, PROJECT, VERSION, ACTOR, state)),
      ...(args.manualArchiveBy
        ? [intent(40, ORG, PROJECT, PREDECESSOR, args.manualArchiveBy, 'complete', '2026-10-20T09:00:05.000Z')]
        : []),
      ...(args.orgTwoIntents ?? []).map((state, index) => intent(20 + index, OTHER_ORG, OTHER_PROJECT, OTHER_VERSION, OTHER_ACTOR, state)),
    ],
    budget_archive_requests: [
      ...orgOneRequests,
      ...manualRequest,
      ...priorActivationRequest,
      // The other org's own activation-queued request, so its parked unit is parked on the FENCE (still
      // pending), never on a missing activator.
      request(50, OTHER_ORG, OTHER_PROJECT, PREDECESSOR, OTHER_ACTOR, true, ACTIVATED_AT),
    ],
    external_command_outbox: [],
    external_refs: [],
    notifications: [],
    profiles: [
      { id: 'a1111111-1111-4111-8111-111111111111', org_id: ORG, status: 'active', role: 'Finance' },
      { id: 'a1111111-1111-4111-8111-111111111112', org_id: OTHER_ORG, status: 'active', role: 'Finance' },
    ],
    error_events: [],
  };

  const tableRows = (table: string) => tables[table] ?? (tables[table] = []);
  const tableMatches = (table: string, url: URL) =>
    tableRows(table).filter((row) =>
      [...url.searchParams.entries()].every(([key, value]) => matchesFilter(row, key, value))
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

    if (url.hostname === 'supabase.synthetic.test') {
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const rpc = decodeURIComponent(url.pathname.slice('/rest/v1/rpc/'.length));
        const params = (body ?? {}) as Row;
        if (rpc === 'read_vault_secret') return jsonResponse('synthetic-api-key:synthetic-api-secret');
        if (rpc === 'org_has_active_erpnext_binding' || rpc === 'domain_owned_by_tier') return jsonResponse(true);
        if (rpc === 'actor_authorization_state') return jsonResponse(args.actorState ?? { role: 'Finance', active: true });
        if (rpc === 'outbox_reconcile_candidates') return jsonResponse([]);
        if (rpc === 'outbox_retry_pending') return jsonResponse([]);
        if (rpc === 'claim_erp_sweep_lock' || rpc === 'release_erp_sweep_lock' || rpc === 'mark_erp_full_sweep_done') {
          return jsonResponse(true);
        }
        if (rpc === 'claim_outbox_for_commit') {
          const row = tableRows('external_command_outbox').find((candidate) => candidate.id === params.p_id);
          if (!row || !['pending', 'failed'].includes(String(row.state))) return jsonResponse(null);
          row.state = 'committing';
          row.claim_generation = Number(row.claim_generation ?? 0) + 1;
          return jsonResponse(outboxWireRow(row));
        }
        if (rpc === 'read_budget_range_outbox_state') {
          const row = tableRows('external_command_outbox').find((candidate) => candidate.id === params.p_id);
          if (!row || row.state !== 'committing' || row.claim_generation !== params.p_generation
              || row.payload_digest !== params.p_payload_digest || row.pmo_record_id !== params.p_identity) return jsonResponse(null);
          return jsonResponse(row.budget_range_operation ?? null);
        }
        if (rpc === 'advance_budget_range_outbox_stage') {
          const row = tableRows('external_command_outbox').find((candidate) => candidate.id === params.p_id);
          const rangeOperation = row?.budget_range_operation as Row | undefined;
          if (!row || row.state !== 'committing' || row.claim_generation !== params.p_generation
              || row.payload_digest !== params.p_payload_digest || row.pmo_record_id !== params.p_identity
              || (rangeOperation?.stage ?? null) !== params.p_expected_stage) return jsonResponse(false);
          row.budget_range_operation = params.p_next;
          return jsonResponse(true);
        }
        if (rpc === 'quarantine_committing') return jsonResponse(null);
        if (rpc === 'record_outbox_ref') {
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
          const row = tableRows('external_command_outbox').find((candidate) => candidate.id === params.p_id);
          if (row) row.state = 'confirmed';
          return jsonResponse(row ? 1 : 0);
        }
        if (rpc === 'mark_outbox_held') {
          const row = tableRows('external_command_outbox').find((candidate) => candidate.id === params.p_id);
          if (row) row.state = 'held';
          return jsonResponse(row ? 1 : 0);
        }
        return jsonResponse(null);
      }

      const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
      // ⚑ M-4 — the fence can become UNSETTLED again between the resume's own check and the gate's
      // re-check inside it (a late cancellation reaching ERP). Simulate that ordering exactly.
      if (table === 'budget_archive_cancel_intents' && method === 'GET') {
        fenceReads += 1;
        if (args.unsettleFenceOnRead && fenceReads >= args.unsettleFenceOnRead) {
          for (const row of tableRows('budget_archive_cancel_intents')) row.state = 'pending';
        }
      }
      const rows = tableMatches(table, url);
      if (method === 'GET') {
        if (request.headers.get('Accept')?.includes('vnd.pgrst.object')) return jsonResponse(rows[0] ?? null);
        return jsonResponse(rows);
      }
      if (method === 'POST') {
        const inserts = Array.isArray(body) ? body as Row[] : [body as Row];
        const written: Row[] = [];
        for (const insert of inserts) {
          const row = { ...insert };
          if (table === 'external_command_outbox') {
            row.id = row.id ?? 'd0000000-0000-4000-8000-' + (++nextOutboxId).toString().padStart(12, '0');
            row.claim_generation = 0;
            row.external_record_id = null;
            row.canonical = null;
          }
          const conflictKeys = url.searchParams.get('on_conflict')?.split(',') ?? ['id'];
          const existing = tableRows(table).find((candidate) =>
            conflictKeys.every((key) => candidate[key] !== undefined && candidate[key] === row[key])
          );
          if (existing && request.headers.get('Prefer')?.includes('resolution=merge-duplicates')) {
            Object.assign(existing, row);
          } else if (!existing) {
            tableRows(table).push(row);
          }
          written.push(existing ?? row);
        }
        if (request.headers.get('Accept')?.includes('vnd.pgrst.object')) return jsonResponse(written[0] ?? null);
        return jsonResponse(written);
      }
      if (method === 'PATCH') {
        const patch = (body ?? {}) as Row;
        for (const row of rows) Object.assign(row, patch);
        return jsonResponse(request.headers.get('Prefer')?.includes('return=representation') ? rows : null);
      }
      if (method === 'DELETE') {
        const selected = new Set(rows);
        tables[table] = tableRows(table).filter((row) => !selected.has(row));
        return jsonResponse(null);
      }
      return jsonResponse({ message: 'unsupported synthetic database method' }, 500);
    }

    if (url.hostname === 'erp.synthetic.test') {
      const path = decodeURIComponent(url.pathname);
      if (path === '/api/method/frappe.auth.get_logged_user') return jsonResponse({ message: 'api-user' });
      if (path === '/api/resource/Fiscal Year') {
        return jsonResponse({ data: [{ name: FY, year_start_date: '2026-01-01', year_end_date: '2026-12-31' }] });
      }
      if (path === '/api/method/frappe.client.submit') {
        const doc = (body as { doc?: Row } | null)?.doc;
        const name = String(doc?.name ?? '');
        const existing = budgets.get(name);
        assert(!!existing, 'a submit must name a document this fixture created');
        existing.docstatus = 1;
        existing.modified = '2026-10-28 00:00:01.000000';
        erpSubmits.push(name);
        return jsonResponse({ data: existing });
      }
      if (path === '/api/resource/Budget' && method === 'POST') {
        const name = 'BUD-RESUMED-' + (++nextBudgetId);
        const created: ErpBudgetDoc = {
          name, owner: 'api-user', docstatus: 0, modified: '2026-10-28 00:00:00.000000',
          ...(body as Row),
        };
        delete (created as Row).name;
        created.name = name;
        budgets.set(name, created);
        erpCreates.push({ name, body: (body ?? {}) as Row });
        return jsonResponse({ data: { name } });
      }
      if (path.startsWith('/api/resource/Budget/')) {
        const name = path.slice('/api/resource/Budget/'.length);
        const existing = budgets.get(name);
        if (!existing) {
          return jsonResponse({ exception: 'frappe.exceptions.DoesNotExistError' }, 404);
        }
        if (method === 'PUT') {
          Object.assign(existing, (body ?? {}) as Row);
          existing.modified = '2026-10-28 00:00:01.000000';
        }
        return jsonResponse({ data: existing });
      }
      if (path === '/api/resource/Budget') {
        return jsonResponse({ data: [...budgets.values()] });
      }
      return jsonResponse({ data: [] });
    }

    return jsonResponse({ message: 'unexpected synthetic host ' + url.hostname }, 500);
  };

  async function invoke(): Promise<Response> {
    const handler = shippedHandler;
    if (!handler) throw new Error('registered handler from the shipped index.ts was not captured');
    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    const denoEnv = (globalThis.Deno as unknown as { env: { get: (name: string) => string | undefined } }).env;
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
          headers: { Authorization: 'Bearer ' + SWEEP_SECRET, 'Content-Type': 'application/json' },
          body: '{}',
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
      Date.now = originalNow;
      denoEnv.get = originalEnvGet;
    }
  }

  return { tables, budgets, erpCreates, erpSubmits, invoke };
}

function unitRows(fixture: ReturnType<typeof makeFixture>, orgId: string): Row[] {
  return (fixture.tables.budget_version_account_erp_mirror as Row[]).filter((row) => row.org_id === orgId);
}

function outboxRows(fixture: ReturnType<typeof makeFixture>, orgId: string): Row[] {
  return (fixture.tables.external_command_outbox as Row[]).filter((row) => row.org_id === orgId);
}

const EXPECTED_IDENTITY = budgetRangeIdentity(VERSION, FY, FY, ACCOUNT);

Deno.test('rm-1472 a parked unit is resumed through the normal gate once its cancellations settle — exactly once across two ticks', async () => {
  const fixture = makeFixture({ orgOneIntents: ['complete'], orgTwoIntents: ['pending'] });

  const first = await fixture.invoke();
  assert(first.status === 200, `a valid tick must complete (got ${first.status})`);

  const outbox = outboxRows(fixture, ORG);
  assert(outbox.length === 1, `exactly one outbox row must be minted through the ordinary gate path: ${JSON.stringify(outbox)}`);
  assert(outbox[0]!.pmo_record_id === EXPECTED_IDENTITY,
    `the minted row must carry the gate's own year-qualified identity: ${JSON.stringify(outbox[0])}`);
  assert(typeof outbox[0]!.idempotency_key === 'string' && (outbox[0]!.idempotency_key as string).includes(VERSION),
    'the minted row must carry the server-derived push key');
  assert(outbox[0]!.actor_user_id === ACTIVATOR,
    `the resumed command must be attributed to the person who ACTIVATED the version, never minted unattributed: ${JSON.stringify(outbox[0])}`);
  assert(fixture.erpCreates.length === 1, `ERPNext must receive the replacement Budget: ${JSON.stringify(fixture.erpCreates)}`);
  assert(fixture.erpSubmits.length === 1, 'the replacement Budget must be submitted exactly once');

  const unit = unitRows(fixture, ORG)[0]!;
  assert(unit.push_state === 'pushed', `the parked unit must end pushed: ${JSON.stringify(unit)}`);
  assert(unit.push_error === null, `the wait must be cleared by the push itself: ${JSON.stringify(unit)}`);

  // ⚑ The other org's cancellation never settled, so its identical-looking unit must stay parked.
  const other = unitRows(fixture, OTHER_ORG)[0]!;
  assert(other.push_state === 'pending' && other.push_error === WAIT,
    `another org's unit must be untouched by this org's settled intents: ${JSON.stringify(other)}`);
  assert(outboxRows(fixture, OTHER_ORG).length === 0, 'another org must never get an outbox row from this org\'s state');

  // ⚑ THE SECOND TICK: once-only. A re-run must not mint a second ERP document or a second outbox row.
  const second = await fixture.invoke();
  assert(second.status === 200, `the second tick must complete (got ${second.status})`);
  assert(outboxRows(fixture, ORG).length === 1, 'a second tick must not mint a second outbox row');
  assert(fixture.erpCreates.length === 1, 'a second tick must not mint a second ERPNext Budget');
  assert(fixture.erpSubmits.length === 1, 'a second tick must not submit a second Budget');
});

Deno.test('rm-1472 a parked unit the re-derived plan no longer contains is retired, not left looking queued forever', async () => {
  const dropped = '5101 - Travel - Co';
  const fixture = makeFixture({ orgOneIntents: ['complete'], orgTwoIntents: ['pending'], orgOneDroppedAccount: dropped });

  const response = await fixture.invoke();
  assert(response.status === 200, `a valid tick must complete (got ${response.status})`);
  // The account at the centre of the defect is still pushed…
  const pushed = unitRows(fixture, ORG).find((row) => row.erp_account === ACCOUNT)!;
  assert(pushed.push_state === 'pushed', `the planned account must be pushed: ${JSON.stringify(pushed)}`);
  // …while the dropped account's remove unit is retired with a reason, never re-queued as if waiting.
  const retired = unitRows(fixture, ORG).find((row) => row.erp_account === dropped)!;
  assert(retired.push_state === 'held',
    `a plan-absent parked unit must be parked with a reason, not left "queued": ${JSON.stringify(retired)}`);
  assert(retired.push_error === 'budget-archive-cancellation-superseded',
    `the reason must say the account left the plan: ${JSON.stringify(retired)}`);
  assert(fixture.erpCreates.length === 1,
    `only the planned account reaches ERPNext: ${JSON.stringify(fixture.erpCreates)}`);

  // Retiring it is what stops the pass re-running the gate for it on every later tick.
  const second = await fixture.invoke();
  assert(second.status === 200, `the second tick must complete (got ${second.status})`);
  assert(fixture.erpCreates.length === 1, 'a retired unit must not be pushed later either');
});

Deno.test('rm-1472 an unsettled cancellation keeps the unit waiting and never holds it', async () => {
  const fixture = makeFixture({ orgOneIntents: ['pending'], orgTwoIntents: ['pending'] });

  const response = await fixture.invoke();
  assert(response.status === 200, `a valid tick must complete (got ${response.status})`);

  assert(outboxRows(fixture, ORG).length === 0, 'nothing may be minted while the cancellation is unresolved');
  assert(fixture.erpCreates.length === 0, 'ERPNext must not receive a replacement before the cancellation settles');
  const unit = unitRows(fixture, ORG)[0]!;
  assert(unit.push_state === 'pending',
    `a legitimate wait must never be relabelled held: ${JSON.stringify(unit)}`);
  assert(unit.push_error === WAIT, `the wait reason must survive the tick: ${JSON.stringify(unit)}`);
});

Deno.test('rm-1472 a held cancellation stops the wait with a reason a person can act on, and pushes nothing', async () => {
  const fixture = makeFixture({ orgOneIntents: ['held'], orgTwoIntents: ['pending'] });

  const response = await fixture.invoke();
  assert(response.status === 200, `a valid tick must complete (got ${response.status})`);

  assert(outboxRows(fixture, ORG).length === 0, 'a held cancellation must not be pushed past');
  assert(fixture.erpCreates.length === 0, 'ERPNext must receive nothing while a cancellation needs a person');
  const unit = unitRows(fixture, ORG)[0]!;
  assert(unit.push_state === 'held',
    `a cancelled-and-held intent must park the unit for an operator: ${JSON.stringify(unit)}`);
  assert(unit.push_error === 'budget-archive-cancellation-held',
    `the hold must name WHY it needs a person: ${JSON.stringify(unit)}`);
  const notices = fixture.tables.notifications as Row[];
  assert(notices.some((notice) =>
      ((notice.metadata as Row | undefined)?.action_required === 'budget-archive-cancellation-held')
      || String(notice.reason ?? notice.kind ?? '').includes('budget-archive-cancellation-held')),
    `the operator surface must be raised: ${JSON.stringify(notices)}`);
});

Deno.test('rm-1472/I-1 the resumed mint belongs to the ACTIVATION’s author, not to whoever last archived on the project', async () => {
  // The concrete case review r8 named: a MANUAL archive by someone else lands after this activation and
  // its settled intent is the newest on the project. Reading the actor off the project's latest intent
  // (the shipped behaviour) mints the replacement Budget as that manual archiver — an SoD breach when
  // they drafted the version, and a hold when they have since been deactivated.
  const fixture = makeFixture({
    orgOneIntents: ['complete'],
    orgTwoIntents: ['pending'],
    manualArchiveBy: MANUAL_ARCHIVER,
  });

  const response = await fixture.invoke();
  assert(response.status === 200, `a valid tick must complete (got ${response.status})`);

  const outbox = outboxRows(fixture, ORG);
  assert(outbox.length === 1, `the parked unit must be resumed once: ${JSON.stringify(outbox)}`);
  assert(outbox[0]!.actor_user_id === ACTIVATOR,
    `the resumed push is the ACTIVATOR's act: a later manual archive must not become its author (got ${String(outbox[0]!.actor_user_id)})`);
  assert(String(outbox[0]!.actor_user_id) !== MANUAL_ARCHIVER,
    'the manual archiver must never be attributed with a push they did not make');
  assert(fixture.erpCreates.length === 1, 'the replacement Budget is minted exactly once');
});

Deno.test('rm-1472/I-1 an EARLIER activation’s queued request on the project does not capture this version’s attribution', async () => {
  // Same project, same `queued_by_activation` flag, a different transaction stamp: only the request
  // created in the transaction that stamped THIS version's `activated_at` may supply the actor.
  const fixture = makeFixture({
    orgOneIntents: ['complete'],
    orgTwoIntents: ['pending'],
    priorActivationRequestBy: MANUAL_ARCHIVER,
  });

  const response = await fixture.invoke();
  assert(response.status === 200, `a valid tick must complete (got ${response.status})`);

  const outbox = outboxRows(fixture, ORG);
  assert(outbox.length === 1, `the older activation's request must not suppress this resume: ${JSON.stringify(outbox)}`);
  assert(outbox[0]!.actor_user_id === ACTIVATOR,
    `the actor comes from the request created at THIS version's activation stamp: ${JSON.stringify(outbox[0])}`);
});

Deno.test('rm-1472/I-1 an activation that recorded no activator holds the units — a resume never guesses an author', async () => {
  // This activation queued no cancellation of its own (a manual archive was still in flight), so no
  // `budget_archive_requests` row names it and NOBODY is recorded as its activator.
  const fixture = makeFixture({ orgOneIntents: ['complete'], orgTwoIntents: ['pending'], activationRequest: 'none' });

  const response = await fixture.invoke();
  assert(response.status === 200, `a valid tick must complete (got ${response.status})`);

  assert(outboxRows(fixture, ORG).length === 0, 'an unattributable push must never be minted');
  assert(fixture.erpCreates.length === 0, 'ERPNext must receive nothing under a guessed actor');
  const unit = unitRows(fixture, ORG)[0]!;
  assert(unit.push_state === 'held' && unit.push_error === 'budget-archive-cancellation-held',
    `with no recorded activator the unit is held for a person: ${JSON.stringify(unit)}`);
  const notices = fixture.tables.notifications as Row[];
  assert(notices.some((notice) => (notice.metadata as Row | undefined)?.action_required === 'budget-archive-cancellation-held'),
    `the operator surface must be raised: ${JSON.stringify(notices)}`);
  const heldBody = String(notices.find((notice) => (notice.metadata as Row | undefined)?.action_required === 'budget-archive-cancellation-held')?.body ?? '');
  assert(heldBody.length > 40 && !heldBody.includes('budget-archive-cancellation-held'),
    `the notification body must explain what a person can do: ${heldBody}`);
});

Deno.test('rm-1472/I-1 two requests claiming the same activation stamp are ambiguous — held, never guessed', async () => {
  const fixture = makeFixture({ orgOneIntents: ['complete'], orgTwoIntents: ['pending'], activationRequest: 'ambiguous' });

  const response = await fixture.invoke();
  assert(response.status === 200, `a valid tick must complete (got ${response.status})`);

  assert(outboxRows(fixture, ORG).length === 0, 'an ambiguous attribution must not pick one of the two');
  assert(fixture.erpCreates.length === 0, 'ERPNext must receive nothing under a guessed actor');
  const unit = unitRows(fixture, ORG)[0]!;
  assert(unit.push_state === 'held', `an ambiguous activation is a hold: ${JSON.stringify(unit)}`);
});

Deno.test('rm-1472/M-2 an activator who may no longer push is held under its OWN reason, not "cancellation held"', async () => {
  const fixture = makeFixture({
    orgOneIntents: ['complete'],
    orgTwoIntents: ['pending'],
    // The activator is an active member, but their CURRENT role cannot push a budget.
    actorState: { role: 'Engineer', active: true },
  });

  const response = await fixture.invoke();
  assert(response.status === 200, `a valid tick must complete (got ${response.status})`);

  assert(outboxRows(fixture, ORG).length === 0, 'a deauthorized activator must not push anything');
  assert(fixture.erpCreates.length === 0, 'ERPNext must receive nothing from an unauthorized actor');
  const unit = unitRows(fixture, ORG)[0]!;
  assert(unit.push_state === 'held', `the unit is held for a person: ${JSON.stringify(unit)}`);
  assert(unit.push_error === 'budget-archive-resume-actor-unauthorized',
    `the reason must name the ACTOR, since the cancellation itself is settled: ${JSON.stringify(unit)}`);
  const notices = fixture.tables.notifications as Row[];
  const raised = notices.filter((notice) => (notice.metadata as Row | undefined)?.action_required === 'budget-archive-resume-actor-unauthorized');
  assert(raised.length > 0, `the operator surface must carry the same distinct reason: ${JSON.stringify(notices)}`);
  // M-2 — the notice carries a SENTENCE, not the code echoed back at the operator.
  const body = String(raised[0]!.body ?? '');
  assert(body.length > 40 && !body.includes('budget-archive-resume-actor-unauthorized'),
    `the notification body must explain what to do: ${body}`);
});

Deno.test('rm-1472/M-4 the gate refusing on resume (422) pushes nothing and leaves the units parked', async () => {
  // The category→account mapping was removed after activation, so the re-derived gate refuses. The
  // resume must NOT swallow that into a hold: the units stay on the wait marker and a later tick retries
  // once a person fixes the mapping (the FR-BFY-075 posture).
  const fixture = makeFixture({ orgOneIntents: ['complete'], orgTwoIntents: ['pending'], dropCategoryMapping: true });

  const response = await fixture.invoke();
  assert(response.status === 200, `a valid tick must complete (got ${response.status})`);

  assert(outboxRows(fixture, ORG).length === 0, 'a refused gate must not mint an outbox row');
  assert(fixture.erpCreates.length === 0, 'a refused gate must not reach ERPNext');
  const parked = unitRows(fixture, ORG).find((row) => row.erp_account === ACCOUNT)!;
  assert(parked.push_state === 'pending' && parked.push_error === WAIT,
    `a gate refusal leaves the unit PARKED so the pass retries by itself: ${JSON.stringify(parked)}`);

  // …and the gate's own refusal is recorded durably, never silently dropped.
  const refusals = unitRows(fixture, ORG).filter((row) => row.erp_account === '');
  assert(refusals.some((row) => row.push_state === 'failed' && row.push_error === 'budget-category-unmapped'),
    `the gate's durable refusal row must exist: ${JSON.stringify(refusals)}`);

  const second = await fixture.invoke();
  assert(second.status === 200, `the second tick must complete (got ${second.status})`);
  assert(fixture.erpCreates.length === 0, 'a still-refused gate keeps pushing nothing on later ticks');
});

Deno.test('rm-1472/M-4 a cancellation that became unsettled again mid-resume (202) keeps the units parked', async () => {
  // The fence read settled when the resume checked it, then a cancellation reached ERPNext before the
  // gate re-checked it inside the same resume. The gate answers 202 again: nothing is pushed, and the
  // units stay on the wait marker for the next tick.
  const fixture = makeFixture({ orgOneIntents: ['complete'], orgTwoIntents: ['pending'], unsettleFenceOnRead: 2 });

  const response = await fixture.invoke();
  assert(response.status === 200, `a valid tick must complete (got ${response.status})`);

  assert(outboxRows(fixture, ORG).length === 0, 'a re-parked 202 must not mint an outbox row');
  assert(fixture.erpCreates.length === 0, 'a re-parked 202 must not reach ERPNext');
  const unit = unitRows(fixture, ORG)[0]!;
  assert(unit.push_state === 'pending' && unit.push_error === WAIT,
    `an unsettled-again fence leaves the unit parked, never held: ${JSON.stringify(unit)}`);
});
