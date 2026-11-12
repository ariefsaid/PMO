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
import { createClient } from '@supabase/supabase-js';
import { CLICKUP_TASKS_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/clickup/adapter.ts';
import { ERPNEXT_BUDGET_DOMAIN, ERPNEXT_PROCUREMENT_DOMAIN, ERPNEXT_REVENUE_DOMAIN, ERPNEXT_TIER, isErpDispatchDomain } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import {
  runBudgetActivationPrecheck,
  BudgetGateError,
} from '../../../pmo-portal/src/lib/budget/budgetGate.ts';
import { resolveErpAuthPair, createErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { externalConnectEnabled } from '../_shared/externalConnectEnabled.ts';
import { guardedErpFetch } from '../_shared/erpHostGuard.ts';
// The runtime (kind)->{toBody,fromDoc} side table (task 5.2) — ADDITIVE across slices 3/4/5/6, each
// wiring only the kinds it owns; an un-wired kind is `commit-rejected` at commit time, never a
// silent no-op (adapter.ts's `requireBodyFns`). Slice 3's supplier/customer entries now live in this
// same shared table (doctypeBodies.ts) rather than a parallel local const — one side table, never two.
import { AppError, type CommandHeldOutboxMarker } from '../../../pmo-portal/src/lib/appError.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { heldIdentityFor, markTimesheetPushOutcome } from './readModelWriters.ts';
import { applyCanonicalTimesheetTruth, enforceTimesheetApproved, isTimesheetPush, type ApprovedTimesheet } from './approvalGuard.ts';
// AC-TSP-031: the ONE code→HTTP-status map for both failure exits (pre-flight select + dispatch).
import { dispatchErrorStatus } from './dispatchErrorStatus.ts';
import type { FaultGate } from './faultSeams.ts';
import { isRevenueSiSubmitTransition, grantSiSubmitClearance, requiresSiAuthorClaim, claimSiAuthor, releaseSiSubmitClearance } from './sodGuard.ts';
import { checkCommandAuthorization } from './authGuard.ts';
import { authorizeBudgetOccupant, isBudgetOccupantCommand, runBudgetOccupant } from './budgetOccupant.ts';
import { assertNotPreCutover } from '../../../pmo-portal/src/lib/adapterSeam/cutoverGate.ts';
import { authorizeClickUpTaskCommand } from './taskAuthorization.ts';
import { enforcePaymentGate, isProcurementPaymentCreate } from './paymentGate.ts';
import { checkOdooPaymentGate } from './odooPaymentGate.ts';
import { checkSiProjectGate } from './projectGateGuard.ts';
import { checkProcurementGate } from './procurementGateGuard.ts';
import { checkOdooProjectGate } from './odooProjectGate.ts';
import { checkPoRevise } from './poReviseGuard.ts';
import { checkCreateTargetUnmapped, checkRevenueErpPathTarget, checkTransitionTargetBinding, isCanonicalUuid, isOpaqueIdempotencyKey } from './transitionTargetGuard.ts';

import {
  verifyCallerJwt,
  bearerToken,
  JwtVerifyError,
  jwksFromUrl,
  type JwksResolver,
} from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';
import { erpRateLimiter, resolveErpBindingRow, reviseCancels, selectAdapterFactory, type AdapterSelectContext } from './dispatchAdapters.ts';
import { runDispatchAttempt } from './dispatchAttempt.ts';
import {
  buildBudgetDispatchPlan,
  buildBudgetGateDeps,
  isBudgetPushCommand,
  orgEmploysErpnext,
  recordBudgetPushFailure,
} from './budgetDispatch.ts';
import { resolveErpMoneyOutboxDeps as resolveErpMoneyOutboxDepsModule } from './erpMoneyOutbox.ts';
import { commandForBudgetUnit } from './commandUnit.ts';
import { resolveOdooMoneyOutboxDeps } from './odooMoneyOutbox.ts';
import { odooRevenueAnchorKey } from './odooRevenueOutbox.ts';
import { odooCompanyAnchorKey } from './odooCompanies.ts';
import { equipmentKey } from './odooEquipment.ts';
import { EQUIPMENT_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/odoo/assets/kinds.ts';
import { checkOdooDraftTarget, isOdooInvoiceDraftWrite, writeOdooInvoiceDraft } from './odooInvoiceDraft.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { odooOwnsCompaniesTier, odooOwnsRevenueTier } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ownership.ts';

export { resolveErpBindingRow, resolveErpAdapter } from './dispatchAdapters.ts';
export type { AdapterSelectContext } from './dispatchAdapters.ts';
export { buildPaymentCompositePayload, readOutboxCompositePayload } from './erpMoneyOutbox.ts';

export const resolveErpMoneyOutboxDeps = (ctx: AdapterSelectContext): Promise<DispatchMoneyOutboxDeps> =>
  resolveErpMoneyOutboxDepsModule(ctx, resolveErpBindingRow);

const MONEY_OUTBOX_RESOLVERS: Record<string, (ctx: AdapterSelectContext) => Promise<DispatchMoneyOutboxDeps>> = {
  [ERPNEXT_TIER]: resolveErpMoneyOutboxDeps,
  [ODOO_TIER]: resolveOdooMoneyOutboxDeps,
};

// ADR-0057: one cached, rate-limited JWKS resolver, memoized across warm invocations. Built lazily
// so an empty SUPABASE_URL can't throw a URL error before the handler can return a typed 401/500.
let _jwks: JwksResolver | null = null;
function getJwks(supabaseUrl: string): JwksResolver {
  if (!_jwks) _jwks = jwksFromUrl(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  return _jwks;
}

// ── Test hooks (the shipped-handler binding, `scripts/check-edge-fn-test-binding.mjs`) ──────────────
// The same two seams every other tested edge fn exposes (`external-*`/index.ts). A served test drives
// the REAL handler, and both `createRemoteJWKSet` and supabase-js's token auto-refresh start
// background INTERVALS that outlive the request — Deno's op sanitizer then fails the suite for a leak
// that is an artifact of the harness, not of the code. Neither hook changes any deployed behaviour:
// `_jwks` is only ever pre-set by a test, and the options below are the defaults for a client that
// never holds a session anyway.
export function setTestJwks(resolver: JwksResolver): void {
  _jwks = resolver;
}
export const testSupabaseOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};

// ============================================================================
// P3c — THE BUDGET GATE wiring (ADR-0059 §3.3, the missing half of slice 3). `runBudgetGate`
// (pmo-portal/src/lib/budget/budgetGate.ts) is the pure orchestration; everything below wires it to the
// deputy (caller-scoped) client for the three PMO-table re-reads and to the service-role client for the
// Admin-administered category→account map, matching `dispatchFactory.ts`'s OWN map read exactly (the
// SAME `readCategoryAccountMap`) so the gate and the real push can never disagree about "mapped".
// ============================================================================

// Same origin-narrowing seam as agent-chat/compose-view (AUDIT quick-win 2026-07-07): set
// AGENT_ALLOWED_ORIGIN in prod; falls back to SITE_URL, then '' (fail-closed — never '*').
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': Deno.env.get('AGENT_ALLOWED_ORIGIN') ?? Deno.env.get('SITE_URL') ?? '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

serveWithErrorReporting('adapter-dispatch', async (req: Request): Promise<Response> => {
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
    ...testSupabaseOptions,
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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'invalid JSON body' }), {
      status: 400,
      headers,
    });
  }

  // Read-only Draft precheck for the activation confirmation. It uses this function's caller-bound
  // PMO reads and the same server-side ERP calendar/map dependencies as the real push; it never enters
  // the adapter, money outbox, or write path. The actual transition remains activate_budget_version's
  // existing authority, and an ERP outage is returned as an explicit unverified result. Defer its
  // service-role client until after the dispatch gates below, alongside the ordinary dispatch client.
  let budgetActivationPrecheckVersionId: string | undefined;
  if (body && typeof body === 'object' && (body as { action?: unknown }).action === 'budget-activation-precheck') {
    const versionId = (body as { versionId?: unknown }).versionId;
    if (typeof versionId !== 'string' || !isCanonicalUuid(versionId)) {
      return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'versionId must be a canonical UUID' }), {
        status: 400,
        headers,
      });
    }
    budgetActivationPrecheckVersionId = versionId;
  }

  // `const` since #1714: the request command is bound ONCE, after parsing; its remaining mutations
  // below are PROPERTY mutations on trusted server truth (the derived keys, canonical timesheet
  // truth, the stripped caller fields) and stay exactly where they are. Each budget fan-out unit is
  // attempted under its own freshly minted command (`commandForBudgetUnit`) — never a rebinding of
  // this binding.
  const command = body as AdapterCommand;
  if (!budgetActivationPrecheckVersionId && (!command?.domain || !command?.operation || !command?.record?.id)) {
    return new Response(
      JSON.stringify({ error: 'BAD_REQUEST', message: 'domain, operation, and record.id are required' }),
      { status: 400, headers },
    );
  }
  // #1462: only the sweep can originate an archive-cancellation job. The public HTTP command can
  // request a normal budget push; its body cannot select a legacy mirror, predecessor, or durable job.
  if (command.domain === ERPNEXT_BUDGET_DOMAIN && command.record?.erp_doc_kind === 'budget' &&
      (Object.hasOwn(command.record, 'source_kind') ||
       Object.hasOwn(command.record, 'budget_archive_cancel_job_id') ||
       Object.hasOwn(command.record, 'budget_archive_source_mirror_id'))) {
    return new Response(JSON.stringify({ error: 'commit-rejected', message: 'budget archive cancellation is server-owned' }), {
      status: 422,
      headers,
    });
  }
  // #956: the VAT witness is internal command material, never a client authority. This HTTP
  // boundary is a fresh dispatch; trusted sweep replay reconstructs persisted payloads elsewhere.
  if (command.domain === ERPNEXT_REVENUE_DOMAIN && command.record.erp_doc_kind === 'sales-invoice') {
    delete (command.record as Record<string, unknown>).vat_flag_at_resolution;
  }
  if (command.domain === ERPNEXT_PROCUREMENT_DOMAIN && command.record.erp_doc_kind === 'goods-receipt') {
    delete (command.record as Record<string, unknown>).pmo_gr_snapshot;
  }

  // Compute isErpDomain early so it's available for both the auth guard and idempotency check. #1511: the equipment register is
  // an externally-owned domain too — it is served by the Odoo tier only, and every gate below that does not concern it is
  // self-gating on the domain (the cutover gate, the revenue/procurement target guards, the project gates).
  const isErpDomain = isErpDispatchDomain(command.domain) || command.domain === EQUIPMENT_DOMAIN;

  // ── #784 — a revenue command names its record by the canonical uuid every PMO revenue table keys it on;
  // the whole money path compares that id as TEXT (the outbox fence, the one-in-flight index, external_refs,
  // the native receipt RPCs' ownership checks). Every erp_doc_kind — sales-invoice, incoming-payment, … —
  // answers the shape HERE, before any guard read, before adapter selection, before any outbox/ref write.
  // `checkRevenueErpPathTarget` re-asserts it (unit-provable) and `dispatchMoneyWrite` re-asserts it on the
  // pure path, the same boundary-plus-re-assertion layering the idempotency-key rule below uses.
  if (command.domain === ERPNEXT_REVENUE_DOMAIN && !isCanonicalUuid(String(command.record.id))) {
    return new Response(
      JSON.stringify({ error: 'commit-rejected', message: 'revenue record.id must be a canonical UUID' }),
      { status: 422, headers },
    );
  }

  // ── Luna BLOCK 4 — server-side authorization gate for erpnext-tier commands (money audit).
  // After resolving the caller's org/userId and parsing the command, but BEFORE any adapter/
  // outbox/ERP write. The deputy `callerClient` (caller's JWT) is used so domain_externally_owned
  // and profiles.select run under the caller's RLS — consistent with the SoD gate below.
  // A PMO-only org's budget activation has nothing to push. Answer the benign skip BEFORE the ERP-tier
  // gate, which refuses a non-employing org and made every PMO-only activation report a failed push.
  // Only a definite `false` skips; a read error still falls through to the gate's refusal.
  if (isBudgetPushCommand(command)) {
    const employed = await callerClient.rpc('org_has_active_erpnext_binding', { p_org_id: orgId });
    if (!employed.error && employed.data === false) {
      return new Response(
        JSON.stringify({ externalRecordId: null, canonical: { id: command.record.id }, skipped: 'org-not-employing-erpnext' }),
        { status: 200, headers },
      );
    }
  }
  // `budget-occupant` (ECA-6) is a request, not an ERP document kind: it has its own Admin/Finance gate below.
  // The tier that owns the domain for this org (ERPNext, or Odoo where procurement is employed) picks the adapter and the outbox.
  let employedTier: string | undefined;
  if (isErpDomain && !isBudgetOccupantCommand(command)) {
    // The guard reads only the authorization inputs (domain + the named ERP document kind).
    const auth = await checkCommandAuthorization(callerClient as never, orgId, userId, {
      domain: command.domain,
      record: { erp_doc_kind: command.record.erp_doc_kind },
    });
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: auth.message }), {
        status: auth.status,
        headers,
      });
    }
    employedTier = auth.tier;
  }

  // ── ECA-4 (FR-ECA-030, OQ-ECA-1) — a purchase ordered before the ERP connection pushes no later step. Runs on the
  // deputy `callerClient` BEFORE the outbox, adapter selection and any ERP call, for every ERP tier alike; the
  // verdict is read from PMO's tables, never from the payload. A check that cannot answer refuses (fail closed).
  try {
    await assertNotPreCutover(callerClient as never, command);
  } catch (error) {
    const code = error instanceof AppError ? error.code : undefined;
    const message = error instanceof Error ? error.message : 'could not check the connection date';
    return new Response(JSON.stringify({ error: code === 'pre-cutover' ? 'pre-cutover' : 'commit-rejected', message }), {
      status: code === 'pre-cutover' ? 409 : 422,
      headers,
    });
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
  //
  // ⚑ BFY FR-BFY-031 (contract change, OQ-BFY-3): a budget CREATE is exempt from the CLIENT-key
  // pre-check, because the client cannot mint the key any more. The push fans out to one ERP `Budget`
  // per phased fiscal year, and the years are only knowable from the client's live `Fiscal Year`
  // doctype — a read only the gate makes. So the SERVER derives one key per year from the gate's plan
  // and validates each derived key against this very guard before it can reach the outbox (below).
  // The exemption is scoped to (budget × create); every other budget operation and every other domain
  // still requires the caller's key here.
  const budgetKeyDerivedByServer = command.domain === ERPNEXT_BUDGET_DOMAIN && (command.operation as string) === 'create';
  const odooInvoiceKeyDerivedByServer = odooOwnsRevenueTier(employedTier) && command.domain === ERPNEXT_REVENUE_DOMAIN
    && command.operation === 'transition' && command.record.erp_doc_kind === 'sales-invoice' && command.record.verb === 'submit';
  if (odooInvoiceKeyDerivedByServer) {
    // One Odoo invoice is one PMO intent. Replace the per-click client key before adapter selection,
    // which also uses this identity to recognize a replay before it dry-builds the draft.
    command.idempotencyKey = odooRevenueAnchorKey('sales-invoice', command.record as Record<string, unknown>);
  }
  // #1504 S8: one PMO company is one Odoo partner, so a create's key follows the record (the client's per-click key is replaced).
  const odooCompanyKeyDerivedByServer = odooOwnsCompaniesTier(employedTier) && command.domain === 'companies' && command.operation === 'create';
  if (odooCompanyKeyDerivedByServer) {
    try { command.idempotencyKey = odooCompanyAnchorKey(command.record as Record<string, unknown>); }
    catch { return new Response(JSON.stringify({ error: 'commit-rejected', message: 'company-record-id-invalid' }), { status: 422, headers }); }
  }
  // #1511 F4: one PMO register or maintenance record is one Odoo record, so a CREATE's key follows the record (the client's
  // per-click key is replaced); an update keeps the caller's fresh key so it can be sent again after a lost answer.
  const odooEquipmentKeyDerivedByServer = command.domain === EQUIPMENT_DOMAIN && command.operation === 'create';
  if (odooEquipmentKeyDerivedByServer) {
    try { command.idempotencyKey = equipmentKey(command.record as Record<string, unknown>); }
    catch { return new Response(JSON.stringify({ error: 'commit-rejected', message: 'record-id-invalid' }), { status: 422, headers }); }
  }
  if (isErpDomain && !budgetKeyDerivedByServer && !odooInvoiceKeyDerivedByServer && !odooCompanyKeyDerivedByServer && !odooEquipmentKeyDerivedByServer && (command.operation as string) !== 'read' && !isOpaqueIdempotencyKey(command.idempotencyKey)) {
    return new Response(
      JSON.stringify({
        error: 'commit-rejected',
        message: command.idempotencyKey ? 'invalid-idempotency-key (must be a UUID)' : 'missing-idempotency-key',
      }),
      { status: 422, headers },
    );
  }

  // ── THE COMMAND'S IDENTITY IS GATE TRUTH, NOT CALLER INPUT (Luna code review BLOCK 3, round 1 + 2).
  // Server truth REPLACES the payload for every field the push is built from — the record's own id, the
  // author, the `approved_at` witness, the entries AND the deterministic idempotency KEY. Everything
  // downstream compares the id as TEXT (the outbox `pmo_record_id`, the `ts-correct:` advisory lock, the
  // one-in-flight partial index, external_refs) and reconciles on the key, so a caller-chosen spelling or
  // a caller-chosen key is a SECOND identity for one approval: the sweep does not collide with it and
  // mints its own row ⇒ a second ERP Timesheet ⇒ the week's hours counted twice. Placed AFTER the
  // opaque-key check above so a keyless/short-keyed caller still gets its 422 — the derivation replaces a
  // valid-shaped key, it does not excuse a missing one. The rationale lives with the helper.
  if (approvedSheet) applyCanonicalTimesheetTruth(command, approvedSheet);

  // service_role client — used for the machine-write helpers (read-model upsert/update + external_refs
  // record) AND, for 'tasks', to resolve the per-request ClickUp binding/mapping at adapter-select time.
  // Never used for adapter.commit() — org_id never crosses into the adapter (AC-EAS-023).
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, testSupabaseOptions);
  if (budgetActivationPrecheckVersionId) {
    try {
      const result = await runBudgetActivationPrecheck(
        buildBudgetGateDeps(callerClient, serviceClient, orgId, budgetActivationPrecheckVersionId, createErpAuthPairCache(), resolveErpBindingRow),
        await orgEmploysErpnext(serviceClient, orgId),
      );
      return new Response(JSON.stringify(result), { status: 200, headers });
    } catch (err) {
      const gateError = err instanceof BudgetGateError ? err : null;
      if (!gateError) console.error('[adapter-dispatch] budget activation precheck could not read readiness data');
      return new Response(JSON.stringify({
        error: gateError?.code ?? 'commit-rejected',
        message: gateError?.message ?? 'budget activation precheck could not read current budget data',
      }), { status: gateError ? 422 : 500, headers });
    }
  }
  // ── ECA-6 (#1603): the read-only ways forward when the ERP already holds a budget PMO did not create. It reads
  // the ERP and may create a PMO Draft under the CALLER's RLS; it never writes the ERP and uses no outbox row.
  if (isBudgetOccupantCommand(command)) {
    const allowed = await authorizeBudgetOccupant(callerClient as never, orgId, userId);
    if (!allowed.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: allowed.message }), { status: allowed.status, headers });
    }
    try {
      if (!externalConnectEnabled()) throw new AppError('external integrations are disabled by the operator', 'config-rejected');
      const binding = await resolveErpBindingRow(serviceClient, orgId);
      const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, { orgId, secretRef: binding.secret_ref }, createErpAuthPairCache());
      const reply = await runBudgetOccupant({
        command, orgId, callerClient: callerClient as never, serviceClient: serviceClient as never, binding,
        erp: { fetchImpl: guardedErpFetch(binding.site_url), apiKey, apiSecret, baseUrl: binding.site_url, rateLimiter: erpRateLimiter },
      });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      return new Response(JSON.stringify({ error: typeof code === 'string' ? code : 'DISPATCH_FAILED', message: err instanceof Error ? err.message : 'failed' }), {
        status: dispatchErrorStatus(code, 500), headers,
      });
    }
  }
  if (command.domain === CLICKUP_TASKS_DOMAIN) {
    const taskAuthorization = await authorizeClickUpTaskCommand(serviceClient as never, orgId, userId, command);
    if (!taskAuthorization.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: taskAuthorization.message }), {
        status: taskAuthorization.status ?? 403,
        headers,
      });
    }
  }
  const erpAuth = createErpAuthPairCache();

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

  // ── P3c — THE BUDGET GATE (ADR-0059 §3.3). Before adapter selection, the budget module re-reads
  // server truth, resolves the calendar/category plan, and persists the v16 account queue.
  const budgetPlan = await buildBudgetDispatchPlan({
    command,
    callerClient,
    serviceClient,
    orgId,
    erpAuth,
    headers,
    resolveBinding: resolveErpBindingRow,
  });
  if (budgetPlan instanceof Response) return budgetPlan;
  const { versionMajor: budgetVersionMajor, units: budgetUnits } = budgetPlan;
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

  // FR-PFE-010 (#1319) — the org's purchase rules, before any adapter/outbox/ERP work (rejection = no outbox row).
  {
    const procurementGate = await checkProcurementGate(serviceClient as never, orgId, command as never);
    if (!procurementGate.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: procurementGate.message }), {
        status: procurementGate.status,
        headers,
      });
    }
  }

  if (command.domain === 'procurement' && String(command.operation) === 'create') {
    const record = command.record as { procurementId?: unknown; erp_doc_kind?: unknown };
    if (record.erp_doc_kind === 'goods-receipt' || record.erp_doc_kind === 'purchase-invoice') {
      const { data, error } = await serviceClient.rpc('linked_step_state', {
        p_org_id: orgId, p_procurement_id: record.procurementId, p_step: record.erp_doc_kind,
      });
      const unlinkedPrefix = 'already_in_erp_unlinked:';
      const unlinkedName = typeof data === 'string' && data.startsWith(unlinkedPrefix) ? data.slice(unlinkedPrefix.length) : '';
      if (error || (!unlinkedName && !['already_in_erp', 'new_step', 'not_applicable'].includes(data))) {
        return new Response(JSON.stringify({ error: 'commit-rejected', message: 'Could not check the linked purchase step.' }), { status: 422, headers });
      }
      if (unlinkedName) {
        return new Response(JSON.stringify({ error: 'step_already_recorded', message: `ERP ${unlinkedName} already records this; link it instead of sending a new one.` }), { status: 409, headers });
      }
      if (data === 'already_in_erp') {
        return new Response(JSON.stringify({ error: 'step_already_recorded', message: 'This document is already linked from the ERP.' }), { status: 409, headers });
      }
    }
  }

  // FR-OPP-020 (AC-OPP-014) — an Odoo purchase needs its project's cost account resolved, before any outbox row or Odoo call.
  {
    const odooProjectGate = await checkOdooProjectGate(serviceClient as never, orgId, employedTier, command as never);
    if (!odooProjectGate.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: odooProjectGate.message }), {
        status: odooProjectGate.status,
        headers,
      });
    }
  }

  // AC-SCA-012 (#1513) — a PO revise never cancels a billed ERP order, and only the effective (highest issued) revision is
  // pushed (revision_superseded otherwise, 0742). Whether a revise cancels the ERP
  // order is the tier's own fact (dispatchAdapters.TIER_REVISE_CANCELS): ERPNext amends, Odoo edits in place.
  if (command.domain === 'procurement' && String(command.operation) === 'revise') {
    const rec = (command as { record?: { poId?: unknown; revision?: unknown } }).record ?? {};
    const poRevise = await checkPoRevise(serviceClient as never, orgId, { poId: rec.poId, revision: rec.revision }, { reviseCancels: reviseCancels(employedTier) });
    if (!poRevise.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: poRevise.message }), {
        status: poRevise.status,
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
    // #784 — a PMO-native invoice or receipt is never acted on through the ERP path (any operation).
    const erpPath = await checkRevenueErpPathTarget(serviceClient as never, command);
    if (!erpPath.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: erpPath.message }), {
        status: erpPath.status,
        headers,
      });
    }
    // An Odoo invoice draft has no Odoo mapping by design (OQ-OCI-1): its update and its approval target the PMO draft row itself.
    const odooDraft = odooOwnsRevenueTier(employedTier) ? await checkOdooDraftTarget(serviceClient as never, orgId, command) : null;
    if (odooDraft && !odooDraft.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: odooDraft.message }), { status: odooDraft.status, headers });
    }
    const binding = odooDraft?.ok && odooDraft.unmappedDraft ? { ok: true as const } : await checkTransitionTargetBinding(serviceClient as never, orgId, command);
    if (!binding.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: binding.message }), {
        status: binding.status,
        headers,
      });
    }
    // ⚑ BFY: for a budget fan-out this guard runs PER YEAR, inside the dispatch loop below, against
    // that year's own year-qualified identity + server-derived key — running it here on the bare
    // version id would ask about an identity nothing is ever keyed on.
    if (!budgetUnits) {
      const createTarget = await checkCreateTargetUnmapped(serviceClient as never, orgId, command, command.idempotencyKey);
      if (!createTarget.ok) {
        return new Response(JSON.stringify({ error: 'commit-rejected', message: createTarget.message }), {
          status: createTarget.status,
          headers,
        });
      }
    }
  }

  // ── #910 (FR-VPAY-005, DD-VPAY-5) — the vendor-payment money gate: SoD-b (approver ≠ payer) + the
  // case state, enforced on the DISPATCH path. On a flipped org the dispatched Payment Entry IS the
  // money release, so `transition_procurement`'s `Vendor Invoiced → Paid` SoD-b branch (0006) never
  // runs and authGuard's role check alone cannot stop the case's own approver from paying it (either
  // through the form or a direct dispatch). A procurement `payment` create therefore re-reads the
  // CASE from the DB — 403 with 0006's exact wording when the verified caller (`userId`, the JWT
  // sub, never a payload field) is the approver, 422 when the case is not at `Vendor Invoiced`, and
  // fail-closed on a missing/unreadable row. Runs BEFORE the outbox insert, so a refused payment
  // leaves no outbox row and touches no ERP. Positioned after the binding/target guards so a command
  // that is about to be rejected for those reasons never pays for this read.
  if (isProcurementPaymentCreate(command)) {
    const paymentGate = await enforcePaymentGate(
      serviceClient as never,
      orgId,
      userId,
      String((command.record as { procurementId?: unknown }).procurementId ?? ''),
    );
    if (!paymentGate.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: paymentGate.message }), {
        status: paymentGate.status,
        headers,
      });
    }
  }

  // FR-OPP-060 / FR-OPP-044 (AC-OPP-054): for a bill pushed to Odoo, the person who entered it cannot pay it, and a bill whose read-back
  // is flagged needs-attention is not payable. After the shared gate, so its wording and order are unchanged; before the outbox insert.
  {
    const odooPayment = await checkOdooPaymentGate(serviceClient as never, orgId, employedTier, userId, command as never);
    if (!odooPayment.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: odooPayment.message }), {
        status: odooPayment.status,
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
      // ⚑ Luna FU-1a round-6 — thread the EXACT outbox id + fencing token the hold was produced under
      // (stamped on the `command-held` AppError deep in the dispatch recovery) into the mirror writer,
      // so `record_timesheet_command_held` fences on that precise row+generation. ⚑ S1 (round 8): the
      // decision itself is `heldIdentityFor`, a tested pure function — this seam used to be the only
      // untested link between the tested stamp and the tested fence.
      const held = heldIdentityFor(failure as AppError & CommandHeldOutboxMarker);
      await markTimesheetPushOutcome(
        { serviceClient: serviceClient as never, orgId, callerUserId: userId },
        String(command.record.id),
        approvedSheet.approved_at,
        { code: failure.code, message: failure.message },
        held,
      );
    } catch (recordErr) {
      console.error('[adapter-dispatch] failed to record timesheet push failure:', recordErr);
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

  // ── An Odoo invoice draft (authoring and editing) is PMO's alone: no adapter, no outbox row, no Odoo call (OQ-OCI-1). Only the approval pushes. ──
  if (isOdooInvoiceDraftWrite(employedTier, command)) {
    const draft = await writeOdooInvoiceDraft({ serviceClient: serviceClient as never, orgId, userId, command });
    return new Response(JSON.stringify(draft.body), { status: draft.status, headers });
  }

  // ── 3. Adapter select (AC-EAS-033 step 2). ──
  const adapterFactory = selectAdapterFactory(employedTier, command.domain);
  if (!adapterFactory) {
    return new Response(
      JSON.stringify({ error: 'UNSUPPORTED_DOMAIN', message: `no adapter owns domain "${command.domain}"` }),
      { status: 400, headers },
    );
  }

  // #1714 — the command is an explicit per-attempt argument: `runDispatchAttempt` acts on the
  // command its caller names (the request command for a single dispatch, one unit's own command per
  // budget fan-out iteration), so no shared binding is ever re-assigned mid-loop.
  const runOneDispatch = (dispatchCommand: AdapterCommand, outboxRecordId?: string): Promise<{ ok: true; result: unknown } | { ok: false; response: Response }> =>
    runDispatchAttempt({
      command: dispatchCommand,
      // The receipt-line guard's registry key: the tier `checkCommandAuthorization` already employed
      // for this org/domain (never re-derived from the payload). Every dispatch that reaches here
      // passed the adapter-select gate on exactly this tier.
      tier: employedTier!,
      serviceClient,
      orgId,
      adapterFactory,
      faultGate,
      userId,
      erpAuth,
      moneyOutboxResolvers: MONEY_OUTBOX_RESOLVERS,
      budgetVersionMajor,
      headers,
      outboxRecordId,
      releaseSubmitClearance,
      recordTimesheetPushFailure,
    });

  try {
    // ── 4/5/6, ONCE for every domain — or ONCE PER PHASED FISCAL YEAR for a budget fan-out. ──
    if (!budgetUnits) {
      const attempt = await runOneDispatch(command);
      return attempt.ok
        ? new Response(JSON.stringify(attempt.result), { status: 200, headers })
        : attempt.response;
    }

    /**
     * ⚑ BFY FR-BFY-030/033/034 — THE FAN-OUT LOOP.
     *
     * EVERY year is attempted, even after one fails. A partial fan-out is a real, expected state (one
     * year's ERP `Budget` enforcing, another's refused), and the operator's route out is the per-year
     * status surface — which only exists if every year left a durable record. Aborting on the first
     * failure would leave the remaining years with no mirror row at all: indistinguishable from
     * "never attempted", and invisible to the sweep backstop whose work queue IS that mirror.
     *
     * The failure of one year is reported (the FIRST one, with its own classified status), never
     * swallowed; the years that DID push stay pushed — the ERP write already happened and PMO must
     * not pretend otherwise.
     */
    let lastResult: unknown = null;
    let firstFailure: Response | null = null;
    const yearOutcomes: Array<{ fiscal_year: string; pushed: boolean }> = [];
    for (const unit of budgetUnits) {
      // #1714 — the per-unit command. Each year is attempted under its OWN `AdapterCommand` (the
      // unit's gate-resolved record + server-derived key); `record.id` stays the bare version UUID,
      // everything that makes this year distinct rides on `record` + the key, and the request
      // command is never re-bound. The unit's `identity` remains the separate outbox argument.
      const unitCommand = commandForBudgetUnit(command, unit);

      // BLOCK #4, per year, on the year-qualified identity: a create for a (version, year) ERPNext
      // already holds must not mint a second Budget for it.
      const createTarget = await checkCreateTargetUnmapped(serviceClient as never, orgId, unitCommand, unit.idempotencyKey);
      if (!createTarget.ok) {
        const rejected = new AppError(createTarget.message, 'commit-rejected');
        await recordBudgetPushFailure({ serviceClient, orgId, command: unitCommand, budgetVersionMajor, failure: rejected });
        yearOutcomes.push({ fiscal_year: unit.fiscalYear, pushed: false });
        firstFailure ??= new Response(
          JSON.stringify({ error: 'commit-rejected', message: createTarget.message }),
          { status: createTarget.status, headers },
        );
        continue;
      }

      const attempt = await runOneDispatch(unitCommand, unit.identity);
      yearOutcomes.push({ fiscal_year: unit.fiscalYear, pushed: attempt.ok });
      if (attempt.ok) lastResult = attempt.result;
      else firstFailure ??= attempt.response;
    }
    if (firstFailure) return firstFailure;
    return new Response(JSON.stringify({ ...(lastResult as Record<string, unknown>), years: yearOutcomes }), {
      status: 200,
      headers,
    });
  } finally {
    // Finding 2: the submit has RESOLVED — successfully, rejected by ERP, or held. Either way the
    // clearance has served its purpose (it exists only to stop a body rewrite racing an IN-FLIGHT
    // submit), so release it here rather than leaving Finance blocked for the rest of the TTL.
    await releaseSubmitClearance();
  }
});
