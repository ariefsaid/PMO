// The sweep's money-write wiring (THEME-BACK-40, #1643): the outbox-recovery probe, the per-candidate and per-command
// DispatchMoneyWriteDeps every recovery and backstop pass drives through, and the sweep-side budget gates and fiscal
// calendar read they re-assert. Moved verbatim from index.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ERPNEXT_TIER } from '../_shared/erpnextFeedDeps.ts';
import { DOCTYPE_REGISTRY, reissueOnInconclusiveAbsence, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import { DOCTYPE_BODIES } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts';
import { PAYMENT_TYPE_BY_KIND } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/pollSpec.ts';
import { dispatchMoneyWrite as dispatchMoneyWriteCore, type DispatchMoneyWriteDeps, type ExternalRefMapping, type OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { withProbeBudget, ERP_PROBE_TIMEOUT_MS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { readJsonBounded, fetchWithDeadline } from '../_shared/fetchWithDeadline.ts';
import { readBudgetLineItems, readCategoryAccountMap, resolveErpDispatchAdapter, withPaymentTypeDiscriminator } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
// FR-BFY-075: the sweep re-runs the SAME gate the foreground dispatch runs, never a second copy.
import { runBudgetGate, type BudgetGateProjectRow, type BudgetGateResult, type BudgetVersionGateRow, type FiscalYearRow } from '../../../pmo-portal/src/lib/budget/budgetGate.ts';
import { isPermittedErpSiteUrl } from '../_shared/erpHostGuard.ts';
import { resolveErpAuthPair, type ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { canonicalCommandDigest, createDbMoneyOutboxDeps } from '../adapter-dispatch/moneyOutboxDeps.ts';
import { checkErpnextCommandAuthorization, checkOutboxReplayAuthorization, replayMayIssueErpWrite } from '../adapter-dispatch/authGuard.ts';
import { assertNotPreCutover, PRE_CUTOVER_CODE } from '../../../pmo-portal/src/lib/adapterSeam/cutoverGate.ts';
import { checkQueuedProcurementCreate } from '../adapter-dispatch/procurementGateGuard.ts';
import { getReadModelWriter } from '../adapter-dispatch/readModelWriters.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { probeErpByAnchorKey, probeErpByPaymentComposite, probeCapturedPayment, withholdingMatchFromPayload, type ErpProbeDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.ts';
import { ERPNEXT_COMPANIES_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { BudgetArchiveCancelIntent } from './budgetArchiveBackstop.ts';
import { budgetAccountArchiveKey, budgetAccountIdentity, budgetAccountPushKey, budgetLegacyArchiveKey, budgetLegacyIdentity, budgetRangeIdentity, parseBudgetIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { resolveV16BudgetAccounts } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountPlan.ts';
import { parseExactCents } from '../../../pmo-portal/src/lib/exactDecimal.ts';
import { type OrgBinding, orgErpFetch, orgErpTransport } from './sweepShared.ts';
import { BUDGET_SWEEP_GATE_HELD, readBudgetArchiveLifecycleLive, budgetArchiveTargetStillLiveAndOwnedLive } from './budgetOutboxFacts.ts';

/**
 * Luna round-5 BLOCK 4 — the sweep's outbox-recovery probe (`DispatchMoneyOutboxDeps.probeByRemarksKey`).
 *
 * Extracted from `buildReconcileDepsLive` so the discriminator guard is directly unit-provable
 * (`outboxProbeDiscriminator.test.ts`) rather than reachable only through a live Supabase + ERP wiring.
 *
 * Three shapes, one per anchor policy (ADR-0058 §3):
 *  - NO anchor field  ⇒ no probe at all (the kind has no recovery anchor; R3 adoption is forgone).
 *  - IMMUTABLE anchor (Purchase Invoice / Purchase Receipt `remarks`) ⇒ the plain anchor `like` probe.
 *  - MUTABLE anchor (Payment Entry `reference_no`) ⇒ the C-1 composite deterministic probe when this
 *    row's persisted payload carries its inputs, ELSE the anchor probe — and THAT fallback is the
 *    BLOCK-4 hole: `payment` (Pay) and `incoming-payment` (Receive) share the one `Payment Entry`
 *    doctype, so a bare anchor `like` could adopt a document of the WRONG direction whenever the two
 *    share a `reference_no` (an outgoing supplier payment mirrored as an incoming customer receipt —
 *    and a later `cancelPayment` then cancels the wrong, real, outgoing payment).
 *    `withPaymentTypeDiscriminator` (dispatchFactory.ts — the SAME guard the synchronous dispatch
 *    fallback uses, imported rather than re-implemented) conjoins the server-side `payment_type` filter
 *    AND the post-fetch validator, so a doc that does not STATE its direction is refused, not adopted.
 *    It is a no-op for every non-Payment-Entry kind (byte-for-byte).
 */
export function buildOutboxProbe(args: {
  probeDeps: ErpProbeDeps;
  /** The command's `erp_doc_kind` — the AUTHORITATIVE direction source for a Payment Entry. */
  kind: string;
  anchorField: string | null;
  anchorMutable: boolean;
  /** The outbox row's persisted `payload` (the composite probe's inputs, ADR-0058 C-1). */
  payload: Record<string, unknown>;
}): (domain: string, idempotencyKey: string) => Promise<{ externalRecordId: string; canonical?: PmoRecord } | null> {
  const { kind, anchorField, anchorMutable, payload } = args;
  const probeDeps = { ...args.probeDeps, requireSubmitted: Boolean(payload.capturedInvoiceDocumentId) };
  // BLOCK 4: the discriminated deps are what EVERY anchor-probe path in here uses.
  const anchorProbeDeps = withPaymentTypeDiscriminator(probeDeps, kind);
  if (!anchorField) return () => Promise.resolve(null);
  if (!anchorMutable) return (_domain, idempotencyKey) => probeErpByAnchorKey(anchorProbeDeps, idempotencyKey);
  // deno-lint-ignore require-await -- preserve async rejection semantics for malformed persisted payloads.
  return async (_domain, idempotencyKey) => {
    // The direction comes from the KIND (what PMO commanded), falling back to the persisted payload
    // only for a kind that is not one of the two Payment Entry kinds — never a bare 'Pay' default,
    // which would probe the wrong direction for a Receive row whose payload omitted `payment_type`.
    if (payload.capturedInvoiceDocumentId) return probeCapturedPayment(probeDeps, idempotencyKey, payload);
    const paymentType: 'Pay' | 'Receive' =
      PAYMENT_TYPE_BY_KIND[kind as ErpDocKind] ?? (payload.payment_type === 'Receive' ? 'Receive' : 'Pay');
    if (!payload.party || payload.paid_amount == null) return probeErpByAnchorKey(anchorProbeDeps, idempotencyKey);
    return probeErpByPaymentComposite(probeDeps, idempotencyKey, {
      partyType: String(payload.party_type ?? 'Supplier'),
      party: String(payload.party),
      paidAmount: payload.paid_amount as string | number,
      piNames: Array.isArray(payload.pi_names) ? (payload.pi_names as string[]) : [],
      siNames: Array.isArray(payload.si_names) ? (payload.si_names as string[]) : [],
      createdAfter: String(payload.created_after ?? ''),
      paymentType,
      ...withholdingMatchFromPayload(payload),
      // #775 phase B — an Employee Payment Entry's cited approval Journal Entry and its two accounts (frozen with
      // the command; conjoined only for an Employee party).
      journalNames: Array.isArray(payload.je_names) ? (payload.je_names as string[]) : undefined,
      paidFrom: typeof payload.paid_from === 'string' ? payload.paid_from : undefined,
      paidTo: typeof payload.paid_to === 'string' ? payload.paid_to : undefined,
    });
  };
}


/** A terminal `last_error` marker the held-refusal stamp must never replace (0868: a rejected captured payment). */
const TERMINAL_LAST_ERROR = 'captured_invoice_payment_rejected';

/**
 * #1680: records a held pre-connection step's refusal in the row's own `last_error`, so the recovery pass reports it once
 * and stays quiet while the same refusal repeats (`reconcileOrgOutbox`). Writes `last_error` only — no state, attempt or
 * `updated_at` change, so the row's place in the candidate list and its retry timing are exactly as before — and only on
 * the unclaimed row the sweep read (same state, same claim generation). A terminal marker is never replaced, including
 * one written concurrently (the update filter). Best effort: a failed write is logged by its code and the row reports
 * again on the next tick, which is the behaviour before #1680.
 */
async function recordHeldRefusal(serviceClient: SupabaseClient, orgId: string, row: OutboxRow, message: string): Promise<void> {
  if (row.lastError === message || row.lastError === TERMINAL_LAST_ERROR) return;
  try {
    const { error } = await serviceClient.from('external_command_outbox').update({ last_error: message })
      .eq('id', row.id).eq('org_id', orgId).eq('state', row.state).eq('claim_generation', row.claimGeneration)
      .or(`last_error.is.null,last_error.neq.${TERMINAL_LAST_ERROR}`);
    if (error) console.warn('[erpnext-sweep] held-refusal stamp failed', error.code ?? 'unknown');
  } catch {
    console.warn('[erpnext-sweep] held-refusal stamp failed', 'thrown');
  }
}

/**
 * The full per-candidate `DispatchMoneyWriteDeps` wiring (SPEC-REVIEW RULING — the `not-implemented`
 * sentinel is retired: the C-1 'held' state makes sweep-side reconciliation the operational PE-recovery
 * path). Reassembles the SAME building blocks adapter-dispatch uses per request — `createDbMoneyOutboxDeps`
 * (the fenced outbox ops + the composite/anchor probe + the reissue policy), `resolveErpDispatchAdapter`
 * (the per-org ERP adapter), and the read-model writers — reconstructing the command from the outbox row
 * + its persisted `payload.erp_doc_kind`. Inert in practice until an org is flipped AND a money command
 * leaves a candidate (no employing org ⇒ no candidate ⇒ this never fires — "inert-by-empty-map").
 */
export async function buildReconcileDepsLive(serviceClient: SupabaseClient, org: OrgBinding, row: OutboxRow, cache?: ErpAuthPairCache): Promise<DispatchMoneyWriteDeps> {
  // Re-read the persisted operation + payload (the OutboxRow projection drops them) to reconstruct the command.
  // `actor_user_id` (0108): the ORIGINAL command's verified caller. Without it a sweep-finalized SI
  // mirror lands `author_user_id = NULL`, and the approver≠author SoD check then passes for everyone.
  const { data, error } = await serviceClient.from('external_command_outbox')
    .select('operation, payload, actor_user_id, procurement_input_digest').eq('id', row.id).maybeSingle();
  if (error || !data) throw new AppError(`outbox row ${row.id} not readable for reconcile`, error?.code ?? 'not-found');
  const rowExtra = data as { operation: 'create' | 'update' | 'transition'; payload: Record<string, unknown> | null; actor_user_id: string | null; procurement_input_digest: string | null };
  const payload = rowExtra.payload ?? {};

  // WIRE 1 / round-7 B6 — RE-ASSERT authorization before replaying a FROZEN command. The recovery pass
  // reconstructs the command from the persisted payload and calls `dispatchMoneyWrite` directly, so a
  // replay re-runs NONE of the synchronous dispatch gates: without this, a user could issue a money
  // command, be demoted / deactivated / have their org's domain ownership revoked, and the cron would
  // still POST it up to 24 hours later. The rule is not forked — this is the SAME
  // `checkErpnextCommandAuthorization` the synchronous path runs, against the row's RECORDED actor
  // (0108 §C) and the org's CURRENT state.
  //
  // Runs BEFORE credential/adapter resolution, so a refusal never touches ERP. It THROWS, which
  // `reconcileOrgOutbox` records as a per-candidate error while leaving the row byte-for-byte as it is
  // (no state change, no ERP call) — held for an operator and surfaced as `reconcile:<id>:<message>`,
  // exactly like the `domain-not-owned` hold. A money row is never dropped. `reconcileOrgOutbox`'s
  // `ownedDomains` pre-filter stays as the cheap early-out; THIS is the authority.
  const replayAuth = await checkOutboxReplayAuthorization(serviceClient as never, org.orgId, {
    id: row.id,
    state: row.state,
    domain: row.domain,
    operation: rowExtra.operation,
    pmoRecordId: row.pmoRecordId,
    actorUserId: rowExtra.actor_user_id,
    payload,
  });
  if (!replayAuth.ok) throw new AppError(replayAuth.message, 'commit-rejected');
  // ECA-4 backstop (FR-ECA-030): dispatch refuses a later step of a purchase ordered before the connection, so no such
  // row should exist; one that does (queued before this rule) is held here, before credentials, rather than re-driven.
  // Same states as the authorization above: only a replay that can mint a new ERP document is checked.
  if (replayMayIssueErpWrite(row.state)) {
    try {
      await assertNotPreCutover(serviceClient as never, { domain: row.domain, record: payload });
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === PRE_CUTOVER_CODE) await recordHeldRefusal(serviceClient, org.orgId, row, (err as Error).message);
      throw err;
    }
  }

  let trustedReceiptSnapshot = false;
  if (rowExtra.procurement_input_digest != null) {
    const marker = payload.pmo_gr_snapshot as { raw_digest?: unknown; supplier?: unknown; po?: unknown } | undefined;
    const { created_after: _createdAfter, ...material } = payload;
    const digest = await canonicalCommandDigest({ domain: row.domain, operation: rowExtra.operation, record: material });
    if (row.domain !== 'procurement' || rowExtra.operation !== 'create' || payload.erp_doc_kind !== 'goods-receipt'
        || !/^[0-9a-f]{64}$/.test(rowExtra.procurement_input_digest)
        || !marker || marker.raw_digest !== rowExtra.procurement_input_digest
        || (marker.supplier !== null && typeof marker.supplier !== 'string')
        || (marker.po !== null && typeof marker.po !== 'string') || row.payloadDigest !== digest) {
      throw new AppError('receipt snapshot is inconsistent', 'commit-rejected');
    }
    trustedReceiptSnapshot = true;
  }

  // ⚑ FR-BFY-075 (review finding 5) — RE-RUN THE BUDGET GATE FOR THE FROZEN YEAR, BEFORE ANY POST.
  //
  // Everything below reconstructs a command that was frozen when the operator activated the budget —
  // possibly hours ago. The project's dates, the client's `Fiscal Year` calendar, the version's line
  // items and the category map can ALL have moved since. Without this the sweep would install an ERP
  // `Budget` for a year the project no longer occupies (or a figure PMO no longer stands behind), with
  // no operator present and no gate having agreed to it. It is the SAME `runBudgetGate` the foreground
  // path runs — not a second copy of the rule — reading the CURRENT truth.
  //
  // Read under SERVICE ROLE: the sweep carries no user JWT, and the row's recorded actor was
  // re-authorized immediately above (0108 §C). Every read is explicitly org-scoped, since service role
  // bypasses RLS.
  //
  // A refusal THROWS with the named `budget-sweep-gate-held` code. `reconcileOrgOutbox` records it as a
  // per-candidate error and leaves the row EXACTLY as it is — no state change, no ERP call — so the
  // operator sees it and the recovery resumes by itself the moment the cause is fixed. (It is not
  // transitioned to the outbox `held` state: this path holds no claim, so it cannot make a fenced
  // write-back, and a `held` row would additionally need an Admin release even after the operator had
  // already corrected the dates. The money-critical property — never POST a body the current gate would
  // reject — is what the throw guarantees.)
  await assertBudgetSweepGate(serviceClient, org, payload, row, cache, rowExtra.actor_user_id);

  const command: AdapterCommand = {
    domain: row.domain as AdapterCommand['domain'],
    operation: rowExtra.operation,
    record: payload as AdapterCommand['record'],
    idempotencyKey: row.idempotencyKey,
  };
  return buildMoneyWriteDepsLive(serviceClient, org,
    { command, actorUserId: rowExtra.actor_user_id, outboxRecordId: row.pmoRecordId, persistPayload: false, trustedReceiptSnapshot }, cache);
}

/**
 * The money-write deps for ONE command, given its actor and outbox identity — the body `buildReconcileDepsLive`
 * always had, extracted so the expense pass (#775 phase B) can drive a FRESH command through the identical
 * outbox/probe/fence/re-authorization machinery. `persistPayload` is set only for a fresh command: it makes the
 * outbox INSERT carry the payload and the recorded actor (a recovery row already has both).
 */
export function moneyWriteReplayOptions(persistPayload: boolean): { replay: boolean } {
  return { replay: !persistPayload };
}

export function moneyWriteReadModelContext(args: { orgId: string; actorUserId: string | null; isReplay?: boolean }) {
  return {
    orgId: args.orgId,
    callerUserId: args.actorUserId ?? undefined,
    isReplay: args.isReplay ?? false,
  };
}

/** Runs after a swept money write lands (set by `buildMoneyWriteDepsLive`). */
type SweepAfterSuccess = { afterSuccess?: () => Promise<void> };

/**
 * ECA-6: every sweep dispatch goes through here, so a replace the sweep finishes spends its consent exactly as the
 * foreground push does. Runs only after `dispatchMoneyWrite` resolves; a spend failure is logged, not surfaced (the
 * consent names a document that is now cancelled, so it unlocks nothing).
 */
export async function dispatchMoneyWrite(deps: DispatchMoneyWriteDeps & SweepAfterSuccess): ReturnType<typeof dispatchMoneyWriteCore> {
  const result = await dispatchMoneyWriteCore(deps);
  await deps.afterSuccess?.();
  return result;
}

export async function buildMoneyWriteDepsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  args: { command: AdapterCommand; actorUserId: string | null; outboxRecordId: string; persistPayload: boolean; trustedReceiptSnapshot?: boolean },
  cache?: ErpAuthPairCache,
): Promise<DispatchMoneyWriteDeps & SweepAfterSuccess> {
  const command = args.command;
  const operation = command.operation as 'create' | 'update' | 'transition';
  const payload = command.record as Record<string, unknown>;
  const kind = payload.erp_doc_kind;
  const entry = typeof kind === 'string' && kind in DOCTYPE_REGISTRY ? DOCTYPE_REGISTRY[kind as ErpDocKind] : undefined;
  const bodyFns = typeof kind === 'string' ? DOCTYPE_BODIES[kind as ErpDocKind] : undefined;
  if (!entry || !bodyFns) {
    // Loud (never a silent no-op): a candidate whose kind we cannot resolve needs an operator, not a POST.
    throw new AppError(`erpnext-sweep reconcile: unresolvable erp_doc_kind '${String(kind)}' for ${command.domain}/${args.outboxRecordId}`, 'commit-rejected');
  }

  const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, org, cache);
  // BLOCK 1 (money double-POST): the recovery probe must not burn the claim budget. withProbeBudget
  // caps it (maxRetries 0 + tighter deadline) so a hung probe surfaces as unreachable instead of
  // consuming the whole 300s quarantine window and letting a claimant POST after its own reissue.
  const client = withProbeBudget({ ...orgErpTransport(org), apiKey, apiSecret, baseUrl: org.siteUrl });

  // ECA-6: a budget replace the sweep finishes names its recorded consent; it is spent once the write lands.
  let occupantConsentId: string | null = null;
  const adapter = await resolveErpDispatchAdapter({
    serviceClient: serviceClient as never,
    orgId: org.orgId,
    actorUserId: args.actorUserId ?? undefined,
    command,
    ...orgErpTransport(org),
    apiKey,
    apiSecret,
    rateLimiter: { acquire: async () => {} },
    onOccupantConsent: (id) => { occupantConsentId = id; },
    doctypeBodies: DOCTYPE_BODIES,
    // #858: recovery replays the persisted items/taxes (inside the digest) and makes no ERPNext read to rebuild them.
    // Fresh expense commands carry their own frozen payload and must use the ordinary first-build path.
    ...moneyWriteReplayOptions(args.persistPayload),
    trustedReceiptSnapshot: args.trustedReceiptSnapshot,
  });

  const anchorField = entry.anchorField;
  const probeDeps = { client, doctype: entry.doctype, anchorField: anchorField ?? '', fromDoc: bodyFns.fromDoc, pmoRecordId: args.outboxRecordId };
  const encodeExternalRecordId = (mapping: ExternalRefMapping): string =>
    mapping.domain === ERPNEXT_COMPANIES_DOMAIN ? `${entry.doctype}:${mapping.externalRecordId}` : mapping.externalRecordId;

  const { created_after: _createdAfter, ...digestPayload } = payload;
  const payloadDigest = await canonicalCommandDigest({ domain: command.domain, operation: command.operation, record: digestPayload });
  const money = createDbMoneyOutboxDeps({
    serviceClient: serviceClient as never,
    orgId: org.orgId,
    externalTier: ERPNEXT_TIER,
    operation,
    // C-1 per-kind reissue policy: a mutable-anchor (PE) inconclusive recovery is HELD, never reissued.
    // ⚑ HIGH-1: an `upsertOnGrain` kind (ERP `Budget`) has no anchor at ALL, but ERP itself enforces its
    // natural grain, so the dispatch factory's server-derived grain read is a conclusive probe and a
    // recovery may reissue — holding instead made the upsert's unenforced-grain window PERMANENT. The
    // rule lives in ONE place (`reissueOnInconclusiveAbsence`, doctypeRegistry.ts) so the sync dispatch
    // and the sweep can never disagree about whether a money command may be re-minted.
    reissueOnInconclusiveAbsence: reissueOnInconclusiveAbsence(entry),
    payloadDigest,
    encodeExternalRecordId,
    // BLOCK 4: one shared builder — the mutable-anchor (Payment Entry) FALLBACK carries the same
    // `payment_type` discriminator the synchronous dispatch fallback uses, so a Receive recovery can
    // never adopt a Pay document (and vice-versa) through a shared `reference_no`.
    probeByRemarksKey: buildOutboxProbe({ probeDeps, kind: String(kind), anchorField, anchorMutable: entry.anchorMutable === true, payload }),
    // FIX 2 (round-9 SHOULD-FIX): a post-window RECOVERY REISSUE (a quarantined immutable-anchor row
    // whose probe misses → a fresh ERP POST) re-asserts the RECORDED actor's CURRENT authorization. The
    // pre-dispatch `checkOutboxReplayAuthorization` above re-authorizes only pending/failed (so it does
    // not also block an ADOPT of a real ERP doc); this closes the quarantined→reissue gap with the SAME
    // `checkErpnextCommandAuthorization` rule the synchronous gate + that replay check run. Consulted by
    // `dispatch.ts` ONLY on the actual reissue branch — an adopt or a mutable-anchor hold never calls it.
    // Fail-CLOSED on an unattributable row; a refusal HOLDS the row for an operator (never dropped).
    // #775 phase B — a FRESH command (the expense pass) persists its frozen payload + recorded actor at INSERT, so a
    // later replay re-reads exactly what was digested and re-authorizes the same person.
    ...(args.persistPayload ? { payload, actorUserId: args.actorUserId ?? undefined } : {}),
    reauthorizeRecoveryReissue: async () => {
      if (!args.actorUserId) {
        return { ok: false, message: `outbox row ${args.outboxRecordId} has no recorded actor — reissue held for an operator` };
      }
      const res = await checkErpnextCommandAuthorization(serviceClient as never, org.orgId, args.actorUserId, {
        domain: command.domain,
        record: { erp_doc_kind: payload.erp_doc_kind },
      });
      if (!res.ok) return { ok: res.ok, message: res.message };
      // A reissued procurement create answers the org's CURRENT purchase rules (the same question the outbox claim
      // asks of a pending or failed row), so a rule turned on after the command was queued refuses the new document.
      return checkQueuedProcurementCreate(serviceClient as never, org.orgId, { domain: command.domain, operation, record: payload }, args.actorUserId);
    },
  });

  const writeReadModel = async (canonical: PmoRecord, options?: { isReplay?: boolean }): Promise<void> => {
    await getReadModelWriter(command.domain).upsert(
      { serviceClient: serviceClient as never, ...moneyWriteReadModelContext({
        orgId: org.orgId, actorUserId: args.actorUserId, isReplay: options?.isReplay,
      }) },
      canonical,
      command,
    );
  };
  const recordExternalRef = (mapping: ExternalRefMapping): Promise<void> =>
    recordExternalRefWrite(serviceClient as never, { ...mapping, externalRecordId: encodeExternalRecordId(mapping), orgId: org.orgId });

  // FR-BFY-032: the outbox row + `external_refs` are keyed on the row's OWN `pmo_record_id` — the
  // year-qualified `<vid>:<encoded_fy>` for a budget fan-out, the bare record id for every other
  // domain (where the two are the same string, so this is byte-for-byte).
  const afterSuccess = async (): Promise<void> => {
    if (!occupantConsentId) return;
    const { error: spendError } = await serviceClient.rpc('consume_budget_occupant_consent', {
      p_org_id: org.orgId, p_id: occupantConsentId, p_actor_id: args.actorUserId,
    });
    if (spendError) console.error('[erpnext-sweep] could not spend the budget replace consent:', spendError.message);
  };
  return { adapter, command, writeReadModel, recordExternalRef, money, outboxRecordId: args.outboxRecordId, afterSuccess };
}

/**
 * FR-BFY-075 — the frozen budget command's gate re-run. A no-op for every other domain.
 *
 * Refuses when the CURRENT gate would refuse (unresolvable/ambiguous calendar, a project that no longer
 * occupies the year, an un-phased line on a now-multi-FY project, an unmapped category) AND when the
 * gate passes but its plan no longer contains the frozen year — a re-phase moves a year out of the plan
 * without the gate itself objecting, and POSTing that year would enforce a budget PMO no longer states.
 */
async function assertBudgetArchiveSweepGate(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  payload: Record<string, unknown>,
  outbox: OutboxRow,
  outboxActorUserId: string | null,
): Promise<void> {
  const jobId = typeof payload.budget_archive_cancel_job_id === 'string' ? payload.budget_archive_cancel_job_id : '';
  if (!jobId) throw new AppError('budget archive recovery HELD: cancellation job witness is missing', BUDGET_SWEEP_GATE_HELD);
  const { data, error } = await serviceClient.from('budget_archive_cancel_intents')
    .select('id,org_id,request_id,project_id,budget_version_id,source_mirror_id,source_kind,actor_user_id,fiscal_year,to_fiscal_year,erp_modified,erp_account,erp_budget_name,activated_at_witness,pushed_project_start_date,pushed_project_end_date,state')
    .eq('id', jobId).eq('org_id', org.orgId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const job = data as (BudgetArchiveCancelIntent & { state: string }) | null;
  if (!job) throw new AppError('budget archive recovery HELD: cancellation job no longer exists', BUDGET_SWEEP_GATE_HELD);

  const { data: request, error: requestError } = await serviceClient.from('budget_archive_requests')
    .select('id,org_id,project_id,budget_version_id,requested_by,cancel_erp')
    .eq('id', job.request_id).eq('org_id', job.org_id).maybeSingle();
  if (requestError) throw new AppError(requestError.message, requestError.code);
  if (!request || request.project_id !== job.project_id || request.budget_version_id !== job.budget_version_id ||
      request.requested_by !== job.actor_user_id || request.cancel_erp !== true ||
      outboxActorUserId !== job.actor_user_id) {
    throw new AppError('budget archive recovery HELD: original archive request or actor changed', BUDGET_SWEEP_GATE_HELD);
  }

  const versionId = String(payload.id ?? '');
  const legacy = (job.source_kind ?? 'account') === 'legacy';
  let identity: string;
  let key: string;
  try {
    identity = legacy
      ? budgetLegacyIdentity(job.budget_version_id, job.fiscal_year)
      : job.to_fiscal_year
        ? budgetRangeIdentity(job.budget_version_id, job.fiscal_year, job.to_fiscal_year, job.erp_account!)
        : budgetAccountIdentity(job.budget_version_id, job.fiscal_year, job.erp_account!);
    key = legacy
      ? budgetLegacyArchiveKey(identity, job.activated_at_witness)
      : budgetAccountArchiveKey(identity, job.activated_at_witness);
  } catch { throw new AppError('budget archive recovery HELD: cancellation identity is invalid', BUDGET_SWEEP_GATE_HELD); }
  if (versionId !== job.budget_version_id || payload.projectId !== job.project_id ||
      payload.budget_archive_source_mirror_id !== job.source_mirror_id ||
      payload.fiscal_year !== job.fiscal_year ||
      (legacy ? job.to_fiscal_year != null : (payload.to_fiscal_year ?? null) !== (job.to_fiscal_year ?? null)) ||
      (job.to_fiscal_year != null && (payload.budget_mode !== 'whole_project' ||
        payload.budget_predecessor_modified !== job.erp_modified)) ||
      (legacy ? payload.erp_account != null : payload.erp_account !== job.erp_account) ||
      (legacy ? payload.source_kind !== 'legacy' : payload.source_kind != null) ||
      payload.budget_intent !== 'remove' || payload.budget_predecessor !== job.erp_budget_name ||
      payload.outbox_identity !== identity || payload.activated_at !== job.activated_at_witness ||
      outbox.pmoRecordId !== identity || outbox.idempotencyKey !== key) {
    throw new AppError('budget archive recovery HELD: frozen cancellation does not match its durable intent', BUDGET_SWEEP_GATE_HELD);
  }

  // A committed document is already cancelled in ERPNext; only finalize its PMO read model. Pending,
  // failed and post-window quarantined replays can all issue a new write and must recheck lifecycle.
  if (outbox.state === 'committed' || outbox.state === 'confirmed') return;
  if (job.state !== 'pending') {
    throw new AppError('budget archive recovery HELD: cancellation intent is no longer pending', BUDGET_SWEEP_GATE_HELD);
  }
  const lifecycle = await readBudgetArchiveLifecycleLive(serviceClient, job);
  if (!lifecycle || lifecycle.status !== 'Archived' || lifecycle.activatedAt !== job.activated_at_witness || lifecycle.activeSuccessorUsesTarget) {
    throw new AppError('budget archive recovery HELD: archived version or active target witness changed', BUDGET_SWEEP_GATE_HELD);
  }
  if (!(await budgetArchiveTargetStillLiveAndOwnedLive(serviceClient, job))) {
    throw new AppError('budget archive recovery HELD: ERP Budget predecessor witness changed', BUDGET_SWEEP_GATE_HELD);
  }
}

async function assertBudgetSweepGate(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  payload: Record<string, unknown>,
  outbox: OutboxRow,
  cache?: ErpAuthPairCache,
  outboxActorUserId: string | null = null,
): Promise<void> {
  if (payload.erp_doc_kind !== 'budget') return;
  const versionId = String(payload.id ?? '');
  const frozenYear = typeof payload.fiscal_year === 'string' ? payload.fiscal_year : '';
  if (!versionId || !frozenYear) {
    throw new AppError(
      `erpnext-sweep budget recovery: the frozen command names no version/fiscal year — refusing to POST it (${versionId}/${frozenYear})`,
      BUDGET_SWEEP_GATE_HELD,
    );
  }
  if (payload.budget_archive_cancel_job_id !== undefined) {
    await assertBudgetArchiveSweepGate(serviceClient, org, payload, outbox, outboxActorUserId);
    return;
  }
  let plan: BudgetGateResult;
  try {
    plan = await runBudgetGate({
      orgId: org.orgId,
      versionId,
      readVersion: async (id) => {
        const { data, error } = await serviceClient
          .from('budget_versions')
          .select('id, org_id, project_id, status, activated_at, budget_mode')
          .eq('id', id)
          .eq('org_id', org.orgId)
          .maybeSingle();
        if (error) throw new AppError(error.message, error.code);
        return (data as BudgetVersionGateRow | null) ?? null;
      },
      readProject: async (id) => {
        const { data, error } = await serviceClient
          .from('projects')
          .select('id, org_id, start_date, end_date')
          .eq('id', id)
          .eq('org_id', org.orgId)
          .maybeSingle();
        if (error) throw new AppError(error.message, error.code);
        return (data as BudgetGateProjectRow | null) ?? null;
      },
      readLineItems: (id) => readBudgetLineItems(serviceClient as never, id),
      readCategoryMap: () => readCategoryAccountMap(serviceClient as never, org.orgId),
      readFiscalYears: () => readErpFiscalYearsLive(serviceClient, org, cache),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new AppError(
      `erpnext-sweep budget recovery HELD for fiscal year ${frozenYear}: the push gate would now refuse this budget — ${reason}`,
      BUDGET_SWEEP_GATE_HELD,
    );
  }
  const versionMajor = org.versionMajor ?? 15;
  if (versionMajor !== 16) {
    if (!plan.plan.some((entry) => entry.fiscal_year === frozenYear)) {
      throw new AppError(
        `erpnext-sweep budget recovery HELD for fiscal year ${frozenYear}: the active budget no longer phases any line to that year, ` +
          `so PMO no longer states a budget for it (current plan: ${plan.plan.map((e) => e.fiscal_year).join(', ') || 'none'})`,
        BUDGET_SWEEP_GATE_HELD,
      );
    }
    return;
  }

  let identity: ReturnType<typeof parseBudgetIdentity>;
  try {
    identity = parseBudgetIdentity(outbox.pmoRecordId);
  } catch {
    throw new AppError('erpnext-sweep budget recovery HELD: frozen account identity is invalid', BUDGET_SWEEP_GATE_HELD);
  }
  const account = identity.erpAccount;
  const frozenAccount = typeof payload.erp_account === 'string' ? payload.erp_account : null;
  const isWholeProjectRange = plan.budgetMode === 'whole_project';
  if (!account || !frozenAccount || account !== frozenAccount || identity.versionId !== versionId ||
      identity.fiscalYear !== frozenYear ||
      (isWholeProjectRange
        ? identity.kind !== 'range' || identity.toFiscalYear !== payload.to_fiscal_year
        : identity.kind !== 'annual' || identity.toFiscalYear !== null)) {
    throw new AppError('erpnext-sweep budget recovery HELD: frozen account identity is missing or inconsistent', BUDGET_SWEEP_GATE_HELD);
  }
  let currentKey: string;
  try {
    currentKey = budgetAccountPushKey(outbox.pmoRecordId, plan.activatedAt);
  } catch {
    throw new AppError('erpnext-sweep budget recovery HELD: current activation witness is invalid', BUDGET_SWEEP_GATE_HELD);
  }
  if (currentKey !== outbox.idempotencyKey) {
    throw new AppError('erpnext-sweep budget recovery HELD: activation changed since this account intent was created', BUDGET_SWEEP_GATE_HELD);
  }

  if (isWholeProjectRange) {
    const range = plan.range;
    if (!range || !plan.distributionRows || range.fromFiscalYear !== frozenYear ||
        range.toFiscalYear !== identity.toFiscalYear || payload.budget_mode !== 'whole_project') {
      throw new AppError('erpnext-sweep budget recovery HELD: approved range basis is missing or changed', BUDGET_SWEEP_GATE_HELD);
    }
    let desiredRangeAccounts: ReturnType<typeof resolveV16BudgetAccounts>;
    try { desiredRangeAccounts = resolveV16BudgetAccounts(plan.sourceLineItems, plan.categoryMap); }
    catch (err) {
      throw new AppError(`erpnext-sweep budget recovery HELD: current range account resolution failed — ${err instanceof Error ? err.message : String(err)}`, BUDGET_SWEEP_GATE_HELD);
    }
    const removeRangeAccount = payload.budget_intent === 'remove';
    if (!removeRangeAccount) {
      const accountMap = plan.categoryMap.filter((row) => row.erp_account === account).map((row) => row.category)
        .filter((category) => plan.sourceLineItems.some((line) => line.category === category));
      const yearAmounts = payload.year_amounts;
      if (accountMap.length !== 1 || !Array.isArray(yearAmounts) || yearAmounts.length !== range.fiscalYears.length) {
        throw new AppError('erpnext-sweep budget recovery HELD: frozen range amount vector is missing or ambiguous', BUDGET_SWEEP_GATE_HELD);
      }
      const categoryRows = plan.distributionRows.filter((row) => row.category === accountMap[0]);
      const expected = range.fiscalYears.map((year, index) => {
        const row = categoryRows.find((candidate) => candidate.fiscal_year === year.name && candidate.ordinal === index);
        const amount = row ? parseExactCents(row.amount) : null;
        if (amount === null) throw new AppError('erpnext-sweep budget recovery HELD: approved range row is missing or malformed', BUDGET_SWEEP_GATE_HELD);
        return { year: year.name, amount };
      });
      const actual = yearAmounts.map((candidate) => {
        if (!candidate || typeof candidate !== 'object') return null;
        const value = candidate as Record<string, unknown>;
        return typeof value.year === 'string' && typeof value.amount === 'string'
          ? { year: value.year, amount: parseExactCents(value.amount) }
          : null;
      });
      if (actual.some((row, index) => row === null || row.year !== expected[index]?.year || row.amount !== expected[index]?.amount)) {
        throw new AppError('erpnext-sweep budget recovery HELD: frozen range amount vector differs from the approved distribution', BUDGET_SWEEP_GATE_HELD);
      }
    }
    if (removeRangeAccount) {
      if (desiredRangeAccounts.some((row) => row.account === account)) {
        throw new AppError('erpnext-sweep budget recovery HELD: removed range account is desired again', BUDGET_SWEEP_GATE_HELD);
      }
      const predecessor = typeof payload.budget_predecessor === 'string' ? payload.budget_predecessor : '';
      if (!predecessor) throw new AppError('erpnext-sweep budget recovery HELD: range removal has no predecessor witness', BUDGET_SWEEP_GATE_HELD);
      const prior = await serviceClient.from('budget_version_account_erp_mirror')
        .select('budget_version_id,erp_budget_name,to_fiscal_year,budget_versions!inner(project_id)')
        .eq('org_id', org.orgId).eq('budget_versions.project_id', plan.projectId)
        .eq('fiscal_year', frozenYear).eq('to_fiscal_year', identity.toFiscalYear)
        .eq('erp_account', account).eq('erp_budget_name', predecessor)
        .eq('budget_intent', 'ensure').is('erp_cancelled_at', null).maybeSingle();
      if (prior.error || !prior.data || (prior.data as { to_fiscal_year?: unknown }).to_fiscal_year !== identity.toFiscalYear) {
        throw new AppError('erpnext-sweep budget recovery HELD: range predecessor has no exact same-org project/range/account witness', BUDGET_SWEEP_GATE_HELD);
      }
      const priorVersionId = String((prior.data as { budget_version_id?: unknown }).budget_version_id ?? '');
      let reverseIdentity: string;
      try { reverseIdentity = budgetRangeIdentity(priorVersionId, frozenYear, identity.toFiscalYear!, account); }
      catch { throw new AppError('erpnext-sweep budget recovery HELD: range predecessor identity is invalid', BUDGET_SWEEP_GATE_HELD); }
      const reverseRef = await serviceClient.from('external_refs').select('external_record_id')
        .eq('org_id', org.orgId).eq('domain', 'budget').eq('external_tier', ERPNEXT_TIER)
        .eq('pmo_record_id', reverseIdentity).eq('external_record_id', predecessor).maybeSingle();
      if (reverseRef.error || !reverseRef.data) throw new AppError('erpnext-sweep budget recovery HELD: range predecessor has no reverse reference witness', BUDGET_SWEEP_GATE_HELD);
    } else if (!desiredRangeAccounts.some((row) => row.account === account)) {
      throw new AppError('erpnext-sweep budget recovery HELD: range account is no longer desired by the current map', BUDGET_SWEEP_GATE_HELD);
    }
    return;
  }

  let desired: ReturnType<typeof resolveV16BudgetAccounts>;
  try {
    desired = resolveV16BudgetAccounts(
      plan.plan.find((entry) => entry.fiscal_year === frozenYear)?.line_items ?? [],
      plan.categoryMap,
    );
  } catch (err) {
    throw new AppError(`erpnext-sweep budget recovery HELD: current account resolution failed — ${err instanceof Error ? err.message : String(err)}`, BUDGET_SWEEP_GATE_HELD);
  }
  const remove = payload.budget_intent === 'remove';
  if (remove) {
    if (desired.some((row) => row.account === account) || !plan.inSpanFiscalYears.includes(frozenYear)) {
      throw new AppError('erpnext-sweep budget recovery HELD: removed account is desired again or year is outside the current project span', BUDGET_SWEEP_GATE_HELD);
    }
    const predecessor = typeof payload.budget_predecessor === 'string' ? payload.budget_predecessor : '';
    if (!predecessor) throw new AppError('erpnext-sweep budget recovery HELD: removal has no predecessor witness', BUDGET_SWEEP_GATE_HELD);
    const prior = await serviceClient.from('budget_version_account_erp_mirror')
      .select('budget_version_id,erp_budget_name,budget_versions!inner(project_id)')
      .eq('org_id', org.orgId).eq('budget_versions.project_id', plan.projectId)
      .eq('fiscal_year', frozenYear).eq('erp_account', account).eq('erp_budget_name', predecessor)
      .eq('budget_intent', 'ensure').is('erp_cancelled_at', null).maybeSingle();
    if (prior.error || !prior.data) throw new AppError('erpnext-sweep budget recovery HELD: predecessor has no same-org project/account witness', BUDGET_SWEEP_GATE_HELD);
    const priorVersionId = String((prior.data as { budget_version_id?: unknown }).budget_version_id ?? '');
    let reverseIdentity: string;
    try { reverseIdentity = budgetAccountIdentity(priorVersionId, frozenYear, account); }
    catch { throw new AppError('erpnext-sweep budget recovery HELD: predecessor identity is invalid', BUDGET_SWEEP_GATE_HELD); }
    const reverseRef = await serviceClient.from('external_refs').select('external_record_id')
      .eq('org_id', org.orgId).eq('domain', 'budget').eq('external_tier', ERPNEXT_TIER)
      .eq('pmo_record_id', reverseIdentity).eq('external_record_id', predecessor).maybeSingle();
    if (reverseRef.error || !reverseRef.data) throw new AppError('erpnext-sweep budget recovery HELD: predecessor has no reverse reference witness', BUDGET_SWEEP_GATE_HELD);
  } else if (!desired.some((row) => row.account === account)) {
    throw new AppError('erpnext-sweep budget recovery HELD: account is no longer desired by the current map', BUDGET_SWEEP_GATE_HELD);
  }
}

/** The client's OWN fiscal calendar, read live (the same doctype read the foreground gate makes). */
export async function readErpFiscalYearsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  cache?: ErpAuthPairCache,
): Promise<FiscalYearRow[]> {
  const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, org, cache);
  if (!(await isPermittedErpSiteUrl(org.siteUrl))) throw new AppError('ERPNext destination is not permitted', 'external-unreachable');
  const url = new URL('/api/resource/Fiscal Year', org.siteUrl);
  url.searchParams.set('fields', JSON.stringify(['name', 'year_start_date', 'year_end_date']));
  url.searchParams.set('limit_page_length', '0');
  // ⚑ Server-side hang guard (money path) — mirrors the foreground gate's fiscal read: bound this raw
  // fetch so a slow/down ERPNext can't block the sweep worker forever; a deadline (or network failure)
  // fails CLOSED as `external-unreachable` (same as a non-2xx).
  let res: Response;
  try {
    res = await fetchWithDeadline(
      orgErpFetch(org),
      url.toString(),
      // #655: never follow a redirect off the admin-nominated host; a 3xx fails the `!res.ok` check below.
      { headers: { Authorization: `token ${apiKey}:${apiSecret}`, Accept: 'application/json' }, redirect: 'manual' },
      ERP_PROBE_TIMEOUT_MS,
    );
  } catch {
    throw new AppError('could not read the ERPNext fiscal calendar (unreachable)', 'external-unreachable');
  }
  if (!res.ok) throw new AppError(`could not read the ERPNext fiscal calendar (HTTP ${res.status})`, 'external-unreachable');
  const body = await readJsonBounded<{ data?: unknown }>(res, 'could not read the ERPNext fiscal calendar (unreachable)');
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.filter(
    (r): r is FiscalYearRow =>
      typeof (r as FiscalYearRow)?.name === 'string' &&
      typeof (r as FiscalYearRow)?.year_start_date === 'string' &&
      typeof (r as FiscalYearRow)?.year_end_date === 'string',
  );
}
