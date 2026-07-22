/**
 * erpnext-sweep — Deno Edge Function entry point (task 8.6, AC-ENA-045/071, ADR-0055 §3 + ADR-0058 §Consequences).
 *
 * The reconciliation sweep — the convergence authority that catches webhook gaps (ADR-0055 §3:
 * webhooks for latency, sweep for truth) AND runs the outbox recovery pass (ADR-0058 §Consequences:
 * the SAME recovery algorithm as the retry flow, run as an explicit pass BEFORE the doctype sweep so
 * an orphaned commit / stuck committing / committed-but-unfinalized row is reconciled even if the
 * original retry never returned). Dedicated-sweep-secret-guarded (`verify_jwt = false`; the handler
 * verifies the bearer itself — it MUST equal ERPNEXT_SWEEP_SECRET, constant-time), mirroring
 * clickup-sweep's least-privilege pattern: the caller is the pg_cron job (migration 0101), not a
 * browser JWT, and the dedicated sweep secret can at worst trigger a tick — never grant DB access.
 * Registered-but-idle per the 0094 precedent: the cron helper no-ops until an operator creates the
 * Vault secrets, so the job fires as a no-op until then (no employing org ⇒ no-op).
 *
 * Per employing org, ONE cycle runs FOUR passes in order:
 *   (1) reconcileOrgOutbox — the ADR-0058 §4 outbox recovery pass (delegates to the REAL
 *       dispatchMoneyWrite per candidate — one algorithm, shared with the retry path);
 *   (2) the modified-poll doctype sweep (runSweep per doctype, the convergence authority — AC-ENA-071);
 *   (3) the ledger-mirror feed (feedLedgerMirrors, 8.6b — populates erp_gl_entry_mirror/
 *       erp_payment_ledger_mirror);
 *   (4) refreshActuals + refreshAging (slice 7 — read the freshly-fed mirror).
 * An org's failure is recorded WITHOUT blocking the others (sweep resilience: one client's bench
 * hiccup must not kill every org's refresh). Interactive priority over bulk (NFR-ENA-PERF-001).
 *
 * Thin wiring ONLY — the sweepCursor list+dedupe, applyFeed lineage, ledgerMirrorFeed, and
 * dispatchMoneyWrite reconcile are unit-proven elsewhere. `reconcileOrgOutbox` + `runErpSweepCycle`
 * are the testable core (outboxRecovery.test.ts); this Deno.serve wrapper is INTEGRATION-ONLY —
 * verified by `deno check` + the boot-smoke.
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { constantTimeBearerEquals } from '../_shared/constantTimeBearerEquals.ts';
import { runSweep } from '../../../pmo-portal/src/lib/adapterSeam/applyEngine.ts';
import { listErpChangesSinceWatermark } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/sweepCursor.ts';
import { applyErpFeedEvent } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/applyFeed.ts';
import { createErpFeedDeps, ERPNEXT_TIER } from '../_shared/erpnextFeedDeps.ts';
import { DOCTYPE_REGISTRY, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import { DOCTYPE_BODIES } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts';
// Luna BLOCK 6: each body module declares the list-endpoint fields ITS `fromDoc` reads, next to the
// mapper — the poll is built from those so the two cannot drift apart.
import { SI_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/salesInvoice.ts';
import { PE_RECEIVE_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/incomingPayment.ts';
import { PE_PAY_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/paymentEntry.ts';
import { PI_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/purchaseInvoice.ts';
import { PO_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/purchaseOrder.ts';
import { GR_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/goodsReceipt.ts';
import { MR_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/materialRequest.ts';
import { RFQ_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/rfq.ts';
import { SQ_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/supplierQuotation.ts';
import { SUPPLIER_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/supplier.ts';
import { CUSTOMER_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/customer.ts';
import { KIND_DOMAIN, KIND_MIRROR_TABLE } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { feedLedgerMirrors } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/ledgerMirrorFeed.ts';
import { refreshAccountingSnapshots, type OrgAccountingScope } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/accountingFanout.ts';
import { dispatchMoneyWrite, type DispatchMoneyWriteDeps, type ExternalRefMapping, type OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { resolveErpCredentials } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts';
import { erpnextRequest, withProbeBudget, type ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { resolveErpDispatchAdapter, withPaymentTypeDiscriminator } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import { resolvePerOrgSecret } from '../_shared/perOrgSecret.ts';
import { externalConnectEnabled } from '../_shared/externalConnectEnabled.ts';
import { canonicalCommandDigest, createDbMoneyOutboxDeps } from '../adapter-dispatch/moneyOutboxDeps.ts';
import { checkErpnextCommandAuthorization, checkOutboxReplayAuthorization } from '../adapter-dispatch/authGuard.ts';
import { getReadModelWriter } from '../adapter-dispatch/readModelWriters.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { probeErpByAnchorKey, probeErpByPaymentComposite, type ErpProbeDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.ts';
import { ERPNEXT_COMPANIES_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { admitsDocForBindingCompany, companyDocFilters, isCompanyScopedKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/companyScope.ts';
// BLOCK 1 / B5: the pull-adopt barrier now lives in `_shared/` so the WEBHOOK adopt path raises the
// IDENTICAL guard (round-9 FIX 1). Re-exported below so this module's existing test imports still resolve.
import { createInFlightAnchorProbe, type InFlightAnchorProbe } from '../_shared/inFlightAnchorProbe.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

export { createInFlightAnchorProbe, type InFlightAnchorProbe };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The list of doctypes the sweep polls, per domain. Built from DOCTYPE_REGISTRY (one source). */
const SWEEP_DOCTYPES: Array<{ kind: ErpDocKind; doctype: string }> = (Object.entries(DOCTYPE_REGISTRY) as Array<
  [ErpDocKind, { doctype: string }]
>).map(([kind, entry]) => ({ kind, doctype: entry.doctype }));

/**
 * The list-endpoint fields each kind's poll must request (Luna BLOCK 6). Sourced from the field list
 * each body module declares NEXT TO its `fromDoc`, so the poll always fetches exactly what the mapper
 * reads — the sweep previously fetched only the four lifecycle fields, so every sweep-adopted Sales
 * Invoice entered the PMO revenue rollup with `amount = NULL` and `outstanding = NULL`.
 */
const FROM_DOC_FIELDS_BY_KIND: Record<ErpDocKind, readonly string[]> = {
  'purchase-request': MR_FROM_DOC_FIELDS,
  rfq: RFQ_FROM_DOC_FIELDS,
  quotation: SQ_FROM_DOC_FIELDS,
  'purchase-order': PO_FROM_DOC_FIELDS,
  'goods-receipt': GR_FROM_DOC_FIELDS,
  'purchase-invoice': PI_FROM_DOC_FIELDS,
  payment: PE_PAY_FROM_DOC_FIELDS,
  supplier: SUPPLIER_FROM_DOC_FIELDS,
  customer: CUSTOMER_FROM_DOC_FIELDS,
  'sales-invoice': SI_FROM_DOC_FIELDS,
  'incoming-payment': PE_RECEIVE_FROM_DOC_FIELDS,
};

/** The fields the poll requests for one kind: the mapper's own fields plus the `payment_type`
 *  discriminator where the kind shares a doctype (BLOCK A1). Exported for direct unit testing. */
export function sweepFieldsForKind(kind: ErpDocKind): string[] {
  const fields = new Set<string>(FROM_DOC_FIELDS_BY_KIND[kind] ?? []);
  for (const routing of ['name', 'modified', 'docstatus', 'amended_from']) fields.add(routing);
  if (PAYMENT_TYPE_BY_KIND[kind]) fields.add('payment_type');
  // BLOCK 1: the recovery ANCHOR field (ADR-0058 §3 — 'remarks' for SI/PI/PR, 'reference_no' for the
  // Payment Entry kinds). Without it the poll cannot tell a PMO-originated, still-unresolved document
  // from a native one, and pull-adopts a SECOND PMO row for a doc the outbox is about to finalize.
  const anchorField = DOCTYPE_REGISTRY[kind].anchorField;
  if (anchorField) fields.add(anchorField);
  // WIRE 3 / B4: the `company` dimension, for the kinds whose doctype HAS one. The per-document
  // admission gate reads it off each returned row, and it fails CLOSED on a document that states no
  // company — so a poll that did not request the field would admit nothing at all. Never requested for
  // a global master (Supplier/Customer): Frappe rejects a list query naming a non-existent field.
  if (isCompanyScopedKind(kind)) fields.add('company');
  return Array.from(fields);
}

/**
 * The `filterRow` predicate for one kind: skips any document the in-flight probe claims.
 *
 * Returns `undefined` only when there is nothing to apply (an anchor-less kind with no base filter), so
 * the poll keeps its exact pre-existing shape. The caller's own `filterRow` (the BLOCK A1 `payment_type`
 * discriminator) is preserved and evaluated FIRST — a row it already rejects costs no outbox read.
 */
export function inFlightAnchorFilter(
  kind: ErpDocKind,
  probe: InFlightAnchorProbe,
  baseFilter?: (row: Record<string, unknown>) => boolean,
): ((row: Record<string, unknown>) => Promise<boolean>) | undefined {
  const anchorField = DOCTYPE_REGISTRY[kind].anchorField;
  if (!anchorField) return baseFilter ? async (row) => baseFilter(row) : undefined;
  return async (row: Record<string, unknown>): Promise<boolean> => {
    if (baseFilter && !baseFilter(row)) return false;
    const anchor = row[anchorField];
    if (typeof anchor !== 'string' || anchor === '') return true;
    return !(await probe(anchor));
  };
}

/**
 * Kinds whose canonical depends on a CHILD TABLE, which Frappe's list endpoint does not return
 * (Luna BLOCK 6). A Receive Payment Entry's `references` — the rows citing the Sales Invoice it pays —
 * is the money LINK behind `incoming_payments.sales_invoice_id`; without it every sweep-adopted receipt
 * is permanently unlinked from its invoice. These kinds therefore re-read each changed doc in full.
 * Deliberately minimal (no needless N+1): only the kinds whose child data drives a money column.
 */
export const KINDS_NEEDING_FULL_DOC: ErpDocKind[] = ['incoming-payment'];

/**
 * The doctypes ONE org's sweep may poll (Luna BLOCK 9). A valid, activated ERPNext binding says the org
 * talks to ERPNext; it does NOT say which PMO domains it handed over. Polling every doctype regardless
 * pushed native Sales Invoice / Receive PE mirrors into a procurement-only org's revenue read model.
 * Fail-CLOSED: an org with no recorded ownership polls nothing. Exported for direct unit testing.
 */
export function sweepKindsForOrg(ownedDomains: readonly string[]): Array<{ kind: ErpDocKind; doctype: string }> {
  const owned = new Set(ownedDomains);
  return SWEEP_DOCTYPES.filter(({ kind }) => owned.has(KIND_DOMAIN[kind]));
}

/** Luna BLOCK A1 (cross-domain corruption guard): `payment` (Pay/supplier) and `incoming-payment`
 *  (Receive/customer) share the ONE `Payment Entry` doctype (`doctypeRegistry.ts`) — polling it without
 *  a `payment_type` discriminator lets a Pay doc be adopted into `incoming_payments` (or vice-versa).
 *  Every OTHER kind polls its own dedicated doctype, so this map is empty for them (no filter needed).
 *  Exported for direct unit testing (mirrors the `reportVersionFromOrg` FIX-6 pattern). */
export const PAYMENT_TYPE_BY_KIND: Partial<Record<ErpDocKind, 'Pay' | 'Receive'>> = {
  payment: 'Pay',
  'incoming-payment': 'Receive',
};

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
  const { probeDeps, kind, anchorField, anchorMutable, payload } = args;
  // BLOCK 4: the discriminated deps are what EVERY anchor-probe path in here uses.
  const anchorProbeDeps = withPaymentTypeDiscriminator(probeDeps, kind);
  if (!anchorField) return async () => null;
  if (!anchorMutable) return (_domain, idempotencyKey) => probeErpByAnchorKey(anchorProbeDeps, idempotencyKey);
  return async (_domain, idempotencyKey) => {
    // The direction comes from the KIND (what PMO commanded), falling back to the persisted payload
    // only for a kind that is not one of the two Payment Entry kinds — never a bare 'Pay' default,
    // which would probe the wrong direction for a Receive row whose payload omitted `payment_type`.
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
    });
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// (1) The outbox recovery pass — ADR-0058 §Consequences. Delegates to the REAL dispatchMoneyWrite per
//     candidate so the sweep path and the retry path share ONE reconciliation algorithm.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Lists outbox reconcile candidates for an org via the SECURITY DEFINER RPC (mig 0095). The
 *  candidate rows are the `OutboxRow` camelCase shape `dispatchMoneyWrite` consumes. */
export type ListOutboxCandidates = (orgId: string) => Promise<OutboxRow[]>;

/** Builds the DispatchMoneyWriteDeps for one candidate row (the sweep wires the real outbox deps +
 *  adapter + read-model writers per org; the test injects mocks). Async-capable so the live wiring can
 *  resolve the adapter/binding; a sync mock (`() => deps`) still satisfies it (await on a value is a value). */
export type BuildReconcileDeps = (row: OutboxRow) => DispatchMoneyWriteDeps | Promise<DispatchMoneyWriteDeps>;

export interface ReconcileOrgOutboxResult {
  /** Candidates the pass drove through dispatchMoneyWrite this run. */
  reconciled: number;
  /** Per-candidate outcomes (`ok` on a terminal reconcile; `error` when dispatchMoneyWrite threw — the
   *  sweep logs + continues so one bad row does not abort the pass). */
  errors: Array<{ id: string; error: string }>;
}

/**
 * The outbox recovery pass for ONE org (AC-ENA-045, ADR-0058 §Consequences). Lists the candidates
 * (pending/failed/committing-past-lease/committed) via `outbox_reconcile_candidates(org)` and drives
 * each through the REAL `dispatchMoneyWrite` — one algorithm, shared with the retry path. A candidate
 * whose reconcile throws is recorded + skipped (sweep resilience); the next schedule retries it.
 *
 * Luna re-audit (ownership): the pass is DOMAIN-GATED, like `sweepOrgDoctypesLive` (sweepKindsForOrg)
 * and `repairOrgLinksLive`. It previously gated on nothing, so revoking a domain — the Operator's
 * kill-switch — refused NEW dispatches and stopped inbound adoption while queued/committing/committed
 * rows of that domain kept reconciling on the next tick and POSTED REAL money documents into an org
 * that no longer owns the domain. Fail-CLOSED: an org with no recorded ownership reconciles nothing.
 *
 * The skip is NOT silent (never drop a money row): `mark_outbox_held` cannot express it — 0096
 * transitions only `state='committing'`, while candidates are pending/failed/committing-past-lease/
 * committed — so the row is left EXACTLY as it is (no state change, no ERP call) and reported as a
 * per-candidate error, which `runErpSweepCycle` surfaces as `reconcile:<id>:<error>`. Re-granting the
 * domain resumes it on the next tick.
 */
export async function reconcileOrgOutbox(
  listCandidates: ListOutboxCandidates,
  org: { orgId: string; ownedDomains: readonly string[] },
  buildDeps: BuildReconcileDeps,
  dispatch: typeof dispatchMoneyWrite = dispatchMoneyWrite,
): Promise<ReconcileOrgOutboxResult> {
  const candidates = await listCandidates(org.orgId);
  const owned = new Set(org.ownedDomains);
  let reconciled = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for (const candidate of candidates) {
    // The gate runs BEFORE buildDeps so a revoked domain never even resolves ERP credentials/adapter.
    // `candidate.domain` is the outbox row's own PMO domain, which the dispatch's authGuard already
    // proved equal to `KIND_DOMAIN[payload.erp_doc_kind]` at insert time — one value, checked here
    // without a second read of the payload.
    if (!owned.has(candidate.domain)) {
      errors.push({ id: candidate.id, error: `domain-not-owned: '${candidate.domain}' is no longer assigned to this tier — held for an operator, NOT reconciled` });
      continue;
    }
    try {
      await dispatch(await buildDeps(candidate));
      reconciled += 1;
    } catch (err) {
      // A retryable reconcile (e.g. a quarantined row still in its window → "reconciling") is expected
      // mid-recovery; record + continue so one candidate does not abort the pass.
      errors.push({ id: candidate.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { reconciled, errors };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// (2)+(3)+(4) The per-org sweep cycle: doctype modified-poll → ledger feed → accounting refresh.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** A loaded per-org ERPNext binding (the external_org_bindings row, PMO-shaped). */
interface OrgBinding {
  orgId: string;
  siteUrl: string;
  secretRef: string;
  company: string;
  config: Record<string, unknown>;
  /** Luna BLOCK 9: the PMO domains this org actually assigned to the ERPNext tier
   *  (`external_domain_ownership`) — the sweep polls only these. */
  ownedDomains: string[];
  // task FIX-6 (Quality MINOR 4): the handshake-stamped ERPNext major version lives on the
  // `external_org_bindings.version_major` COLUMN (§4.1), never inside `config` (which has no
  // `version` key — `report_filter_shape`/`aging_report_names`/the account defaults live there).
  versionMajor: number | null;
}

export interface ErpSweepCycleDeps {
  listEmployingOrgs: () => Promise<OrgBinding[]>;
  reconcileOrgOutbox: (org: OrgBinding) => Promise<ReconcileOrgOutboxResult>;
  sweepOrgDoctypes: (org: OrgBinding) => Promise<{ applied: number; error?: string }>;
  /** Luna BLOCK 6: the late-link self-heal (receipts adopted before their invoice). Optional so the
   *  existing cycle tests stay byte-for-byte; the live wiring always supplies it. */
  repairOrgLinks?: (org: OrgBinding) => Promise<{ repaired: number; error?: string }>;
  feedOrgLedgers: (org: OrgBinding) => Promise<{ gl: number; ple: number; error?: string }>;
  refreshOrgAccounting: (org: OrgBinding) => Promise<{ error?: string }>;
}

export interface ErpSweepCycleResult {
  orgs: number;
  perOrg: Array<{ orgId: string; reconcile: ReconcileOrgOutboxResult | null; sweep?: { applied: number }; ledger?: { gl: number; ple: number }; errors: string[] }>;
}

/**
 * Run ONE sweep cycle across every employing org. Per org, in order: (1) outbox recovery, (2) doctype
 * modified-poll sweep, (3) ledger-mirror feed, (4) accounting refresh. An org's failure is recorded
 * WITHOUT aborting the loop (sweep resilience). The reconcile pass runs FIRST so the doctype sweep
 * sees a consistent outbox (ADR-0058 §Consequences).
 */
export async function runErpSweepCycle(deps: ErpSweepCycleDeps): Promise<ErpSweepCycleResult> {
  const orgs = await deps.listEmployingOrgs();
  const perOrg: ErpSweepCycleResult['perOrg'] = [];
  for (const org of orgs) {
    const errors: string[] = [];
    // (1) outbox recovery FIRST.
    let reconcile: ReconcileOrgOutboxResult | null = null;
    try {
      reconcile = await deps.reconcileOrgOutbox(org);
      for (const e of reconcile.errors) errors.push(`reconcile:${e.id}:${e.error}`);
    } catch (err) {
      errors.push(`reconcile:${err instanceof Error ? err.message : String(err)}`);
    }
    // (2) doctype modified-poll sweep.
    let sweep: { applied: number } | undefined;
    try {
      const r = await deps.sweepOrgDoctypes(org);
      sweep = { applied: r.applied };
      if (r.error) errors.push(`sweep:${r.error}`);
    } catch (err) {
      errors.push(`sweep:${err instanceof Error ? err.message : String(err)}`);
    }
    // (2b) late-link self-heal — AFTER the doctype sweep, so an invoice adopted THIS tick is already
    //      mapped when the receipts that cite it are re-checked (Luna BLOCK 6).
    if (deps.repairOrgLinks) {
      try {
        const r = await deps.repairOrgLinks(org);
        if (r.error) errors.push(`repair:${r.error}`);
      } catch (err) {
        errors.push(`repair:${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // (3) ledger-mirror feed.
    let ledger: { gl: number; ple: number } | undefined;
    try {
      const r = await deps.feedOrgLedgers(org);
      ledger = { gl: r.gl, ple: r.ple };
      if (r.error) errors.push(`ledger:${r.error}`);
    } catch (err) {
      errors.push(`ledger:${err instanceof Error ? err.message : String(err)}`);
    }
    // (4) accounting refresh (reads the freshly-fed mirror).
    try {
      const r = await deps.refreshOrgAccounting(org);
      if (r.error) errors.push(`accounting:${r.error}`);
    } catch (err) {
      errors.push(`accounting:${err instanceof Error ? err.message : String(err)}`);
    }
    perOrg.push({ orgId: org.orgId, reconcile, sweep, ledger, errors });
  }
  return { orgs: orgs.length, perOrg };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// The real wiring the Deno.serve wrapper uses (DB + env + createErpFeedDeps + the slice-7 fanout).
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Loads the employing orgs (activated erpnext bindings) + resolves each org's ERP client deps.
 *  Exported for unit testing (task FIX-5, Quality IMPORTANT 2 — the DB-error path must be observable,
 *  not silently swallowed). */
export async function listEmployingOrgsLive(serviceClient: SupabaseClient): Promise<OrgBinding[]> {
  const { data, error } = await serviceClient.from('external_org_bindings')
    .select('org_id, site_url, secret_ref, config, activated_at, version_major')
    .eq('external_tier', ERPNEXT_TIER);
  // task FIX-5: a real DB error must not be silently folded into "no employing orgs this cycle" — log
  // it so an outage is observable in the function logs. The sweep cycle still returns [] (fail-safe:
  // one bad DB round-trip skips this sweep tick rather than crashing the whole cron invocation).
  if (error) {
    console.error(`[erpnext-sweep] external_org_bindings load failed: code=${error.code ?? 'none'} message=${error.message}`);
    return [];
  }
  const rows = (data as Array<{ org_id: string; site_url: string; secret_ref: string; config: Record<string, unknown> | null; activated_at: string | null; version_major: number | null }> | null) ?? [];
  const activated = rows.filter((r) => r.activated_at);
  if (activated.length === 0) return [];

  // Luna BLOCK 9: an activated binding says the org talks to ERPNext, NOT which PMO domains it handed
  // over. Load the real per-domain ownership so the sweep polls only what the org opted into. A load
  // error fail-safes this tick to [] (logged, like the binding read above) rather than sweeping blind.
  const { data: owned, error: ownedError } = await serviceClient.from('external_domain_ownership')
    .select('org_id, domain')
    .eq('external_tier', ERPNEXT_TIER)
    .in('org_id', activated.map((r) => r.org_id));
  if (ownedError) {
    console.error(`[erpnext-sweep] external_domain_ownership load failed: code=${ownedError.code ?? 'none'} message=${ownedError.message}`);
    return [];
  }
  const ownedByOrg = new Map<string, string[]>();
  for (const row of (owned as Array<{ org_id: string; domain: string }> | null) ?? []) {
    ownedByOrg.set(row.org_id, [...(ownedByOrg.get(row.org_id) ?? []), row.domain]);
  }

  return activated.map((r) => ({
    orgId: r.org_id,
    siteUrl: r.site_url,
    secretRef: r.secret_ref,
    company: (r.config?.company as string | undefined) ?? '',
    config: r.config ?? {},
    // task FIX-6 (Quality MINOR 4): version_major is a top-level column, not a `config` key.
    versionMajor: r.version_major ?? null,
    ownedDomains: ownedByOrg.get(r.org_id) ?? [],
  }));
}

/** Re-read ONE ERP doc in full (Luna BLOCK 6) — the list endpoint omits child tables, and a Receive
 *  Payment Entry's `references` child rows carry the Sales Invoice link the money read-model needs. */
async function fetchErpDoc(client: ErpClientDeps, doctype: string, name: string): Promise<Record<string, unknown>> {
  const body = await erpnextRequest(client, {
    method: 'GET',
    path: `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
  });
  return ((body as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>;
}

// Merged: dev's admin-connect made credential resolution Vault-first (behind EXTERNAL_CONNECT_ENABLED,
// falling back to the env resolver when off / no binding / vault-miss). Kept alongside the P3a money
// path — the async signature propagates to every call site (all now `await erpClientForOrg(serviceClient, org)`).
async function erpClientForOrg(serviceClient: SupabaseClient, org: OrgBinding): Promise<ErpClientDeps> {
  const connectEnabled = externalConnectEnabled();
  if (!connectEnabled) {
    throw new AppError('external integrations are disabled by the operator', 'config-rejected');
  }
  let apiKey: string;
  let apiSecret: string;

  if (connectEnabled) {
    // Use shared per-org Vault secret resolution (flag gate + binding lookup + tri-state)
    const result = await resolvePerOrgSecret({
      connectEnabled,
      orgId: org.orgId,
      tier: 'erpnext',
      lookupBinding: async (orgId, tier) => {
        const { data, error } = await serviceClient
          .from('external_org_bindings')
          .select('secret_ref')
          .eq('org_id', orgId)
          .eq('external_tier', tier)
          .maybeSingle();
        if (error) return null;
        return data as { secret_ref?: string | null } | null;
      },
      readVaultSecret: async (ref) => {
        const { data, error } = await serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
        if (error) {
          console.error('read_vault_secret failed', error);
          return null;
        }
        return (data as string | null) ?? null;
      },
    });

    if (result.kind === 'resolved') {
      // Vault stores apiKey:apiSecret format
      const idx = result.secret.indexOf(':');
      if (idx > 0 && idx < result.secret.length - 1) {
        apiKey = result.secret.slice(0, idx);
        apiSecret = result.secret.slice(idx + 1);
      } else {
        throw new AppError('ERPNext credential format invalid (expected apiKey:apiSecret)', 'config-rejected');
      }
    } else {
      // kind === 'no-binding' OR 'binding-vault-miss' → fall back to env resolver
      const creds = resolveErpCredentials(org.secretRef, (key) => Deno.env.get(key));
      apiKey = creds.apiKey;
      apiSecret = creds.apiSecret;
    }
  } else {
    const creds = resolveErpCredentials(org.secretRef, (key) => Deno.env.get(key));
    apiKey = creds.apiKey;
    apiSecret = creds.apiSecret;
  }

  return { fetchImpl: fetch, apiKey, apiSecret, baseUrl: org.siteUrl };
}

/** The outbox-recovery listCandidates RPC wrapper (camelCase → OutboxRow). */
function listCandidatesLive(serviceClient: SupabaseClient): ListOutboxCandidates {
  return async (orgId: string) => {
    const { data, error } = await serviceClient.rpc('outbox_reconcile_candidates', { p_org_id: orgId });
    if (error) throw new AppError(error.message, error.code);
    const rows = (data as Array<Record<string, unknown>> | null) ?? [];
    return rows.map((r) => ({
      id: String(r.id),
      domain: String(r.domain),
      pmoRecordId: String(r.pmo_record_id),
      idempotencyKey: String(r.idempotency_key),
      state: r.state as OutboxRow['state'],
      externalRecordId: (r.external_record_id as string | null) ?? null,
      canonical: (r.canonical as OutboxRow['canonical']) ?? null,
      claimGeneration: (r.claim_generation as number | undefined) ?? 0,
      payloadDigest: (r.payload_digest as string | null | undefined) ?? null,
    }));
  };
}

/** The per-org sweep: runSweep per doctype with the lineage-aware apply injected, per-doctype watermark. */
export async function sweepOrgDoctypesLive(serviceClient: SupabaseClient, org: OrgBinding): Promise<{ applied: number; error?: string }> {
  const client = await erpClientForOrg(serviceClient, org);
  let applied = 0;
  // BLOCK 1 / round-7 B5: the pull-adopt guard. NOT a snapshot — the probe asks the outbox about each
  // CANDIDATE document at the moment the poll sees it, so neither a stale key set nor PostgREST's
  // `max_rows` ceiling can let a PMO-originated document be pull-adopted into a SECOND PMO row. A read
  // failure throws out of the poll below (fail closed): polling with a blind guard is exactly the state
  // that duplicated money rows. One probe per org tick shares the memo across that org's doctypes.
  const inFlightProbe = createInFlightAnchorProbe(serviceClient, org.orgId);
  // Luna BLOCK 9: only the doctypes whose PMO domain this org actually assigned to the ERPNext tier.
  for (const { kind, doctype } of sweepKindsForOrg(org.ownedDomains)) {
    const domain = KIND_DOMAIN[kind];
    const bodyFns = DOCTYPE_BODIES[kind];
    if (!bodyFns) continue; // not yet wired — skip (inert until the slice that wires it lands)
    // WIRE 3 / round-7 B4 (CROSS-TENANT): scope the poll to the ERP Company this binding represents.
    // An ERPNext site hosts many Companies; without this the poll adopted ANOTHER tenant's Sales
    // Invoices / Receive PEs into this org's revenue and AR views, with no error anywhere.
    // `null` means UNSCOPEABLE (a company-scoped kind on a binding that names no company) — skip the
    // kind entirely and log it as the configuration error it is. It is deliberately NOT `[]` ("no
    // company dimension, sweep freely"), which is what would sweep the whole ERP site into one tenant.
    const companyFilters = companyDocFilters(kind, org.company || null);
    if (companyFilters === null) {
      console.error(
        `[erpnext-sweep] org ${org.orgId}: binding names no ERP company — the company-scoped '${kind}' poll is `
          + 'SKIPPED (an unscopeable poll would adopt every company on the site). Set config.company on the binding.',
      );
      continue;
    }
    const feedDeps = createErpFeedDeps(serviceClient as unknown as SupabaseClient, org.orgId, kind);
    // Per-doctype watermark (FR-ENA-080: org × doctype) — keyed on a namespaced domain value so each
    // doctype has its own cursor row on external_sync_watermarks (the applyEngine ctx.domain stays the
    // PMO domain for external_refs; the watermark key is the sweep's own concern).
    const wmDomain = `${domain}::${doctype}`;
    const watermarkDeps = {
      readWatermark: async () => {
        const { data } = await serviceClient.from('external_sync_watermarks').select('watermark_cursor')
          .eq('org_id', org.orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', wmDomain).maybeSingle();
        return (data as { watermark_cursor?: string | null } | null)?.watermark_cursor ?? null;
      },
      advanceWatermark: async (cursor: string) => {
        const { error } = await serviceClient.from('external_sync_watermarks').upsert(
          { org_id: org.orgId, external_tier: ERPNEXT_TIER, domain: wmDomain, watermark_cursor: cursor },
          { onConflict: 'org_id,external_tier,domain' },
        );
        if (error) throw new AppError(error.message, error.code);
      },
    };
    // Luna BLOCK A1: `payment`/`incoming-payment` share the `Payment Entry` doctype — fetch
    // `payment_type` and filter the poll (server-side + defense-in-depth post-fetch) so a Pay doc is
    // NEVER adopted by the incoming-payment poll and vice-versa.
    const paymentType = PAYMENT_TYPE_BY_KIND[kind];
    // Luna BLOCK 6: fetch exactly the fields THIS kind's mapper consumes (money included), plus — where
    // the canonical depends on a child table the list endpoint cannot return (the Receive PE's
    // `references`) — re-read each changed doc in full.
    const fields = sweepFieldsForKind(kind);
    const hydrateDoc = KINDS_NEEDING_FULL_DOC.includes(kind)
      ? (name: string) => fetchErpDoc(client, doctype, name)
      : undefined;
    try {
      const result = await runSweep(
        { tier: ERPNEXT_TIER, domain },
        {
          ...feedDeps,
          ...watermarkDeps,
          applyChange: (ctx, externalRecordId, canonical, sourceModMs, d) =>
            applyErpFeedEvent(ctx, externalRecordId, canonical, sourceModMs, d as Parameters<typeof applyErpFeedEvent>[4]),
          listChanges: (cursor) => listErpChangesSinceWatermark(
            {
              client,
              doctype,
              fields,
              fromDoc: bodyFns.fromDoc,
              ...(hydrateDoc ? { hydrateDoc } : {}),
              // WIRE 3: the company conjunct rides alongside BLOCK A1's payment_type discriminator.
              extraFilters: [
                ...(paymentType ? ([['payment_type', '=', paymentType]] as [string, string, string][]) : []),
                ...companyFilters,
              ],
              // BLOCK A1's post-fetch discriminator AND WIRE 3's per-document company gate — the
              // server-side filters above are an optimization, these are the authority — composed under
              // BLOCK 1's in-flight-adopt guard (`inFlightAnchorFilter` returns the base filter
              // unchanged when it has nothing of its own to add).
              ...(() => {
                const filterRow = inFlightAnchorFilter(
                  kind,
                  inFlightProbe,
                  (row: Record<string, unknown>) =>
                    (paymentType ? row.payment_type === paymentType : true)
                    && admitsDocForBindingCompany(kind, row, org.company || null),
                );
                return filterRow ? { filterRow } : {};
              })(),
            },
            cursor,
          ),
        },
      );
      applied += result.applied;
    } catch (err) {
      // An unreachable adapter (or one doctype's failure) is recorded but does NOT abort the other
      // doctypes/orgs (AC-CUA-044 sibling: the next schedule retries).
      return { applied, error: `${doctype}:${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return { applied };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// The late-link self-heal (Luna BLOCK 6). A Receive Payment Entry adopted BEFORE the Sales Invoice it
// cites resolves `sales_invoice_id` to NULL — and its own ERP row does not change when that invoice is
// later adopted, so the modified-poll never re-surfaces it and the payment stays attached to no
// invoice forever. This pass re-checks the org's unlinked ERP-sourced receipts each tick.
// ────────────────────────────────────────────────────────────────────────────────────────────────

export interface RepairUnlinkedReceiptsDeps {
  /** The org's ERP-sourced receipts still missing their invoice link (bounded per tick). */
  listUnlinkedReceipts: () => Promise<Array<{ id: string; erpName: string }>>;
  /** Re-read one Payment Entry in full (its `references` child rows are not list-endpoint fields). */
  fetchDoc: (erpName: string) => Promise<Record<string, unknown>>;
  /** The PMO id the cited Sales Invoice ERP name now maps to, or `null` if still unmapped. */
  resolveSalesInvoicePmoId: (siErpName: string) => Promise<string | null>;
  /** Write the repaired link. */
  link: (ipId: string, salesInvoicePmoId: string) => Promise<void>;
}

/**
 * Link every unlinked receipt whose cited invoice has since been adopted. A receipt with no
 * `references` is a genuine on-account payment and is left alone; a receipt whose invoice is still
 * unmapped is left alone too (a guessed link is a WRONG money attribution — it retries next tick). One
 * unreadable doc is recorded and skipped, never aborting the pass. Exported for direct unit testing.
 */
export async function repairUnlinkedReceipts(
  deps: RepairUnlinkedReceiptsDeps,
): Promise<{ repaired: number; errors: Array<{ id: string; error: string }> }> {
  const unlinked = await deps.listUnlinkedReceipts();
  let repaired = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for (const receipt of unlinked) {
    try {
      const doc = await deps.fetchDoc(receipt.erpName);
      const references = doc.references as Array<{ reference_name?: string | null }> | undefined;
      const siErpName = Array.isArray(references) ? references[0]?.reference_name : null;
      if (!siErpName) continue; // an unreferenced receipt is a valid on-account payment
      const salesInvoicePmoId = await deps.resolveSalesInvoicePmoId(siErpName);
      if (!salesInvoicePmoId) continue; // still unmapped — retry next tick rather than guess
      await deps.link(receipt.id, salesInvoicePmoId);
      repaired += 1;
    } catch (err) {
      errors.push({ id: receipt.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { repaired, errors };
}

/** The per-tick scan bound for the late-link repair: an org with many genuine on-account receipts must
 *  not turn the pass into an unbounded per-tick ERP read (NFR-ENA-PERF-001, interactive over bulk). */
const UNLINKED_RECEIPT_SCAN_LIMIT = 100;

/** The live wiring of the late-link self-heal for one org. Runs ONLY for an org that owns the revenue
 *  domain (Luna BLOCK 9) — a procurement-only org has no receipts to repair. */
async function repairOrgLinksLive(serviceClient: SupabaseClient, org: OrgBinding): Promise<{ repaired: number; error?: string }> {
  if (!org.ownedDomains.includes('revenue')) return { repaired: 0 };
  try {
    const client = await erpClientForOrg(serviceClient, org);
    const result = await repairUnlinkedReceipts({
      listUnlinkedReceipts: async () => {
        const { data, error } = await serviceClient.from('incoming_payments')
          .select('id').eq('org_id', org.orgId).is('sales_invoice_id', null).not('erp_docstatus', 'is', null)
          .limit(UNLINKED_RECEIPT_SCAN_LIMIT);
        if (error) throw new AppError(error.message, error.code);
        const rows = (data as Array<{ id: string }> | null) ?? [];
        if (rows.length === 0) return [];
        // The ERP name lives on external_refs (the mirror row carries no ERP name column).
        const { data: refs, error: refErr } = await serviceClient.from('external_refs')
          .select('pmo_record_id, external_record_id').eq('org_id', org.orgId).eq('domain', 'revenue')
          .in('pmo_record_id', rows.map((r) => r.id));
        if (refErr) throw new AppError(refErr.message, refErr.code);
        return ((refs as Array<{ pmo_record_id: string; external_record_id: string }> | null) ?? [])
          .map((r) => ({ id: r.pmo_record_id, erpName: r.external_record_id }));
      },
      fetchDoc: (erpName) => fetchErpDoc(client, DOCTYPE_REGISTRY['incoming-payment'].doctype, erpName),
      resolveSalesInvoicePmoId: async (siErpName) => {
        const { data, error } = await serviceClient.from('external_refs').select('pmo_record_id')
          .eq('org_id', org.orgId).eq('domain', 'revenue').eq('external_record_id', siErpName).maybeSingle();
        if (error) throw new AppError(error.message, error.code);
        return (data as { pmo_record_id?: string } | null)?.pmo_record_id ?? null;
      },
      link: async (ipId, salesInvoicePmoId) => {
        const { error } = await (serviceClient.from('incoming_payments').update({ sales_invoice_id: salesInvoicePmoId })
          .eq('org_id', org.orgId).eq('id', ipId) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
        if (error) throw new AppError(error.message, error.code);
      },
    });
    const first = result.errors[0];
    return { repaired: result.repaired, ...(first ? { error: `${first.id}:${first.error}` } : {}) };
  } catch (err) {
    return { repaired: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The ledger-mirror feed for one org (8.6b). */
async function feedOrgLedgersLive(serviceClient: SupabaseClient, org: OrgBinding): Promise<{ gl: number; ple: number; error?: string }> {
  try {
    const client = await erpClientForOrg(serviceClient, org);
    const r = await feedLedgerMirrors(serviceClient as unknown as Parameters<typeof feedLedgerMirrors>[0], {
      client, orgId: org.orgId, company: org.company,
    });
    return { gl: r.glFed, ple: r.pleFed };
  } catch (err) {
    return { gl: 0, ple: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The aging-snapshot provenance version string for an org (task FIX-6, Quality MINOR 4). Sourced
 * from `org.versionMajor` (the `external_org_bindings.version_major` COLUMN, handshake-stamped) —
 * `org.config.version` was never a real key (§4.1's `config` shape has no `version`: it carries
 * `report_filter_shape`/`aging_report_names`/the account defaults), so every aging snapshot's
 * `report_version` provenance was silently the empty string. Exported for direct unit testing.
 */
export function reportVersionFromOrg(org: Pick<OrgBinding, 'versionMajor'>): string {
  return org.versionMajor != null ? String(org.versionMajor) : '';
}

/** The accounting refresh for one org (slice 7 fanout — actuals + AP/AR aging from the mirror).
 *  Exported for unit testing (task FIX-6, Quality MINOR 4). */
export async function refreshOrgAccountingLive(serviceClient: SupabaseClient, org: OrgBinding): Promise<{ error?: string }> {
  try {
    const client = await erpClientForOrg(serviceClient, org);
    const reportVersion = reportVersionFromOrg(org);
    const scope: OrgAccountingScope = {
      orgId: org.orgId,
      client,
      actualsScope: {},
      apAgingScope: { reportName: 'Accounts Payable', snapshotTable: 'erp_ap_aging_snapshot', filters: org.config.report_filter_shape as Record<string, unknown> ?? {}, reportVersion },
      arAgingScope: { reportName: 'Accounts Receivable', snapshotTable: 'erp_ar_aging_snapshot', filters: org.config.report_filter_shape as Record<string, unknown> ?? {}, reportVersion },
    };
    const results = await refreshAccountingSnapshots(serviceClient as unknown as Parameters<typeof refreshAccountingSnapshots>[0], [scope]);
    const err = results.find((r) => r.error)?.error;
    return err ? { error: err } : {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ── 1. Authorization: the caller (the pg_cron job) must present the DEDICATED sweep secret (NOT the
  //    master service_role key — least-privilege, mirroring clickup-sweep). The cron presents this same
  //    secret from the Vault `erpnext_sweep_secret`; the master key never crosses into the DB. ──
  const sweepSecret = Deno.env.get('ERPNEXT_SWEEP_SECRET') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!sweepSecret || !(await constantTimeBearerEquals(authHeader, `Bearer ${sweepSecret}`))) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }, 500);
  const serviceClient = createClient(supabaseUrl, serviceRoleKey) as unknown as SupabaseClient;

  const listCandidates = listCandidatesLive(serviceClient);
  const cycle = await runErpSweepCycle({
    listEmployingOrgs: () => listEmployingOrgsLive(serviceClient),
    reconcileOrgOutbox: (org) => reconcileOrgOutbox(listCandidates, org, (row) => buildReconcileDepsLive(serviceClient, org, row)),
    sweepOrgDoctypes: (org) => sweepOrgDoctypesLive(serviceClient, org),
    repairOrgLinks: (org) => repairOrgLinksLive(serviceClient, org),
    feedOrgLedgers: (org) => feedOrgLedgersLive(serviceClient, org),
    refreshOrgAccounting: (org) => refreshOrgAccountingLive(serviceClient, org),
  });
  return json({ ok: true, ...cycle });
});

/**
 * The full per-candidate `DispatchMoneyWriteDeps` wiring (SPEC-REVIEW RULING — the `not-implemented`
 * sentinel is retired: the C-1 'held' state makes sweep-side reconciliation the operational PE-recovery
 * path). Reassembles the SAME building blocks adapter-dispatch uses per request — `createDbMoneyOutboxDeps`
 * (the fenced outbox ops + the composite/anchor probe + the reissue policy), `resolveErpDispatchAdapter`
 * (the per-org ERP adapter), and the read-model writers — reconstructing the command from the outbox row
 * + its persisted `payload.erp_doc_kind`. Inert in practice until an org is flipped AND a money command
 * leaves a candidate (no employing org ⇒ no candidate ⇒ this never fires — "inert-by-empty-map").
 */
export async function buildReconcileDepsLive(serviceClient: SupabaseClient, org: OrgBinding, row: OutboxRow): Promise<DispatchMoneyWriteDeps> {
  // Re-read the persisted operation + payload (the OutboxRow projection drops them) to reconstruct the command.
  // `actor_user_id` (0108): the ORIGINAL command's verified caller. Without it a sweep-finalized SI
  // mirror lands `author_user_id = NULL`, and the approver≠author SoD check then passes for everyone.
  const { data, error } = await serviceClient.from('external_command_outbox')
    .select('operation, payload, actor_user_id').eq('id', row.id).maybeSingle();
  if (error || !data) throw new AppError(`outbox row ${row.id} not readable for reconcile`, error?.code ?? 'not-found');
  const rowExtra = data as { operation: 'create' | 'update' | 'transition'; payload: Record<string, unknown> | null; actor_user_id: string | null };
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

  const kind = payload.erp_doc_kind;
  const entry = typeof kind === 'string' && kind in DOCTYPE_REGISTRY ? DOCTYPE_REGISTRY[kind as ErpDocKind] : undefined;
  const bodyFns = typeof kind === 'string' ? DOCTYPE_BODIES[kind as ErpDocKind] : undefined;
  if (!entry || !bodyFns) {
    // Loud (never a silent no-op): a candidate whose kind we cannot resolve needs an operator, not a POST.
    throw new AppError(`erpnext-sweep reconcile: unresolvable erp_doc_kind '${String(kind)}' for ${row.domain}/${row.pmoRecordId}`, 'commit-rejected');
  }

  const { apiKey, apiSecret } = resolveErpCredentials(org.secretRef, (key) => Deno.env.get(key));
  // BLOCK 1 (money double-POST): the recovery probe must not burn the claim budget. withProbeBudget
  // caps it (maxRetries 0 + tighter deadline) so a hung probe surfaces as unreachable instead of
  // consuming the whole 300s quarantine window and letting a claimant POST after its own reissue.
  const client = withProbeBudget({ fetchImpl: fetch, apiKey, apiSecret, baseUrl: org.siteUrl });
  // M-3: dispatch digests the exact payload persisted at INSERT. Reuse that full payload as the
  // digest input (and command record), rather than reconstructing only id + erp_doc_kind.
  const command: AdapterCommand = {
    domain: row.domain as AdapterCommand['domain'],
    operation: rowExtra.operation,
    record: payload as AdapterCommand['record'],
    idempotencyKey: row.idempotencyKey,
  };

  const adapter = await resolveErpDispatchAdapter({
    serviceClient: serviceClient as never,
    orgId: org.orgId,
    command,
    fetchImpl: fetch,
    apiKey,
    apiSecret,
    rateLimiter: { acquire: async () => {} },
    doctypeBodies: DOCTYPE_BODIES,
  });

  const anchorField = entry.anchorField;
  const probeDeps = { client, doctype: entry.doctype, anchorField: anchorField ?? '', fromDoc: bodyFns.fromDoc, pmoRecordId: row.pmoRecordId };
  const encodeExternalRecordId = (mapping: ExternalRefMapping): string =>
    mapping.domain === ERPNEXT_COMPANIES_DOMAIN ? `${entry.doctype}:${mapping.externalRecordId}` : mapping.externalRecordId;

  const { created_after: _createdAfter, ...digestPayload } = payload;
  const payloadDigest = await canonicalCommandDigest({ domain: command.domain, operation: command.operation, record: digestPayload });
  const money = createDbMoneyOutboxDeps({
    serviceClient: serviceClient as never,
    orgId: org.orgId,
    externalTier: ERPNEXT_TIER,
    operation: rowExtra.operation,
    reissueOnInconclusiveAbsence: !entry.anchorMutable,
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
    reauthorizeRecoveryReissue: async () => {
      if (!rowExtra.actor_user_id) {
        return { ok: false, message: `outbox row ${row.id} has no recorded actor — reissue held for an operator` };
      }
      const res = await checkErpnextCommandAuthorization(serviceClient as never, org.orgId, rowExtra.actor_user_id, {
        domain: command.domain,
        operation: rowExtra.operation,
        record: { id: row.pmoRecordId, erp_doc_kind: payload.erp_doc_kind },
      });
      return { ok: res.ok, message: res.message };
    },
  });

  const writeReadModel = async (canonical: PmoRecord): Promise<void> => {
    await getReadModelWriter(row.domain).upsert(
      { serviceClient: serviceClient as never, orgId: org.orgId, callerUserId: rowExtra.actor_user_id ?? undefined },
      canonical,
      command,
    );
  };
  const recordExternalRef = (mapping: ExternalRefMapping): Promise<void> =>
    recordExternalRefWrite(serviceClient as never, { ...mapping, externalRecordId: encodeExternalRecordId(mapping), orgId: org.orgId });

  return { adapter, command, writeReadModel, recordExternalRef, money };
}
