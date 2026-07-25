/**
 * bfyServedFixture.ts (BFY Phase C) — the shared route table for the BFY served-boundary tests.
 *
 * ⚑ WHY THIS EXISTS. AC-BFY-009/030/027 all require the REAL `adapter-dispatch` handler (spec
 * NFR-BFY-TEST-001: "no AC hand-seeds a state the shipped writers cannot produce"), driven end to end
 * with `globalThis.fetch` mocked — the Supabase-documented edge-function testing shape the repo's
 * `edgeTestKit` already implements. Driving the shipped handler means satisfying EVERY read it makes
 * (JWKS → profiles → the two authorization RPCs → the binding → the gate's four reads → the ERP
 * calendar → the guards → the adapter's refs → the outbox → ERP → the mirror). That route table is
 * long, identical across the three tests, and belongs in one place; each test then varies only the
 * facts it is about.
 *
 * This file is a TEST FIXTURE (routes + seed data), never a re-implementation of handler logic — the
 * handler itself is always the shipped one, imported from `./index.ts`.
 */
import {
  erp,
  jsonResponse,
  supabaseRpc,
  supabaseSelect,
  type FetchCall,
  type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';

export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
export const VERSION_ID = '44444444-4444-4444-8444-444444444444';
export const ACTIVATED_AT = '2026-05-01T10:00:00+00:00';
/** `Date.parse('2026-05-01T10:00:00+00:00')` — the per-year key's epoch segment (FR-BFY-031). */
export const ACTIVATED_AT_EPOCH_MS = Date.parse(ACTIVATED_AT);

export const ERP_HOST = 'erp.bfy.test';
export const ERP_SITE_URL = `https://${ERP_HOST}`;
export const SECRET_REF = 'bfy-bench';
export const COMPANY = 'ACME Ltd';
export const ERP_PROJECT = 'ERP-PROJ-1';

/** A `Fiscal Year` row exactly as the client's own doctype returns it. */
export interface FiscalYear {
  name: string;
  year_start_date: string;
  year_end_date: string;
}

export interface LineItem {
  id: string;
  category: string;
  budgeted_amount: string;
  fiscal_year: string | null;
}

export interface ServedSeed {
  fiscalYears: FiscalYear[];
  lineItems: LineItem[];
  categoryMap: Array<{ category: string; erp_account: string }>;
  projectStartDate: string | null;
  projectEndDate: string | null;
  /** ERP `Budget` rows already occupying the grain, per fiscal year (the FR-BUD-121 upsert probe). */
  grainByFiscalYear?: Record<string, Array<Record<string, unknown>>>;
  /** `external_refs.pmo_record_id` → external record id (the PMO ownership witness, FR-BFY-076). */
  externalRefs?: Record<string, string>;
}

/** The 2-fiscal-year, fully-phased seed AC-BFY-009 is about. */
export function twoYearPhasedSeed(overrides: Partial<ServedSeed> = {}): ServedSeed {
  return {
    fiscalYears: [
      { name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' },
      { name: '2027', year_start_date: '2027-01-01', year_end_date: '2027-12-31' },
    ],
    lineItems: [
      { id: 'li-1', category: 'Labor', budgeted_amount: '90000.00', fiscal_year: '2026' },
      { id: 'li-2', category: 'Materials', budgeted_amount: '50000.00', fiscal_year: '2027' },
    ],
    categoryMap: [
      { category: 'Labor', erp_account: '5100 - Labor - AL' },
      { category: 'Materials', erp_account: '5200 - Materials - AL' },
    ],
    projectStartDate: '2026-06-01',
    projectEndDate: '2027-06-30',
    ...overrides,
  };
}

function objectResponse(body: unknown): Response {
  return jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
}

/** `maybeSingle()` on an empty result: PostgREST answers `null` under the object accept header. */
function nullObjectResponse(): Response {
  return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
}

export interface ServedRoutesResult {
  routes: MockRoute[];
  /** Every ERP `Budget` document the mocked ERP now holds, in creation order. */
  erpBudgets: Array<{ name: string; body: Record<string, unknown>; docstatus: number }>;
}

/**
 * The full route table for one served budget dispatch. Every route is a fact about the world the
 * handler reads; nothing here re-implements a handler decision.
 */
export function servedRoutes(seed: ServedSeed): ServedRoutesResult {
  const erpBudgets: ServedRoutesResult['erpBudgets'] = [];
  let outboxSeq = 0;
  const outboxRows = new Map<string, Record<string, unknown>>();

  const routes: MockRoute[] = [
    // ── PMO reads ────────────────────────────────────────────────────────────────────────────────
    // Two different reads hit `profiles`: the caller's own org resolution (`.single()`) and the
    // action-required surface's Admin/Finance recipient list (a plain array).
    supabaseSelect('profiles', (call) =>
      call.url.searchParams.has('role')
        ? jsonResponse([{ id: USER_ID }])
        : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
    // AC-BUD-003 (mig 0160): budget authorizes on the ACTIVE erpnext binding, not the ownership flip —
    // authGuard now calls org_has_active_erpnext_binding for BINDING_GATED_DOMAINS. This org is employing
    // (external_org_bindings mocked active below), so the predicate is true.
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(true)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
    supabaseSelect('external_org_bindings', () =>
      objectResponse({
        site_url: ERP_SITE_URL,
        secret_ref: SECRET_REF,
        activated_at: '2026-01-01T00:00:00+00:00',
        version_major: 15,
        config: { company: COMPANY, project_map: { [PROJECT_ID]: ERP_PROJECT } },
      })),
    supabaseSelect('budget_versions', () =>
      objectResponse({
        id: VERSION_ID,
        org_id: ORG_ID,
        project_id: PROJECT_ID,
        status: 'Active',
        activated_at: ACTIVATED_AT,
      })),
    supabaseSelect('projects', () =>
      objectResponse({
        id: PROJECT_ID,
        org_id: ORG_ID,
        start_date: seed.projectStartDate,
        end_date: seed.projectEndDate,
      })),
    // Keyset-paged (`fetchAllRowsByKeyset`): page 1 is every row, page 2 (id=gt.<last>) is empty.
    supabaseSelect('budget_line_items', (call) =>
      jsonResponse(call.url.searchParams.has('id') ? [] : seed.lineItems)),
    supabaseSelect('budget_category_account_map', () => jsonResponse(seed.categoryMap)),
    // Both directions are asked: `resolveExternalRef` (pmo_record_id → external_record_id, the
    // create-target guard) and `findPmoRecordId` (external_record_id → pmo_record_id, the FR-BFY-076
    // ownership witness).
    supabaseSelect('external_refs', (call) => {
      const eq = (p: string) => {
        const raw = call.url.searchParams.get(p);
        return raw?.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : (raw ?? null);
      };
      const refs = seed.externalRefs ?? {};
      const pmoRecordId = eq('pmo_record_id');
      if (pmoRecordId !== null) {
        const mapped = refs[pmoRecordId];
        return mapped ? objectResponse({ external_record_id: mapped }) : nullObjectResponse();
      }
      const externalRecordId = eq('external_record_id');
      const owner = Object.entries(refs).find(([, ext]) => ext === externalRecordId)?.[0];
      return owner ? objectResponse({ pmo_record_id: owner }) : nullObjectResponse();
    }),

    // ── the money outbox ─────────────────────────────────────────────────────────────────────────
    {
      label: 'outbox read',
      method: 'GET',
      pathname: '/rest/v1/external_command_outbox',
      response: (call) => {
        const key = outboxKeyOf(call);
        const row = outboxRows.get(key);
        return row ? objectResponse(row) : nullObjectResponse();
      },
    },
    {
      label: 'outbox insert',
      method: 'POST',
      pathname: '/rest/v1/external_command_outbox',
      response: (call) => {
        const body = call.bodyJson as Record<string, unknown>;
        const row = {
          id: `outbox-${++outboxSeq}`,
          domain: body.domain,
          pmo_record_id: body.pmo_record_id,
          idempotency_key: body.idempotency_key,
          state: 'pending',
          external_record_id: null,
          canonical: null,
          claim_generation: 0,
          payload_digest: body.payload_digest ?? null,
        };
        outboxRows.set(`${String(body.pmo_record_id)}|${String(body.idempotency_key)}`, row);
        return objectResponse(row);
      },
    },
    {
      label: 'outbox update (committed/failed)',
      method: 'PATCH',
      pathname: '/rest/v1/external_command_outbox',
      response: () => jsonResponse([{ id: 'outbox-updated' }]),
    },
    supabaseRpc('claim_outbox_for_commit', (call) => {
      const id = String((call.bodyJson as { p_id?: unknown })?.p_id ?? '');
      const row = [...outboxRows.values()].find((r) => r.id === id);
      return jsonResponse(row ? { ...row, state: 'committing', claim_generation: 1 } : null);
    }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('confirm_outbox', () => jsonResponse(1)),

    // ── the read-model mirror + the operator surface ─────────────────────────────────────────────
    {
      label: 'budget mirror upsert',
      method: 'POST',
      pathname: '/rest/v1/budget_version_erp_mirror',
      response: () => jsonResponse([]),
    },
    supabaseRpc('surface_action_required', () => jsonResponse(null)),
    {
      label: 'notifications (the action-required surface: de-dup read, then insert)',
      pathname: '/rest/v1/notifications',
      response: (call) => (call.method === 'GET' ? jsonResponse([]) : jsonResponse([])),
    },

    // ── ERPNext ──────────────────────────────────────────────────────────────────────────────────
    // `URL.pathname` percent-encodes the space in the `Fiscal Year` doctype path.
    erp(ERP_HOST, '/api/resource/Fiscal%20Year', () => jsonResponse({ data: seed.fiscalYears })),
    {
      label: 'ERP Budget grain probe / create',
      host: ERP_HOST,
      pathname: '/api/resource/Budget',
      response: (call) => {
        if (call.method === 'GET') {
          const filters = call.url.searchParams.get('filters') ?? '[]';
          const fy = fiscalYearOfFilters(filters);
          return jsonResponse({ data: (fy && seed.grainByFiscalYear?.[fy]) ?? [] });
        }
        const body = (call.bodyJson ?? {}) as Record<string, unknown>;
        const name = `BUDGET-${erpBudgets.length + 1}`;
        erpBudgets.push({ name, body, docstatus: 0 });
        return jsonResponse({ data: { ...body, name, docstatus: 0 } });
      },
    },
    {
      label: 'ERP Budget submit / read-back',
      host: ERP_HOST,
      pathname: /^\/api\/resource\/Budget\/.+$/,
      response: (call) => {
        const name = decodeURIComponent(call.url.pathname.split('/').pop() ?? '');
        const doc = erpBudgets.find((b) => b.name === name);
        if (call.method === 'PUT') {
          const patch = (call.bodyJson ?? {}) as { docstatus?: number };
          if (doc && typeof patch.docstatus === 'number') doc.docstatus = patch.docstatus;
        }
        return jsonResponse({ data: { ...(doc?.body ?? {}), name, docstatus: doc?.docstatus ?? 1 } });
      },
    },
  ];

  return { routes, erpBudgets };
}

/** `?pmo_record_id=eq.<id>&idempotency_key=eq.<key>` → the map key the fixture stores rows under. */
function outboxKeyOf(call: FetchCall): string {
  const strip = (v: string | null) => (v && v.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : (v ?? ''));
  return `${strip(call.url.searchParams.get('pmo_record_id'))}|${strip(call.url.searchParams.get('idempotency_key'))}`;
}

/** The `fiscal_year` coordinate of a `listDocsByFilters` grain probe. */
function fiscalYearOfFilters(filters: string): string | null {
  try {
    const parsed = JSON.parse(filters) as Array<[string, string, unknown]>;
    const row = parsed.find((f) => f[0] === 'fiscal_year');
    return row ? String(row[2]) : null;
  } catch {
    return null;
  }
}

/** Install the ERP credential env pair this fixture's `secret_ref` names. */
export function installErpCredentials(): () => void {
  const prefix = SECRET_REF.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const previous = { key: Deno.env.get(`${prefix}_KEY`), secret: Deno.env.get(`${prefix}_SECRET`) };
  Deno.env.set(`${prefix}_KEY`, 'test-key');
  Deno.env.set(`${prefix}_SECRET`, 'test-secret');
  return () => {
    if (previous.key === undefined) Deno.env.delete(`${prefix}_KEY`);
    else Deno.env.set(`${prefix}_KEY`, previous.key);
    if (previous.secret === undefined) Deno.env.delete(`${prefix}_SECRET`);
    else Deno.env.set(`${prefix}_SECRET`, previous.secret);
  };
}
