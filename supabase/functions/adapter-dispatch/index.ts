/**
 * adapter-dispatch — Deno Edge Function entry point (ADR-0055 P0/P1, FR-EAS-023/033/042, FR-CUA-001).
 *
 * Thin wiring ONLY — the ordered write-through orchestration lives in the pure
 * `dispatchExternallyOwnedWrite` (pmo-portal/src/lib/adapterSeam/dispatch.ts), unit-tested under
 * dispatch.test.ts. This file is INTEGRATION-ONLY (not unit-tested) — verified by `deno check` +
 * the boot-smoke (the same contract as agent-dispatch/compose-view, ADR-0039/0044).
 *
 * Order (AC-EAS-033): org from JWT → adapter select → command invoke (NO org_id, AC-EAS-023) →
 * read-model update (service role) → external_refs record → return.
 *
 * `verify_jwt = true` (supabase/config.toml): the Supabase gateway already rejects an invalid/
 * missing JWT before this handler runs. The handler still resolves the CALLER's identity + org
 * itself — via a caller-JWT-scoped client (deputy auth, NOT service_role), the same
 * profiles-lookup-under-RLS pattern as compose-view/handler.ts Recon #4 — because the adapter
 * must NEVER receive org_id (FR-EAS-024): org context is bound HERE, above the adapter, and used
 * only for the machine-write helpers (read-model upsert + external_refs record), never passed
 * into `adapter.commit()`.
 *
 * P1 (ClickUp, Slice B): the `tasks` domain resolves its per-project external container binding +
 * status/member maps from `external_project_bindings` (service role) at request time, so its factory is async and
 * receives the caller's org + the parsed command — unlike the P0 `reference` factory (no args). The
 * `writeReadModel` helper below branches per `command.domain`: `tasks` upserts/updates the `tasks`
 * read-model row directly (mirroring ClickUp's completion date, FR-CUA-030 Finding 6); every other
 * domain keeps the P0 `external_reference_items` behavior byte-for-byte.
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dispatchExternallyOwnedWrite } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { createReferenceAdapter, REFERENCE_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/referenceAdapter.ts';
import { CLICKUP_TASKS_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/clickup/adapter.ts';
import { resolveClickUpDispatchAdapter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/dispatchFactory.ts';
import { ClickUpRateLimiter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/rateLimit.ts';
import { ERPNEXT_COMPANIES_DOMAIN, ERPNEXT_PROCUREMENT_DOMAIN, ERPNEXT_REVENUE_DOMAIN, ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { resolveErpDispatchAdapter } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import { resolveErpCredentials } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts';
// The runtime (kind)->{toBody,fromDoc} side table (task 5.2) — ADDITIVE across slices 3/4/5/6, each
// wiring only the kinds it owns; an un-wired kind is `commit-rejected` at commit time, never a
// silent no-op (adapter.ts's `requireBodyFns`). Slice 3's supplier/customer entries now live in this
// same shared table (doctypeBodies.ts) rather than a parallel local const — one side table, never two.
import { DOCTYPE_BODIES } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts';
import { DOCTYPE_REGISTRY, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import { probeErpByAnchorKey, probeErpByPaymentComposite } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.ts';
import { resolveExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { Adapter, AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { DispatchMoneyOutboxDeps, ExternalRefMapping } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { getReadModelWriter } from './readModelWriters.ts';
import { maybeFault, type FaultGate } from './faultSeams.ts';
import { isRevenueSiSubmitTransition, enforceSiSubmitSod } from './sodGuard.ts';
import { canonicalCommandDigest, createDbMoneyOutboxDeps } from './moneyOutboxDeps.ts';
import {
  verifyCallerJwt,
  bearerToken,
  JwtVerifyError,
  jwksFromUrl,
  type JwksResolver,
} from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';

// ADR-0057: one cached, rate-limited JWKS resolver, memoized across warm invocations. Built lazily
// so an empty SUPABASE_URL can't throw a URL error before the handler can return a typed 401/500.
let _jwks: JwksResolver | null = null;
function getJwks(supabaseUrl: string): JwksResolver {
  if (!_jwks) _jwks = jwksFromUrl(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  return _jwks;
}

/** The adapter-select context: the caller's org, the parsed command, and the service-role client for
 * per-request config lookups (project binding, external_refs resolution). Never used for adapter.commit(). */
interface AdapterSelectContext {
  orgId: string;
  command: AdapterCommand;
  serviceClient: SupabaseClient;
  /** Read-only pass-through so a tier's factory can wire an in-flow fault seam (e.g. ERPNext's
   *  two-step submit, task 2.14) — factories that don't need it (P0/P1) simply ignore this field. */
  faultGate: FaultGate;
}

type AdapterFactory = (ctx: AdapterSelectContext) => Promise<Adapter>;

// Shared across invocations of this isolate (module scope) — the token bucket's budget is real
// only if it persists across requests, not recreated per-call (NFR-CUA-PERF-003).
const clickUpRateLimiter = new ClickUpRateLimiter();

// ClickUp adapter factory (review fix #9): all ClickUp config/member resolution lives OPAQUELY in the
// pure `clickup/dispatchFactory.ts` — this dispatcher passes the caller's org + command + an injected
// service-client seam + ClickUp client deps and never sees ClickUp vocabulary (confinement, FR-CUA-012).
function resolveClickUpAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  return resolveClickUpDispatchAdapter({
    // The real supabase-js client structurally satisfies the factory's DispatchServiceClient seam at
    // runtime but is not nominally assignable (thenable PostgrestFilterBuilder); same cast idiom as the
    // machine-write helpers below.
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    command: ctx.command,
    fetchImpl: fetch,
    token: Deno.env.get('CLICKUP_API_TOKEN') ?? '',
    baseUrl: Deno.env.get('CLICKUP_API_BASE_URL') ?? undefined,
    rateLimiter: clickUpRateLimiter,
  });
}

// ERPNext adapter factory (task 2.14): one tier ('erpnext'), two PMO domains ('companies' and
// 'procurement') — the routeDomainWrite generalization (FR-ENA-010). No test/prod org is flipped
// (`external_domain_ownership` ships empty) except a served-fn e2e that seeds its own binding; a
// mis-flip would still resolve correctly (never a silent no-op), matching the `notWired`
// read-model-writer discipline (task 1.6) one layer up.
//
// Credentials (Slice 6 pre-task, NFR-ENA-SEC-002 — the flagged global placeholder is now REMOVED):
// each org's `external_org_bindings.secret_ref` NAMES a per-org function-secret pair; `resolveErpAdapter`
// reads that ref for the caller's org and resolves `<PREFIX>_KEY`/`<PREFIX>_SECRET` from function
// secrets (`resolveErpCredentials`), failing CLOSED (`config-rejected`) when either is unset — no
// single global credential, no cross-org key reuse. The binding row is authoritative for the ref; the
// factory (`resolveErpDispatchAdapter`) re-reads the SAME row for site_url/config/activation (its
// confinement invariant: it never reads secret_ref/env itself — the resolved creds are passed in).
const erpRateLimiter = { acquire: async () => {} };

interface ErpBindingRow {
  site_url: string;
  secret_ref: string;
}

async function resolveErpBindingRow(serviceClient: SupabaseClient, orgId: string): Promise<ErpBindingRow> {
  const { data, error } = await serviceClient
    .from('external_org_bindings')
    .select('site_url, secret_ref')
    .eq('org_id', orgId)
    .eq('external_tier', ERPNEXT_TIER)
    .maybeSingle();
  if (error || !data) {
    throw new AppError('no erpnext binding configured for this org', error?.code ?? 'BINDING_NOT_FOUND');
  }
  return data as ErpBindingRow;
}

async function resolveErpAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  const binding = await resolveErpBindingRow(ctx.serviceClient, ctx.orgId);
  const { apiKey, apiSecret } = resolveErpCredentials(binding.secret_ref, (key) => Deno.env.get(key));
  return resolveErpDispatchAdapter({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    command: ctx.command,
    fetchImpl: fetch,
    apiKey,
    apiSecret,
    rateLimiter: erpRateLimiter,
    // The (kind)->{toBody,fromDoc} side table (task 4.3): additive across slices 3-6, never a
    // per-slice edit to another kind's entry (confinement, FR-ENA-014).
    doctypeBodies: DOCTYPE_BODIES,
    // The 'after-submit-before-mirror' fault seam (FR-ENA-003): fires inside the adapter's two-step
    // submit, between the submit PUT and the post-submit re-fetch — the ONLY tier with a two-step
    // commit (P0/P1 have none, so they never wire this hook).
    afterSubmitHook: () => maybeFault('after-submit-before-mirror', ctx.faultGate),
  });
}

/**
 * Task 6.4 (ADR-0058) — the DB-backed money-idempotency outbox deps for ONE erpnext non-read-only
 * command. Re-resolves the org's binding (a second small read alongside `resolveErpAdapter`'s own —
 * an acceptable per-request cost for the isolation of never smuggling credentials between the two
 * concerns) purely to build the tier-specific `probeByRemarksKey` closure (ERPNext's `remarks`-stamp
 * anchor, ADR-0058 §3): the recovery probe needs the SAME client creds/site_url as the adapter plus
 * the command's `erp_doc_kind`'s doctype + `fromDoc` mapper — none of which the generic
 * `DispatchMoneyOutboxDeps` interface carries (it is tier-agnostic, `moneyOutboxDeps.ts`). Every other
 * outbox operation (claim/mark/verify/insert/read) is the tier-agnostic DB implementation.
 */
async function resolveErpMoneyOutboxDeps(ctx: AdapterSelectContext): Promise<DispatchMoneyOutboxDeps> {
  // The outbox `operation` column (0095) is CHECK-constrained to create|update|transition — 'delete'
  // never reaches it (the erpnext adapter itself rejects delete, OQ-8, cancel-only); reject loud here
  // too, before any DB write, rather than letting a raw CHECK-violation surface.
  if ((ctx.command.operation as string) === 'delete') {
    throw new AppError('erpnext adapter does not support delete — cancel-only (OQ-8)', 'commit-rejected');
  }
  const binding = await resolveErpBindingRow(ctx.serviceClient, ctx.orgId);
  const { apiKey, apiSecret } = resolveErpCredentials(binding.secret_ref, (key) => Deno.env.get(key));

  const kind = (ctx.command.record as { erp_doc_kind?: unknown }).erp_doc_kind;
  const entry = typeof kind === 'string' && kind in DOCTYPE_REGISTRY ? DOCTYPE_REGISTRY[kind as ErpDocKind] : undefined;
  const bodyFns = typeof kind === 'string' ? DOCTYPE_BODIES[kind as ErpDocKind] : undefined;
  if (!entry || !bodyFns) {
    throw new AppError(`erpnext doctype body for '${String(kind)}' is not yet wired`, 'commit-rejected');
  }

  // `entry.anchorField === null` (live-bench finding, doctypeRegistry.ts): this doctype has no
  // queryable anchor field that survives ERPNext's validate — Frappe rejects the probe's filtered
  // GET outright (or, for PE's `remarks`, the stamp is silently overwritten). Skip the query
  // entirely (resolve null immediately) rather than issue an erroring request; the DB claim
  // (createDbMoneyOutboxDeps' claimOutboxForCommit) remains the sole R1 concurrent-duplicate guard
  // regardless, so this degrades only R3 orphan-adoption for these kinds. PI/Purchase Receipt anchor
  // on 'remarks'; Payment Entry anchors on 'reference_no' (the DIRECTOR RULING — PE's validate
  // overwrites remarks; reference_no survives, ADR-0058 §3 amended). Captured in a const here so the
  // probe closure sees the narrowed `string` type (entry.anchorField is `string | null` on the record).
  const anchorField = entry.anchorField;
  const client = { fetchImpl: fetch, apiKey, apiSecret, baseUrl: binding.site_url };
  const probeDeps = { client, doctype: entry.doctype, anchorField: anchorField ?? '', fromDoc: bodyFns.fromDoc, pmoRecordId: ctx.command.record.id };

  // C-1 (companies "<Doctype>:<name>" encoding): now that external_refs is written INSIDE the fenced
  // finalize_outbox RPC (H-1), the companies-domain doctype prefix that used to live in the
  // recordExternalRef wrapper is applied here, threaded into the fenced write (identity elsewhere).
  const encodeExternalRecordId = (mapping: ExternalRefMapping): string =>
    mapping.domain === ERPNEXT_COMPANIES_DOMAIN ? `${entry.doctype}:${mapping.externalRecordId}` : mapping.externalRecordId;

  // The outbox payload ALWAYS carries `erp_doc_kind` so the SWEEP recovery path can reconstruct the
  // command (the outbox has only domain+pmo_record_id, and a domain spans several kinds). A MUTABLE-anchor
  // money doc (Payment Entry) additionally persists its composite-probe inputs (party_type+party+
  // paid_amount+referenced-PI names + the claim-window start) so BOTH the sync retry and the sweep
  // resolve a landed PE deterministically from OUR OWN outbox payload — never from live state (C-1).
  const payload: Record<string, unknown> = {
    ...(ctx.command.record as Record<string, unknown>),
    erp_doc_kind: kind,
    ...(entry.anchorMutable ? await buildPaymentCompositePayload(ctx) : {}),
  };

  // M-3: bind the idempotency key to the exact payload persisted in the outbox (reject key-reuse
  // with a different amount/party/refs, including changes made to the persisted recovery payload).
  // `created_after` is a per-attempt probe-window bound, not command material; excluding it keeps
  // retries of the same persisted command stable while all money/party/reference fields remain bound.
  const { created_after: _createdAfter, ...digestPayload } = payload;
  const payloadDigest = await canonicalCommandDigest({
    domain: ctx.command.domain,
    operation: ctx.command.operation as string,
    record: digestPayload,
  });

  return createDbMoneyOutboxDeps({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    externalTier: ERPNEXT_TIER,
    operation: ctx.command.operation as 'create' | 'update' | 'transition',
    // C-1 per-kind reissue policy: a mutable-anchor (PE) inconclusive recovery is HELD, never reissued.
    reissueOnInconclusiveAbsence: !entry.anchorMutable,
    payload,
    payloadDigest,
    encodeExternalRecordId,
    probeByRemarksKey: !anchorField
      ? async () => null
      : !entry.anchorMutable
        // Immutable anchor (PI/Purchase Receipt `remarks`): the anchor `like` filter is conclusive.
        ? (_domain, idempotencyKey) => probeErpByAnchorKey(probeDeps, idempotencyKey)
        // Mutable anchor (PE `reference_no`): the COMPOSITE probe — anchor OR the deterministic
        // conjunction, every input read back from our persisted outbox payload (ADR-0058 §4 amended).
        // Handles both PE-pay (payment_type=Pay, pi_names) and PE-receive (payment_type=Receive, si_names).
        : async (domain, idempotencyKey) => {
            const p = await readOutboxCompositePayload(ctx.serviceClient, ctx.orgId, domain, ctx.command.record.id, idempotencyKey);
            if (!p || !p.party || p.paid_amount == null) return probeErpByAnchorKey(probeDeps, idempotencyKey);
            const paymentType = String(p.payment_type ?? 'Pay') as 'Pay' | 'Receive';
            return probeErpByPaymentComposite(probeDeps, idempotencyKey, {
              partyType: String(p.party_type ?? 'Supplier'),
              party: String(p.party),
              paidAmount: p.paid_amount as string | number,
              piNames: Array.isArray(p.pi_names) ? (p.pi_names as string[]) : [],
              siNames: Array.isArray(p.si_names) ? (p.si_names as string[]) : [],
              createdAfter: String(p.created_after ?? ''),
              paymentType,
            });
          },
  });
}

/** ERP `creation` filter format (`YYYY-MM-DD HH:MM:SS`) for the composite-probe claim window. */
function erpDatetime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** Build the Payment Entry composite-probe payload from the command (persisted at outbox INSERT).
 *  Handles both PE-pay (procurement) and PE-receive (revenue).
 *  - PE-pay: supplier `party` via external_refs (companies domain), `piNames` from `references`.
 *  - PE-receive: customer `party` via external_refs (companies domain), `siNames` from `references`.
 *  `created_after` bounds the candidate set to this attempt's window. */
async function buildPaymentCompositePayload(ctx: AdapterSelectContext): Promise<Record<string, unknown>> {
  const rec = ctx.command.record as Record<string, unknown>;
  const kind = typeof rec.erp_doc_kind === 'string' ? rec.erp_doc_kind : '';
  const isReceive = kind === 'incoming-payment';

  if (isReceive) {
    // PE-receive (revenue): customer party + SI references
    const customerPmoId = typeof rec.customerId === 'string' ? rec.customerId : undefined;
    let party: string | null = null;
    if (customerPmoId) {
      const resolved = await resolveExternalRef(ctx.serviceClient as never, ctx.orgId, ERPNEXT_COMPANIES_DOMAIN, customerPmoId);
      // external_refs stores companies "<Doctype>:<name>" encoding — strip to bare Customer name.
      party = resolved ? resolved.slice(resolved.indexOf(':') + 1) : null;
    }
    const siNames = Array.isArray(rec.references)
      ? (rec.references as Array<{ reference_name?: unknown }>).map((r) => String(r.reference_name)).filter((n) => n && n !== 'undefined')
      : [];
    return {
      party_type: 'Customer',
      party,
      paid_amount: rec.paid_amount ?? null,
      pi_names: [],
      si_names: siNames,
      payment_type: 'Receive',
      // A 1-minute pre-dispatch buffer so a doc created just before the outbox row is still in-window.
      created_after: erpDatetime(Date.now() - 60_000),
    };
  }

  // PE-pay (procurement): supplier party + PI references
  const supplierPmoId = typeof rec.supplier === 'string' ? rec.supplier : undefined;
  let party: string | null = null;
  if (supplierPmoId) {
    const resolved = await resolveExternalRef(ctx.serviceClient as never, ctx.orgId, ERPNEXT_COMPANIES_DOMAIN, supplierPmoId);
    party = resolved ? resolved.slice(resolved.indexOf(':') + 1) : null;
  }
  const piNames = Array.isArray(rec.references)
    ? (rec.references as Array<{ reference_name?: unknown }>).map((r) => String(r.reference_name)).filter((n) => n && n !== 'undefined')
    : [];
  return {
    party_type: 'Supplier',
    party,
    paid_amount: rec.paid_amount ?? null,
    pi_names: piNames,
    si_names: [],
    payment_type: 'Pay',
    created_after: erpDatetime(Date.now() - 60_000),
  };
}

/** Read the persisted composite-probe payload for one command's outbox row (the ruling's "read from our
 *  own outbox row payload"). Returns null when no row/payload exists yet (first attempt). */
async function readOutboxCompositePayload(
  serviceClient: SupabaseClient,
  orgId: string,
  domain: string,
  pmoRecordId: string,
  idempotencyKey: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await serviceClient
    .from('external_command_outbox')
    .select('payload')
    .eq('org_id', orgId)
    .eq('domain', domain)
    .eq('pmo_record_id', pmoRecordId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  return (data as { payload?: Record<string, unknown> | null } | null)?.payload ?? null;
}

// Adapter registry, keyed by the PMO domain the tier natively owns. 'reference' is the P0 synthetic
// domain (ADR-0055 §"out of scope"); 'tasks' is ClickUp's P1 domain (ADR-0055 P1, FR-CUA-001);
// 'companies'/'procurement' are ERPNext's P2 domains (FR-ENA-010, task 2.14).
const ADAPTER_REGISTRY: Record<string, AdapterFactory> = {
  [REFERENCE_DOMAIN]: async () => createReferenceAdapter('commit-success'),
  [CLICKUP_TASKS_DOMAIN]: resolveClickUpAdapter,
  [ERPNEXT_COMPANIES_DOMAIN]: resolveErpAdapter,
  [ERPNEXT_PROCUREMENT_DOMAIN]: resolveErpAdapter,
  [ERPNEXT_REVENUE_DOMAIN]: resolveErpAdapter,
};

// Same origin-narrowing seam as agent-chat/compose-view (AUDIT quick-win 2026-07-07): set
// AGENT_ALLOWED_ORIGIN in prod; falls back to SITE_URL, then '' (fail-closed — never '*').
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': Deno.env.get('AGENT_ALLOWED_ORIGIN') ?? Deno.env.get('SITE_URL') ?? '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  // ── 1. org from JWT (AC-EAS-033 step 1). Read the bearer (case-insensitive, shared parser). ──
  const jwt = bearerToken(req.headers.get('Authorization'));
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'missing Authorization header' }), {
      status: 401,
      headers,
    });
  }

  // Normalize a trailing slash so the derived issuer / JWKS URL never doubles a slash.
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }), {
      status: 500,
      headers,
    });
  }

  // Verify the caller JWT LOCALLY against the project JWKS (ADR-0057 — asymmetric ES256), replacing
  // the auth.getUser round-trip with a cached, local signature check to resolve the caller's `sub`.
  // verify_jwt=true still pre-filters invalid tokens at the gateway (defense in depth); this extracts
  // the verified user id without a second GoTrue call. Any signature/expiry/issuer/audience/alg
  // failure → a single typed 401. The active-member (ban/disable) check that auth.getUser used to
  // provide is NOT lost — it lives in the RLS gating the org lookup below (see that comment).
  let userId: string;
  try {
    const verified = await verifyCallerJwt(jwt, getJwks(supabaseUrl), {
      issuer: Deno.env.get('EDGE_JWT_ISSUER') ?? `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    userId = verified.sub;
  } catch (err) {
    const status = err instanceof JwtVerifyError ? err.status : 401;
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'invalid JWT' }), { status, headers });
  }

  // Deputy auth: org resolution runs under the CALLER's own JWT (RLS-scoped) — never service_role
  // (compose-view/handler.ts Recon #4 precedent). This RLS read is ALSO the active-member gate that
  // keeps dropping auth.getUser safe on this service_role / destructive path: profiles_select is
  // conjoined with is_active_member() (status='active', mig 0063 applies it to EVERY business-table
  // policy), so a disabled/offboarded caller (admin_set_user_status sets status='disabled', mig 0065)
  // resolves ZERO rows here → the `!profile` branch returns 400 and NO service_role write ever runs.
  // The active-member check thus lives in the RLS gating this lookup, not in getUser — consistent with
  // the app-wide is_active_member standard. (Verified empirically 2026-07-13: a disabled user's own
  // profile read returns []. Task-3 audit note: a raw dashboard `banned_until`-only ban that leaves
  // status='active' is outside the app-wide is_active_member model — an accepted app-wide posture, not
  // a gap unique to this function.)
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: profile, error: profileError } = await callerClient
    .from('profiles')
    .select('org_id')
    .eq('id', userId)
    .single();
  if (profileError || !profile) {
    return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'org not resolvable for caller' }), {
      status: 400,
      headers,
    });
  }
  const orgId = (profile as { org_id: string }).org_id;

  // ── 2. Parse the command body (PMO domain language; NEVER org_id — AC-EAS-023 proof surface). ──
  let command: AdapterCommand;
  try {
    command = (await req.json()) as AdapterCommand;
  } catch {
    return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'invalid JSON body' }), {
      status: 400,
      headers,
    });
  }
  if (!command?.domain || !command?.operation || !command?.record?.id) {
    return new Response(
      JSON.stringify({ error: 'BAD_REQUEST', message: 'domain, operation, and record.id are required' }),
      { status: 400, headers },
    );
  }

  // ── Server-side idempotency-key enforcement (task 6.4, FR-ENA-040, ADR-0058 §4) — at the top of
  // the served path, BEFORE any adapter-select/binding/credential resolution: a non-read-only erpnext
  // command with no idempotencyKey is rejected fast, never reaching the outbox or ERP. `dispatch.ts`'s
  // `dispatchMoneyWrite` re-asserts the identical guard (unit-tested, AC-ENA-012) — this is a
  // fail-fast duplicate at the integration boundary, not the sole enforcement point. P0/P1 (every
  // other domain) is unaffected.
  const isErpDomain = command.domain === ERPNEXT_COMPANIES_DOMAIN || command.domain === ERPNEXT_PROCUREMENT_DOMAIN || command.domain === ERPNEXT_REVENUE_DOMAIN;
  // `AdapterOperation` has no 'read' member (reads never reach this handler as a write command) —
  // the string cast mirrors dispatch.ts's own `(command.operation as string) !== 'read'` guard.
  if (isErpDomain && (command.operation as string) !== 'read' && !command.idempotencyKey) {
    return new Response(JSON.stringify({ error: 'commit-rejected', message: 'missing-idempotency-key' }), {
      status: 422,
      headers,
    });
  }

  // ── Luna BLOCK 2 — server-side Sales-Invoice submit SoD (FR-SAR-195, ADR-0019). `submitInvoice()`
  // in the repository already calls the SoD RPC for the legitimate FE path, but a caller POSTing the
  // dispatch command directly could skip it. Enforce SoD HERE, under the CALLER's JWT (the deputy
  // `callerClient`, never service_role — auth.uid()/auth_org_id() must resolve to the real submitter):
  // a revenue sales-invoice SUBMIT transition must pass `submit_sales_invoice(p_si_id)` BEFORE the
  // adapter commits the ERP submit. A 42501 (self-approval / not-authorized) closes the bypass — the
  // dispatch returns 403/409 and does NOT submit to ERP, regardless of which client dispatched.
  if (isRevenueSiSubmitTransition(command)) {
    const sod = await enforceSiSubmitSod(callerClient as never, String(command.record.id));
    if (!sod.ok) {
      const message = /sod|self-approval|approver|author|not authorized/i.test(sod.message) ? 'sod-self-approval' : sod.message;
      return new Response(JSON.stringify({ error: sod.status === 403 ? 'commit-rejected' : 'DISPATCH_FAILED', message }), {
        status: sod.status,
        headers,
      });
    }
  }

  // service_role client — used for the machine-write helpers (read-model upsert/update + external_refs
  // record) AND, for 'tasks', to resolve the per-request ClickUp binding/mapping at adapter-select time.
  // Never used for adapter.commit() — org_id never crosses into the adapter (AC-EAS-023).
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // ── Slice 3: process_gates enforcement (FR-SAR-191, AC-SAR-070).
  // Check require_project_on_si gate for revenue/sales-invoice create commands.
  // This runs BEFORE any adapter/outbox work so we reject fast without creating an outbox row.
  if (command.domain === ERPNEXT_REVENUE_DOMAIN 
      && (command.operation as string) === 'create' 
      && (command.record as { erp_doc_kind?: unknown }).erp_doc_kind === 'sales-invoice') {
    const { data: gatesData, error: gatesError } = await serviceClient
      .rpc('get_process_gates', { p_org: orgId });
    if (gatesError) {
      console.error('[adapter-dispatch] get_process_gates RPC failed:', gatesError);
      return new Response(JSON.stringify({ error: 'commit-rejected', message: 'gate-check-failed' }), {
        status: 422,
        headers,
      });
    }
    const gates = gatesData as { require_so_before_si: boolean; require_bast_before_si: boolean; require_project_on_si: boolean };
    if (gates.require_project_on_si) {
      const projectId = (command.record as { projectId?: string | null }).projectId ?? null;
      if (projectId === null) {
        return new Response(JSON.stringify({ error: 'commit-rejected', message: 'project-required' }), {
          status: 422,
          headers,
        });
      }
    }
    // SO/BAST gates are recognized but inert in P3a — log if enabled for visibility
    if (gates.require_so_before_si) {
      console.warn('[adapter-dispatch] require_so_before_si is true but not enforced in P3a (inert)');
    }
    if (gates.require_bast_before_si) {
      console.warn('[adapter-dispatch] require_bast_before_si is true but not enforced in P3a (inert)');
    }
  }

  // ── Named server-side fault seams (Slice 0 task 0.7, FR-ENA-003, plan §2 decision 5; host
  // allowlist added fix-round finding 5): read the gate ONCE per request and thread it through.
  // `maybeFault` re-checks ALL THREE conditions per named seam, so this is a pure no-op in every
  // deployed/non-test context (ERPNEXT_TEST_FAULTS unset, or ERPNEXT_TEST_FAULTS_ALLOW_HOST unset/
  // non-matching ⇒ byte-for-byte, zero behavior change for slice 0 — no org employs ERPNext yet).
  const faultGate: FaultGate = {
    envFaults: Deno.env.get('ERPNEXT_TEST_FAULTS'),
    header: req.headers.get('x-erpnext-test-fault'),
    requestHost: req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
    allowedHosts: Deno.env.get('ERPNEXT_TEST_FAULTS_ALLOW_HOST'),
  };

  // ── 3. Adapter select (AC-EAS-033 step 2). ──
  const adapterFactory = ADAPTER_REGISTRY[command.domain];
  if (!adapterFactory) {
    return new Response(
      JSON.stringify({ error: 'UNSUPPORTED_DOMAIN', message: `no adapter owns domain "${command.domain}"` }),
      { status: 400, headers },
    );
  }

  let adapter: Adapter;
  let money: DispatchMoneyOutboxDeps | undefined;
  try {
    adapter = await adapterFactory({ orgId, command, serviceClient, faultGate });
    // Task 6.4 (ADR-0058): every non-read-only erpnext command routes through the money-idempotency
    // outbox — `dispatchExternallyOwnedWrite` requires `money` to be set for this tier (it throws
    // "dispatched without outbox deps" otherwise, the exact failure this task closes). P0/P1 (every
    // other tier) never resolves this — `money` stays `undefined`, their path is byte-for-byte.
    if (adapter.tier === ERPNEXT_TIER && (command.operation as string) !== 'read') {
      money = await resolveErpMoneyOutboxDeps({ orgId, command, serviceClient, faultGate });
    }
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError(err instanceof Error ? err.message : 'adapter select failed');
    return new Response(JSON.stringify({ error: appError.code ?? 'ADAPTER_SELECT_FAILED', message: appError.message }), {
      status: 400,
      headers,
    });
  }

  // Fault-seam-injected wrapper (short-circuit before/at commit, FR-ENA-003): 'unreachable' /
  // 'reject-validation' / 'timeout' fire here, before the real adapter.commit() ever runs — each a
  // no-op unless its header matches. Wrapping the adapter (not editing dispatch.ts) means the seam's
  // thrown AdapterError still passes through dispatchExternallyOwnedWrite's own AdapterError→AppError
  // classification unmodified, so that pure/unit-tested module (dispatch.test.ts) needs no changes.
  const dispatchAdapter: Adapter = {
    ...adapter,
    commit: async (cmd: AdapterCommand) => {
      await maybeFault('unreachable', faultGate);
      await maybeFault('reject-validation', faultGate);
      await maybeFault('timeout', faultGate);
      return adapter.commit(cmd);
    },
  };

  try {
    // ── 4/5/6. command invoke → read-model update → external_refs record → return
    // (AC-EAS-033 steps 3/4/5, in that exact order — enforced inside dispatchExternallyOwnedWrite). ──
    const result = await dispatchExternallyOwnedWrite({
      adapter: dispatchAdapter,
      command,
      // Multi-domain read-model writer registry (task 1.6) — replaces the inline if-chain. An
      // unknown domain throws (no silent skip); ClickUp's `tasks` writer is byte-for-byte moved.
      writeReadModel: async (canonical: PmoRecord) => {
        // Fault seam: between commit and mirror (FR-ENA-003) — a no-op unless armed. Runs before
        // the per-domain mirror write; commit has already returned (dispatch.ts's fixed order).
        await maybeFault('after-commit-before-mirror', faultGate);
        // Multi-domain read-model writer registry (task 1.6) — supersedes slice 0's inline
        // if-chain (its ClickUp/reference branches moved byte-for-byte into readModelWriters.ts).
        const writer = getReadModelWriter(command.domain);
        await writer.upsert({ serviceClient: serviceClient as never, orgId }, canonical, command);
      },
      // Cast: the real supabase-js client's .from().upsert() returns a thenable
      // PostgrestFilterBuilder, not a plain Promise — structurally satisfies
      // ServiceRoleTableClient at runtime but is not nominally assignable (same
      // documented cast pattern as agent-dispatch/index.ts).
      //
      // Companies-domain STORAGE-layer encoding (task 6.4 fix-round, live-bench-discovered
      // 2026-07-12): `external_refs.external_record_id` for a party (Supplier/Customer) is ALWAYS
      // "<Doctype>:<name>" (task 3.2's collision rule, partyAdopt.ts's `externalIdFor` — the SAME
      // encoding `dispatchFactory.ts`'s `stripDoctypePrefix`/`stripPartyDoctypePrefix` already strip
      // back off on every READ path). The adapter's own return value (`mapping.externalRecordId`,
      // also the served-fn HTTP response body) stays the BARE ERP name (AC-ENA-040: Supplier autonames
      // by `field:supplier_name`) — only THIS write applies the prefix, never the wire contract.
      recordExternalRef: (mapping) => {
        const kind = (command.record as { erp_doc_kind?: unknown }).erp_doc_kind;
        const entry = typeof kind === 'string' && kind in DOCTYPE_REGISTRY ? DOCTYPE_REGISTRY[kind as ErpDocKind] : undefined;
        const externalRecordId =
          mapping.domain === ERPNEXT_COMPANIES_DOMAIN && entry ? `${entry.doctype}:${mapping.externalRecordId}` : mapping.externalRecordId;
        return recordExternalRefWrite(serviceClient as never, { ...mapping, externalRecordId, orgId });
      },
      // Delete-aware dispatch (Slice C, AC-CUA-038, FR-CUA-026): a ClickUp-native delete
      // tombstones the mirrored `tasks` row (OD-CUA-2) — dependency/milestone rows are
      // preserved (no cascade), and the external_refs mapping is kept as-is (dispatch.ts
      // never calls recordExternalRef on a delete). Routed through the same registry (task
      // 1.6) — only domains whose writer defines `tombstone` support the delete branch;
      // others don't wire this dep (an omitted callback = no-op via dispatch.ts's optional
      // chaining, though only `tasks` reaches delete today).
      tombstoneReadModel: getReadModelWriter(command.domain).tombstone
        ? (pmoRecordId: string) =>
            getReadModelWriter(command.domain).tombstone!({ serviceClient: serviceClient as never, orgId }, pmoRecordId)
        : undefined,
      // The money-idempotency outbox (task 6.4, ADR-0058) — set only for a non-read-only erpnext
      // command (built above); every other tier's `money` stays `undefined` (byte-for-byte).
      money,
    });
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (err) {
    // Server-side diagnostics only — the client body stays generic/typed. Without this, an
    // external-unreachable's underlying cause (which upstream status? fetch error? which path?)
    // is unrecoverable from any log.
    console.error('[adapter-dispatch] dispatch failed:', err instanceof Error ? (err.stack ?? err.message) : String(err));
    const appError = err instanceof AppError ? err : new AppError(err instanceof Error ? err.message : 'adapter dispatch failed');
    // 'command-held' (C-1): a mutable-anchor money doc held for operator resolution — a 409 Conflict
    // (retrying will NOT help; an operator must resolve), distinct from the transient 502 unreachable.
    const status = appError.code === 'external-unreachable'
      ? 502
      : appError.code === 'commit-rejected'
        ? 422
        : appError.code === 'command-held'
          ? 409
          : 500;
    return new Response(JSON.stringify({ error: appError.code ?? 'DISPATCH_FAILED', message: appError.message }), {
      status,
      headers,
    });
  }
});
