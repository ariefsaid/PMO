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
import { COMMAND_IN_FLIGHT_FOR_RECORD, dispatchExternallyOwnedWrite } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { createReferenceAdapter, REFERENCE_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/referenceAdapter.ts';
import { CLICKUP_TASKS_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/clickup/adapter.ts';
import { resolveClickUpDispatchAdapter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/dispatchFactory.ts';
import { ClickUpRateLimiter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/rateLimit.ts';
import { ERPNEXT_BUDGET_DOMAIN, ERPNEXT_COMPANIES_DOMAIN, ERPNEXT_PROCUREMENT_DOMAIN, ERPNEXT_REVENUE_DOMAIN, ERPNEXT_TIMESHEETS_DOMAIN, ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { resolveErpDispatchAdapter, withPaymentTypeDiscriminator, readCategoryAccountMap } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import {
  runBudgetGate,
  type FiscalYearRow,
  BudgetGateError,
  type BudgetGateDeps,
  type BudgetVersionGateRow,
  type BudgetGateProjectRow,
} from '../../../pmo-portal/src/lib/budget/budgetGate.ts';
import type { BudgetLineItem } from '../../../pmo-portal/src/lib/budget/categoryAccountMap.ts';
import { resolveErpCredentials } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts';
import { withProbeBudget } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { resolveClickUpCredentialsFromVault } from '../../../pmo-portal/src/lib/adapterSeam/clickup/vaultCredentials.ts';
import { resolvePerOrgSecret } from '../_shared/perOrgSecret.ts';
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
import { getReadModelWriter, markTimesheetPushOutcome } from './readModelWriters.ts';
import { surfaceActionRequired } from '../_shared/erpnextFeedDeps.ts';
import { enforceTimesheetApproved, isTimesheetPush, type ApprovedTimesheet } from './approvalGuard.ts';
// M-2: what a rejected budget push MEANS for the durable mirror state (a 409 is not a failure).
import { classifyBudgetPushOutcome } from './budgetPushOutcome.ts';
import { maybeFault, type FaultGate } from './faultSeams.ts';
import { isRevenueSiSubmitTransition, grantSiSubmitClearance, requiresSiAuthorClaim, claimSiAuthor, releaseSiSubmitClearance } from './sodGuard.ts';
import { checkErpnextCommandAuthorization, type AuthorizationClient } from './authGuard.ts';
import { checkSiProjectGate } from './projectGateGuard.ts';
import { checkCreateTargetUnmapped, checkTransitionTargetBinding, isOpaqueIdempotencyKey } from './transitionTargetGuard.ts';
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
  /** The VERIFIED caller's user id (`verified.sub` — never a client-supplied body field). Persisted
   *  onto the money-outbox row as `actor_user_id` (0108 §C) so a LATER sweep finalize — which has no
   *  request JWT — can still attribute `sales_invoices.author_user_id` and keep the submit SoD real. */
  userId: string;
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
// Phase 1b (task 1.5): ADDITIVE Vault-first credential resolution behind EXTERNAL_CONNECT_ENABLED flag.
// When flag is ON and an external_org_bindings row exists with secret_ref, resolve via Vault;
// otherwise fall back to global CLICKUP_API_TOKEN (legacy behavior unchanged when flag is OFF).
// FIX-2: tri-state — no-binding → global fallback; resolved → vault token; binding-vault-miss → FAIL CLOSED.
async function resolveClickUpAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  const connectEnabled = Deno.env.get('EXTERNAL_CONNECT_ENABLED') === 'true';
  let clickUpToken = Deno.env.get('CLICKUP_API_TOKEN') ?? '';

  if (connectEnabled) {
    // Use shared per-org Vault secret resolution (flag gate + binding lookup + fallback)
    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: ctx.orgId,
      tier: 'clickup',
      lookupBinding: async (orgId, tier) => {
        const { data, error } = await ctx.serviceClient
          .from('external_org_bindings')
          .select('secret_ref')
          .eq('org_id', orgId)
          .eq('external_tier', tier)
          .maybeSingle();
        if (error) {
          console.error('external_org_bindings lookup failed', error);
          return null;
        }
        return data as { secret_ref?: string | null } | null;
      },
      readVaultSecret: async (ref) => {
        const { data, error } = await ctx.serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
        if (error) {
          console.error('read_vault_secret failed', error);
          return null;
        }
        return (data as string | null) ?? null;
      },
    });

    if (result.kind === 'resolved') {
      clickUpToken = result.secret;
    } else if (result.kind === 'binding-vault-miss') {
      // FIX-2: bound org but vault secret missing → fail closed, do NOT fall back to global token
      throw new AppError('ClickUp credentials unresolved for this org — check the binding secret_ref configuration', 'config-rejected');
    }
    // result.kind === 'no-binding' → fall through to global token (legacy fallback)
  }

  return resolveClickUpDispatchAdapter({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    command: ctx.command,
    fetchImpl: fetch,
    token: clickUpToken,
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
  // Money-safety audit BLOCK 1: the probe client carries the PROBE budget (one attempt, tighter
  // deadline). Un-budgeted, this GET retries 3× at 120 s = ~483 s — longer than the whole 300 s
  // quarantine window — so the claim winner could finish probing only after its row had been
  // reclaimed and REISSUED, and then still POST a second money document. `dispatch.ts`'s claim budget
  // refuses that POST; this stops the probe eating the budget in the first place.
  const client = withProbeBudget({ fetchImpl: fetch, apiKey, apiSecret, baseUrl: binding.site_url });
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
    // BLOCK 7 (0108 §C): persist the VERIFIED dispatching actor on the outbox row. The sweep finalizes
    // committed-but-unmirrored rows with no request JWT — without this the author is unrecoverable and
    // the mirrored SI's author_user_id lands NULL, silently voiding the approver≠author SoD.
    actorUserId: ctx.userId,
    // C-1 per-kind reissue policy: a mutable-anchor (PE) inconclusive recovery is HELD, never reissued.
    // ADR-0059 §4 corollary (P3c): an ANCHOR-LESS kind flagged `neverReissue` (ERP `Budget` — the
    // doctype has no field to stamp a key into at all, so no probe can exist) is likewise HELD, because
    // "no probe hit" there carries no information whatsoever. Default-absent ⇒ every shipped kind is
    // byte-for-byte.
    reissueOnInconclusiveAbsence: !(entry.anchorMutable || entry.neverReissue),
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
            // Luna re-audit BLOCK #1: the FALLBACK anchor probe (no persisted composite payload yet —
            // e.g. a first attempt that crashed before the outbox insert landed its payload) must STILL
            // carry the `payment_type` discriminator. 'Pay' and 'Receive' Payment Entries share one
            // doctype, and `reference_no` is ERP-side editable, so an unfiltered anchor `like` can adopt
            // a Pay entry for a Receive recovery (and vice-versa) whenever the two share a reference_no
            // — mirroring a PMO incoming payment onto someone's outgoing payment document. The
            // discriminator is derived from the command's OWN `erp_doc_kind`, never from live ERP state.
            const fallbackProbeDeps = withPaymentTypeDiscriminator(probeDeps, kind);
            if (!p || !p.party || p.paid_amount == null) return probeErpByAnchorKey(fallbackProbeDeps, idempotencyKey);
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

// ============================================================================
// P3c — THE BUDGET GATE wiring (ADR-0059 §3.3, the missing half of slice 3). `runBudgetGate`
// (pmo-portal/src/lib/budget/budgetGate.ts) is the pure orchestration; everything below wires it to the
// deputy (caller-scoped) client for the three PMO-table re-reads and to the service-role client for the
// Admin-administered category→account map, matching `dispatchFactory.ts`'s OWN map read exactly (the
// SAME `readCategoryAccountMap`) so the gate and the real push can never disagree about "mapped".
// ============================================================================

/** Does this command push a PMO budget version to ERPNext (and therefore need the gate)? */
function isBudgetPushCommand(cmd: { domain: string; record: Record<string, unknown> }): boolean {
  return cmd.domain === ERPNEXT_BUDGET_DOMAIN && cmd.record.erp_doc_kind === 'budget';
}

/** Does this org have an ACTIVATED erpnext binding at all? A non-employing org's budget push is a
 *  BENIGN NO-OP — same posture as the timesheet "no chargeable hours" skip above — never a rejection, and
 *  critically the GATE never runs for it: a non-employing org legitimately carries zero
 *  `budget_category_account_map` rows, and running the map check anyway would record a spurious
 *  'budget-category-unmapped' failure into `budget_version_erp_mirror` for every org that will never use
 *  this feature (AC-BUD-001 — a non-employing org must stay byte-for-byte). */
async function orgEmploysErpnext(serviceClient: SupabaseClient, orgId: string): Promise<boolean> {
  const { data } = await serviceClient
    .from('external_org_bindings')
    .select('activated_at')
    .eq('org_id', orgId)
    .eq('external_tier', ERPNEXT_TIER)
    .maybeSingle();
  return !!(data as { activated_at: string | null } | null)?.activated_at;
}

/** Wire `runBudgetGate`'s readers: the three PMO tables under the CALLER's own JWT (RLS is the org
 *  boundary — ADR-0059 §3.3), the map via the service-role reader `dispatchFactory.ts` already uses for
 *  the real push. */
function buildBudgetGateDeps(callerClient: SupabaseClient, serviceClient: SupabaseClient, orgId: string, versionId: string): BudgetGateDeps {
  return {
    orgId,
    versionId,
    readVersion: async (id) => {
      const { data } = await callerClient
        .from('budget_versions')
        .select('id, org_id, project_id, status, activated_at')
        .eq('id', id)
        .maybeSingle();
      return (data as BudgetVersionGateRow | null) ?? null;
    },
    readProject: async (id) => {
      const { data } = await callerClient.from('projects').select('id, org_id, start_date, end_date').eq('id', id).maybeSingle();
      return (data as BudgetGateProjectRow | null) ?? null;
    },
    readLineItems: async (id) => {
      const { data } = await callerClient.from('budget_line_items').select('category, budgeted_amount').eq('budget_version_id', id);
      return Array.isArray(data) ? (data as unknown as BudgetLineItem[]) : [];
    },
    readCategoryMap: () => readCategoryAccountMap(serviceClient as never, orgId),
    readFiscalYears: () => readErpFiscalYears(serviceClient, orgId),
  };
}

/**
 * ⚑ OQ-BUD-3b (owner ruling 2026-07-21) — read the CLIENT'S OWN fiscal calendar from ERPNext.
 *
 * A fiscal year is whatever the client declares (Apr–Mar, Jul–Jun, …) and Budget's `fiscal_year` is a
 * **Link by NAME** (spike §3). Deriving the calendar year of `start_date` — what this shipped as —
 * sends a value that for a non-calendar client names the WRONG Fiscal Year or none at all: an invalid
 * Link, and a real overspend control enforced against the wrong period.
 *
 * This is the ONE extra read per budget push the ruling accepts. It is deliberately NOT cached: the
 * cost of a stale calendar here is a budget filed against the wrong year, which is exactly the failure
 * being removed. Errors propagate — `runBudgetGate` fails closed on an unresolvable calendar rather
 * than falling back (the fallback IS the bug).
 */
async function readErpFiscalYears(serviceClient: SupabaseClient, orgId: string): Promise<FiscalYearRow[]> {
  const binding = await resolveErpBindingRow(serviceClient, orgId);
  const { apiKey, apiSecret } = resolveErpCredentials(binding.secret_ref, (key) => Deno.env.get(key));
  const url = new URL('/api/resource/Fiscal Year', binding.site_url);
  url.searchParams.set('fields', JSON.stringify(['name', 'year_start_date', 'year_end_date']));
  url.searchParams.set('limit_page_length', '0'); // all of them — a client may declare many years
  const res = await fetch(url.toString(), {
    headers: { Authorization: `token ${apiKey}:${apiSecret}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new AppError(`could not read the ERPNext fiscal calendar (HTTP ${res.status})`, 'external-unreachable');
  }
  const body = (await res.json()) as { data?: unknown };
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.filter(
    (r): r is FiscalYearRow =>
      typeof (r as FiscalYearRow)?.name === 'string' &&
      typeof (r as FiscalYearRow)?.year_start_date === 'string' &&
      typeof (r as FiscalYearRow)?.year_end_date === 'string',
  );
}

/** Record the gate's durable failure into the ADR-0059 §6 side mirror — BEFORE returning the rejection —
 *  so the operator surface + the sweep backstop's work queue both see it. Only written when the gate had
 *  already resolved a `fiscalYear` (the mirror's grain): an earlier rejection (version/project unreadable,
 *  no activation stamp) has no fiscal year to key a row on, and `budget_version_erp_mirror`'s own writer
 *  (`readModelWriters.ts`) already refuses a fiscal-year-less row for the identical reason. Best-effort —
 *  a failure to record this must never mask the rejection the caller already gets. */
async function recordBudgetGateFailure(serviceClient: SupabaseClient, orgId: string, versionId: string, err: BudgetGateError): Promise<void> {
  if (!err.fiscalYear) return;
  try {
    await serviceClient.from('budget_version_erp_mirror').upsert(
      {
        org_id: orgId,
        budget_version_id: versionId,
        fiscal_year: err.fiscalYear,
        push_state: 'failed',
        push_error: err.code,
        unmapped_categories: err.unmappedCategories ?? null,
      },
      { onConflict: 'org_id,budget_version_id,fiscal_year' },
    );
  } catch (mirrorErr) {
    console.error('[adapter-dispatch] failed to record budget gate failure:', mirrorErr);
  }
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
  // P3c — the budget push (ADR-0055 §6). Same tier, same adapter; the domain is additive.
  [ERPNEXT_BUDGET_DOMAIN]: resolveErpAdapter,
  // P3b — the timesheets push (ADR-0059 Posture B). Same tier, same adapter, same outbox: Posture B
  // reuses the shipped machinery wholesale; only its GATE and its key derivation differ.
  [ERPNEXT_TIMESHEETS_DOMAIN]: resolveErpAdapter,
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

  // Compute isErpDomain early so it's available for both the auth guard and idempotency check.
  const isErpDomain = command.domain === ERPNEXT_COMPANIES_DOMAIN || command.domain === ERPNEXT_PROCUREMENT_DOMAIN || command.domain === ERPNEXT_REVENUE_DOMAIN || command.domain === ERPNEXT_BUDGET_DOMAIN || command.domain === ERPNEXT_TIMESHEETS_DOMAIN;

  // ── Luna BLOCK 4 — server-side authorization gate for erpnext-tier commands (money audit).
  // After resolving the caller's org/userId and parsing the command, but BEFORE any adapter/
  // outbox/ERP write. The deputy `callerClient` (caller's JWT) is used so domain_externally_owned
  // and profiles.select run under the caller's RLS — consistent with the SoD gate below.
  if (isErpDomain) {
    const auth = await checkErpnextCommandAuthorization(callerClient as never, orgId, userId, command);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: auth.message }), {
        status: auth.status,
        headers,
      });
    }
  }

  // ── P3b FR-TSP-010 — THE APPROVED-ONLY GATE (ADR-0059 §3.3). BEFORE the outbox, BEFORE adapter
  // selection, BEFORE any ERP call. Runs on the deputy `callerClient` (the caller's own JWT), the same
  // posture as the SI SoD gate below, so `approved_timesheet_for_push` (0138) evaluates its org and
  // actor arms against the REAL caller.
  //
  // It does two things, and the second matters as much as the first:
  //  (1) it re-reads `timesheets.status` from the DB — the payload is never trusted to assert
  //      approved-ness, and there is no null/absent branch to fall into (the guard either reads an
  //      Approved row or it refuses);
  //  (2) it hands back the sheet's AUTHOR, its `approved_at` witness and its ENTRIES, which REPLACE
  //      whatever the command carried. So a caller cannot post hours that are not on the approved
  //      sheet, cannot re-attribute them to another user, and cannot forge the mirror's witness.
  let approvedSheet: ApprovedTimesheet | undefined;
  if (isTimesheetPush(command)) {
    const approved = await enforceTimesheetApproved(callerClient as never, String(command.record.id));
    if (!approved.ok || !approved.sheet) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: approved.message }), {
        status: approved.status,
        headers,
      });
    }
    approvedSheet = approved.sheet;
    // Server truth REPLACES the payload for every field the push is built from.
    command.record = {
      ...command.record,
      user_id: approvedSheet.user_id,
      approved_at: approvedSheet.approved_at,
      entries: approvedSheet.entries,
    };
  }

  // ── Server-side idempotency-key enforcement (task 6.4, FR-ENA-040, ADR-0058 §4) — at the top of
  // the served path, BEFORE any adapter-select/binding/credential resolution: a non-read-only erpnext
  // command with no idempotencyKey is rejected fast, never reaching the outbox or ERP. `dispatch.ts`'s
  // `dispatchMoneyWrite` re-asserts the identical guard (unit-tested, AC-ENA-012) — this is a
  // fail-fast duplicate at the integration boundary, not the sole enforcement point. P0/P1 (every
  // other domain) is unaffected.
  // `AdapterOperation` has no 'read' member (reads never reach this handler as a write command) —
  // the string cast mirrors dispatch.ts's own `(command.operation as string) !== 'read'` guard.
  //
  // Luna re-audit BLOCK #1 (Lane C hand-off): the key must additionally be an OPAQUE UUID, not merely
  // present. The recovery probe matches the anchor field with `%key%` — a SUBSTRING match kept
  // deliberately (a false-negative probe reissues, i.e. duplicate money). A short key like `"1"`
  // therefore matches any ERP document whose anchor merely CONTAINS it, and recovery adopts the wrong
  // document. A UUID-shaped key makes that class unreachable by construction (and cannot carry a LIKE
  // metacharacter). The legitimate client already mints `crypto.randomUUID()`.
  if (isErpDomain && (command.operation as string) !== 'read' && !isOpaqueIdempotencyKey(command.idempotencyKey)) {
    return new Response(
      JSON.stringify({
        error: 'commit-rejected',
        message: command.idempotencyKey ? 'invalid-idempotency-key (must be a UUID)' : 'missing-idempotency-key',
      }),
      { status: 422, headers },
    );
  }

  // service_role client — used for the machine-write helpers (read-model upsert/update + external_refs
  // record) AND, for 'tasks', to resolve the per-request ClickUp binding/mapping at adapter-select time.
  // Never used for adapter.commit() — org_id never crosses into the adapter (AC-EAS-023).
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // ── P3b FR-TSP-056 — an approved sheet with NO chargeable hours is a SKIP, not a push. ERP rejects
  // an empty `time_logs` table outright (417 MandatoryError), so sending it would park a perfectly
  // valid approved week in the sweep's retry queue forever. Record it as `pushed` with a null
  // ts_number — a success — and return without touching ERP.
  if (approvedSheet && approvedSheet.entries.length === 0) {
    await markTimesheetPushOutcome(
      { serviceClient: serviceClient as never, orgId, callerUserId: userId },
      String(command.record.id),
      approvedSheet.approved_at,
      null,
    );
    return new Response(JSON.stringify({ externalRecordId: null, canonical: { id: command.record.id }, skipped: 'no-chargeable-hours' }), {
      status: 200,
      headers,
    });
  }

  // ── P3c — THE BUDGET GATE (ADR-0059 §3.3, the missing half of slice 3). Before adapter selection,
  // before the outbox, before any ERP call: re-read the version's status, the project's org + fiscal
  // year, and the line items — from the DB under the CALLER's own JWT — and resolve the category→account
  // map (FR-BUD-113) BEFORE any ERP call. A non-employing org is a benign no-op (see `orgEmploysErpnext`).
  // On a PASS, server truth (never the payload) REPLACES the fields the push body is built from.
  if (isBudgetPushCommand(command)) {
    if (!(await orgEmploysErpnext(serviceClient, orgId))) {
      return new Response(
        JSON.stringify({ externalRecordId: null, canonical: { id: command.record.id }, skipped: 'org-not-employing-erpnext' }),
        { status: 200, headers },
      );
    }

    const versionId = String(command.record.id);
    try {
      const gate = await runBudgetGate(buildBudgetGateDeps(callerClient, serviceClient, orgId, versionId));
      // Server truth REPLACES the payload for every field the push body is built from (ADR-0059 §3.3) —
      // `projectId` (camelCase) feeds `dispatchFactory.ts`'s cross-org pre-flight + ERP-project ref
      // resolution; `fiscal_year`/`line_items` (snake_case) feed `bodies/budget.ts`'s `budgetToBody`.
      command.record = { ...command.record, projectId: gate.projectId, fiscal_year: gate.fiscalYear, line_items: gate.lineItems };
    } catch (err) {
      const gateErr = err instanceof BudgetGateError ? err : new BudgetGateError('commit-rejected', err instanceof Error ? err.message : 'budget gate failed');
      await recordBudgetGateFailure(serviceClient, orgId, versionId, gateErr);
      return new Response(JSON.stringify({ error: 'commit-rejected', message: gateErr.message }), { status: 422, headers });
    }
  }

  // ── Slice 3 / round-7 B8: the `require_project_on_si` process gate (FR-SAR-191, AC-SAR-070), for
  // EVERY Sales-Invoice command that puts revenue on the ERP ledger — the body-building ones
  // (create / update / amend) AND the **submit**, whose authority is the PMO mirror row rather than the
  // command (a submit builds no body). The shipped inline gate covered only the body-building half, so
  // an SI created while the gate was OFF — or an unassigned SI adopted inbound by the sweep — could
  // still be SUBMITTED with the gate ON: revenue on the ERP GL with no project dimension while PMO
  // reports project-attributed revenue.
  //
  // The whole rule (scoping, gate read, the SO/BAST inert warnings, fail-closed on any unreadable
  // input) lives in `projectGateGuard.ts` so it is unit-provable and cannot be forked. Runs BEFORE any
  // adapter/outbox work, so a rejection creates no outbox row and touches no ERP.
  {
    const projectGate = await checkSiProjectGate(serviceClient as never, orgId, command as never);
    if (!projectGate.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: projectGate.message }), {
        status: projectGate.status,
        headers,
      });
    }
  }

  // ── Luna re-audit BLOCK #2 / BLOCK #4 — PMO-target binding (money audit), for EVERY erpnext
  // domain and kind, BEFORE adapter select / outbox insert / any ERP write. Uses `serviceClient`
  // (external_refs + external_command_outbox are service-role-scoped, policy-less machine tables).
  //
  //  #2: authorization/SoD is keyed on `record.id` while the adapter acts on the caller-supplied
  //      `record.externalRecordId` — so a transition/update MUST be bound to the PMO record's own
  //      recorded mapping, and a MISSING mapping fails closed (a record that was never externalized
  //      has nothing to transition). Previously only revenue sales-invoice transitions were checked
  //      and a missing mapping was permitted.
  //  #4: a create must not target an ALREADY-MAPPED PMO record — `record_outbox_ref` would repoint
  //      that record's external identity to a fresh ERP document before the mirror insert fails on
  //      the duplicate PK. This command's own retry (same idempotency key) stays allowed.
  if (isErpDomain) {
    const binding = await checkTransitionTargetBinding(serviceClient as never, orgId, command);
    if (!binding.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: binding.message }), {
        status: binding.status,
        headers,
      });
    }
    const createTarget = await checkCreateTargetUnmapped(serviceClient as never, orgId, command, command.idempotencyKey);
    if (!createTarget.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: createTarget.message }), {
        status: createTarget.status,
        headers,
      });
    }
  }

  // ── SoD defect 2 (TOCTOU) — CLAIM authorship of the sales-invoice body BEFORE the ERP write.
  //
  // The submit SoD above runs before the ERP body is constructed, and the author re-stamp used to
  // happen only afterwards, in the (post-ERP) read-model writer. So an approver could issue an
  // `update` rewriting the amount AND, concurrently, a `submit`: the submit's check read the
  // authorship as it stood BEFORE the rewrite, passed, and the rewrite then landed the approver's own
  // numbers — the approver's amount carrying the approver's own approval.
  //
  // `claim_sales_invoice_author` (0113 §D) closes that window IN THE DB, which is the only place it
  // CAN be closed: a stateless edge function holds no transaction across the ERP HTTP call. It takes
  // the same `select … for update` on the invoice row that `submit_sales_invoice` takes, so the two
  // serialize: whichever wins the lock, the loser is refused (the rewriter is already in the author
  // set, or the rewrite hits an outstanding submit authorization → 409 `si-submit-in-progress`).
  // Refused HERE means refused BEFORE any ERP call — no money moves either way.
  //
  // Runs under the CALLER's JWT (the deputy `callerClient`, never service_role — auth.uid() must
  // resolve to the real body-writer), and AFTER the binding/target guards so a command that is about
  // to be rejected never records authorship.
  if (requiresSiAuthorClaim(command)) {
    const claim = await claimSiAuthor(callerClient as never, String(command.record.id));
    if (!claim.ok) {
      return new Response(
        JSON.stringify({ error: claim.status === 403 ? 'commit-rejected' : 'DISPATCH_FAILED', message: claim.message }),
        { status: claim.status, headers },
      );
    }
  }

  // ── Luna BLOCK 2 — server-side Sales-Invoice submit SoD (FR-SAR-195, ADR-0019). `submitInvoice()`
  // in the repository already calls the SoD RPC for the legitimate FE path, but a caller POSTing the
  // dispatch command directly could skip it. Enforce SoD HERE, under the CALLER's JWT (the deputy
  // `callerClient`, never service_role — auth.uid()/auth_org_id() must resolve to the real submitter):
  // a revenue sales-invoice SUBMIT transition must pass `submit_sales_invoice(p_si_id)` BEFORE the
  // adapter commits the ERP submit. A 42501 (self-approval / not-authorized) closes the bypass — the
  // dispatch returns 403/409 and does NOT submit to ERP, regardless of which client dispatched.
  //
  // Round-6 re-audit, finding 2 — POSITION MATTERS: this gate RECORDS a submit clearance that freezes
  // every body rewrite (0114 §D/§E), so it runs LAST of the pre-dispatch gates. Every rejection a
  // submit can collect (target binding, create-target, authorization, gates) therefore happens BEFORE a
  // clearance exists, and the only exits after it are the adapter-select failure and the dispatch
  // itself — both of which RELEASE it below. The freeze is thereby scoped to a dispatch that is
  // genuinely in progress.
  //
  // Round-7 B1b — the gate is the SERVICE-ROLE-ONLY `grant_sales_invoice_submit_clearance`, not
  // `submit_sales_invoice` under the caller's JWT. A clearance that an authenticated caller can mint is
  // an insider freeze on the money path, and one they can RELEASE is a self-approval bypass: the grantee
  // IS the approver the clearance constrains, so a grantee-fenced release let them lift it mid-submit
  // and rewrite the body their own in-flight submit was about to commit. Because service_role carries no
  // `auth.uid()`, the JWT-verified `userId` is passed EXPLICITLY and the RPC authorizes that actor.
  //
  // `clearanceId` is this dispatch's fencing token: the release names it, so a SECOND concurrent submit
  // resolving cannot lift THIS submit's freeze (B1c).
  const takesSubmitClearance = isRevenueSiSubmitTransition(command);
  const clearanceId = crypto.randomUUID();
  if (takesSubmitClearance) {
    const sod = await grantSiSubmitClearance(serviceClient as never, String(command.record.id), userId, clearanceId);
    if (!sod.ok) {
      const message = /sod|self-approval|approver|author|not authorized/i.test(sod.message) ? 'sod-self-approval' : sod.message;
      return new Response(JSON.stringify({ error: sod.status === 403 ? 'commit-rejected' : 'DISPATCH_FAILED', message }), {
        status: sod.status,
        headers,
      });
    }
  }
  /** Ends the body-rewrite freeze this request's submit clearance imposes (no-op for every other
   *  command). Best-effort — the clearance's TTL is the backstop, so it never fails a resolved
   *  dispatch. MUST run on every exit path below. */
  const releaseSubmitClearance = async (): Promise<void> => {
    if (takesSubmitClearance) {
      await releaseSiSubmitClearance(serviceClient as never, String(command.record.id), clearanceId);
    }
  };

  /** P3b FR-TSP-085 / ADR-0059 §6 — record a failed push as DURABLE, operator-visible state.
   *
   *  The PMO approval has ALREADY committed and the user has moved on, so nothing else will ever
   *  surface this failure: an unrecorded one is indistinguishable from a push that never happened.
   *  Best-effort by design — a failure to record must never mask the original error the caller gets.
   *  A no-op for every other domain (`approvedSheet` is only set for a gated timesheet push), and the
   *  witness it writes is the one the GATE read from the DB, never a payload value. */
  const recordTimesheetPushFailure = async (failure: AppError): Promise<void> => {
    if (!approvedSheet) return;
    try {
      await markTimesheetPushOutcome(
        { serviceClient: serviceClient as never, orgId, callerUserId: userId },
        String(command.record.id),
        approvedSheet.approved_at,
        { code: failure.code, message: failure.message },
      );
    } catch (recordErr) {
      console.error('[adapter-dispatch] failed to record timesheet push failure:', recordErr);
    }
  };

  /**
   * Luna re-audit HIGH-2 (2026-07-21), ADR-0059 §6/FR-BUD-123 — record a POST-GATE budget push
   * failure as DURABLE, operator-visible state. `recordBudgetGateFailure` (above) covers only a
   * REJECTION BY THE GATE ITSELF (unmapped category, multi-FY, unresolved fiscal year) — a failure
   * from adapter-select or the ERP write ITSELF (the money-safety-audit's concrete scenario: a
   * revision's own outbox/ERP round-trip rejected by ERP's `(company, project, fiscal_year, account)`
   * duplicate guard) landed NO mirror row at all, so `get_budget_projection.push_state` stayed `NULL`
   * — indistinguishable from "never pushed" — and the sweep backstop (which only re-drives
   * `pending`/`failed` rows) had nothing to pick up. ADR-0059 §3.2 STANDS: the swallow itself is
   * correct — activation must never fail because ERP failed — but "swallowed" must mean "recorded and
   * surfaced", never "lost". Keyed on the mirror's own `(org_id, budget_version_id, fiscal_year)`
   * grain; the gate REPLACES `command.record.fiscal_year` with its own server-resolved value on a
   * PASS (line ~772), so by the time either catch block below runs it is real, not a payload guess.
   * Best-effort, like every other action-required surface — never masks the caller's own error.
   */
  const recordBudgetPushFailure = async (failure: AppError): Promise<void> => {
    if (!isBudgetPushCommand(command)) return;
    // ⚑ M-2 (Luna audit round 3) — a 409 is not a push failure. `command-in-flight-for-record` is the
    // normal outcome of a double-clicked Retry (or the backstop racing the operator): the command that
    // IS settling owns the outcome, so recording one here raised a false money alarm and could
    // overwrite the winner's `pushed` with `failed`. `command-held` is real but belongs in `held`, the
    // state the backstop deliberately excludes because a human must resolve it. See budgetPushOutcome.ts.
    const outcome = classifyBudgetPushOutcome(failure.code);
    if (!outcome.record) return;
    const fiscalYear = (command.record as { fiscal_year?: unknown }).fiscal_year;
    if (typeof fiscalYear !== 'string' || fiscalYear === '') return; // the gate never resolved one — recordBudgetGateFailure already owns that rejection
    const versionId = String(command.record.id);
    try {
      await serviceClient.from('budget_version_erp_mirror').upsert(
        {
          org_id: orgId,
          budget_version_id: versionId,
          fiscal_year: fiscalYear,
          push_state: outcome.pushState,
          push_error: failure.code ?? 'DISPATCH_FAILED',
        },
        { onConflict: 'org_id,budget_version_id,fiscal_year' },
      );
      await surfaceActionRequired(serviceClient as never, orgId, 'budget-push-failed', {
        versionId,
        reason: failure.code ?? failure.message,
      });
    } catch (recordErr) {
      console.error('[adapter-dispatch] failed to record budget push failure:', recordErr);
    }
  };

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
    adapter = await adapterFactory({ orgId, command, serviceClient, faultGate, userId });
    // Task 6.4 (ADR-0058): every non-read-only erpnext command routes through the money-idempotency
    // outbox — `dispatchExternallyOwnedWrite` requires `money` to be set for this tier (it throws
    // "dispatched without outbox deps" otherwise, the exact failure this task closes). P0/P1 (every
    // other tier) never resolves this — `money` stays `undefined`, their path is byte-for-byte.
    if (adapter.tier === ERPNEXT_TIER && (command.operation as string) !== 'read') {
      money = await resolveErpMoneyOutboxDeps({ orgId, command, serviceClient, faultGate, userId });
    }
  } catch (err) {
    // The submit never reaches ERP — end the body-rewrite freeze now rather than in five minutes.
    await releaseSubmitClearance();
    const appError = err instanceof AppError ? err : new AppError(err instanceof Error ? err.message : 'adapter select failed');
    // A timesheet push fails MOST often right here: the fail-closed ref pre-flight (employee-unlinked /
    // project-unmapped / activity-type-unconfigured / cross-org-link-rejected / daily-hours-exceed-24)
    // runs inside the factory, deliberately BEFORE the outbox claim and any ERP call.
    await recordTimesheetPushFailure(appError);
    await recordBudgetPushFailure(appError); // HIGH-2: an adapter-select-time budget rejection is durable too
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
        await writer.upsert({ serviceClient: serviceClient as never, orgId, callerUserId: userId }, canonical, command);
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
    // WIRE 4: `command-in-flight-for-record` (0116's one-in-flight-per-record index, classified in
    // dispatch.ts) is a genuine CONFLICT — another command for this PMO record is still settling.
    // Retrying now cannot help, but retrying LATER can, so it is a 409 like `command-held`, never a 500
    // carrying the raw index name.
    await recordTimesheetPushFailure(appError);
    // P3c defense-in-depth: the budget gate above already refuses an unmapped category / multi-FY
    // project BEFORE this try block ever runs, so this branch is unreachable in the normal path — but
    // `BudgetCategoryUnmappedError` (categoryAccountMap.ts) is a plain `Error` subclass, not an
    // `AppError`/`AdapterError`, so were it ever to bubble up from here (a race between the gate's map
    // read and `bodies/budget.ts`'s own re-check at commit time) the generic `new AppError(err.message)`
    // above would silently DROP its `.code`/`.unmappedCategories` and fall through to a bare 500. Budget
    // is a money-adjacent surface, so its own classified codes are preserved explicitly here.
    const isBudgetCode = (code: unknown): code is string => code === 'budget-category-unmapped' || code === 'budget-multi-fiscal-year';
    const budgetAppError =
      isBudgetPushCommand(command) && err instanceof Error && isBudgetCode((err as { code?: unknown }).code)
        ? new AppError(err.message, (err as unknown as { code: string }).code)
        : appError;
    // HIGH-2 — THE concrete gap the money-safety audit found: a budget push that clears the gate but
    // is then rejected by the ERP write ITSELF (the everyday "revise an already-pushed budget" path —
    // ERP's own `(company, project, fiscal_year, account)` duplicate guard rejects it, doctypeRegistry.ts
    // ~136-141) landed no mirror row at all, so `get_budget_projection.push_state` stayed indistinguishable
    // from "never pushed" and the sweep backstop had nothing to re-drive. Recorded with the BEST-classified
    // error (`budgetAppError`, not the generic `appError`) so the operator surface names the real reason.
    await recordBudgetPushFailure(budgetAppError);
    const status = budgetAppError.code === 'external-unreachable'
      ? 502
      : budgetAppError.code === 'commit-rejected' || isBudgetCode(budgetAppError.code)
        ? 422
        : budgetAppError.code === 'command-held' || budgetAppError.code === COMMAND_IN_FLIGHT_FOR_RECORD
          ? 409
          : 500;
    return new Response(JSON.stringify({ error: budgetAppError.code ?? 'DISPATCH_FAILED', message: budgetAppError.message }), {
      status,
      headers,
    });
  } finally {
    // Finding 2: the submit has RESOLVED — successfully, rejected by ERP, or held. Either way the
    // clearance has served its purpose (it exists only to stop a body rewrite racing an IN-FLIGHT
    // submit), so release it here rather than leaving Finance blocked for the rest of the TTL.
    await releaseSubmitClearance();
  }
});
