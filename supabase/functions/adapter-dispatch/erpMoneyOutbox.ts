import { type SupabaseClient } from '@supabase/supabase-js';
import { canonicalCommandDigest, createDbMoneyOutboxDeps } from './moneyOutboxDeps.ts';
import { checkQueuedProcurementCreate } from './procurementGateGuard.ts';
import { isBudgetPushCommand } from './budgetDispatch.ts';
import { withPaymentTypeDiscriminator } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import { ERPNEXT_COMPANIES_DOMAIN, ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { DOCTYPE_BODIES } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts';
import { DOCTYPE_REGISTRY, reissueOnInconclusiveAbsence, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import { erpDatetime, probeErpByAnchorKey, probeErpByPaymentComposite, withholdingMatchFromPayload } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.ts';
import { resolveExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { DispatchMoneyOutboxDeps, ExternalRefMapping } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { withProbeBudget } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { resolveErpAuthPair } from '../_shared/erpAuthPair.ts';
import { externalConnectEnabled } from '../_shared/externalConnectEnabled.ts';
import { guardedErpFetch } from '../_shared/erpHostGuard.ts';
import type { AdapterSelectContext, ErpBindingRow } from './dispatchAdapters.ts';

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
export async function resolveErpMoneyOutboxDeps(ctx: AdapterSelectContext, resolveBinding: (client: SupabaseClient, orgId: string) => Promise<ErpBindingRow>): Promise<DispatchMoneyOutboxDeps> {
  if (!externalConnectEnabled()) {
    throw new AppError('external integrations are disabled by the operator', 'config-rejected');
  }
  // The outbox `operation` column (0095) is CHECK-constrained to create|update|transition — 'delete'
  // never reaches it (the erpnext adapter itself rejects delete, OQ-8, cancel-only); reject loud here
  // too, before any DB write, rather than letting a raw CHECK-violation surface.
  if ((ctx.command.operation as string) === 'delete') {
    throw new AppError('erpnext adapter does not support delete — cancel-only (OQ-8)', 'commit-rejected');
  }
  const binding = await resolveBinding(ctx.serviceClient, ctx.orgId);
  const { apiKey, apiSecret } = await resolveErpAuthPair(ctx.serviceClient, { orgId: ctx.orgId, secretRef: binding.secret_ref }, ctx.erpAuth);

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
  const client = withProbeBudget({ fetchImpl: guardedErpFetch(binding.site_url), apiKey, apiSecret, baseUrl: binding.site_url });
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
  // A budget unit no longer carries the Retry's `target_fiscal_year` (see the fan-out). A row a Retry
  // stored before that change bound it to the unit's own year, so that digest still names this command.
  const legacyPayloadDigests = isBudgetPushCommand(ctx.command) && typeof digestPayload.fiscal_year === 'string'
    ? [await canonicalCommandDigest({
        domain: ctx.command.domain,
        operation: ctx.command.operation as string,
        record: { ...digestPayload, target_fiscal_year: digestPayload.fiscal_year },
      })]
    : undefined;

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
    // ⚑ HIGH-1: an `upsertOnGrain` kind (ERP `Budget`) has no anchor at ALL, but ERP itself enforces its
    // natural grain, so the dispatch factory's server-derived grain read is a conclusive probe and a
    // recovery may reissue — holding instead made the upsert's unenforced-grain window PERMANENT. The
    // rule lives in ONE place (`reissueOnInconclusiveAbsence`, doctypeRegistry.ts) so the sync dispatch
    // and the sweep can never disagree about whether a money command may be re-minted.
    reissueOnInconclusiveAbsence: reissueOnInconclusiveAbsence(entry),
    payload,
    payloadDigest,
    // #1783 item 1: a legacy receipt row reached by a caller-line-intent command verifies in memory
    // against its persisted payload (the resolver's own material rule) + persisted operation before
    // the M-3 comparison. Receipt-scoped: only a line-intent command sets the context flag.
    ...(ctx.receiptLineIntent
      ? { verifyLegacyReceiptDigest: { material: (p: Record<string, unknown>) => {
        const { created_after: _createdAfter, ...digestPayload } = p;
        return digestPayload;
      } } }
      : {}),
    procurementSnapshot: ctx.procurementSnapshot,
    procurementInputDigest: ctx.procurementInputDigest,
    legacyPayloadDigests,
    encodeExternalRecordId,
    // A quarantined procurement create whose probe finds nothing is reissued as a NEW ERP document; the org's purchase
    // rules are asked again at that moment (under a lock on the purchase), as the outbox claim does for pending and
    // failed rows. A refusal holds the row for an operator; an adopt of a document that already landed never asks.
    ...(ctx.command.domain === 'procurement' && String(ctx.command.operation) === 'create'
      ? { reauthorizeRecoveryReissue: () => checkQueuedProcurementCreate(ctx.serviceClient as never, ctx.orgId, ctx.command as never, ctx.userId) }
      : {}),
    probeByRemarksKey: !anchorField
      ? () => Promise.resolve(null)
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
              ...withholdingMatchFromPayload(p),
            });
          },
  });
}

/** Build the Payment Entry composite-probe payload from the command (persisted at outbox INSERT).
 *  Handles both PE-pay (procurement) and PE-receive (revenue).
 *  - PE-pay: supplier `party` via external_refs (companies domain), `piNames` from `references`.
 *  - PE-receive: customer `party` via external_refs (companies domain), `siNames` from `references`.
 *  `created_after` bounds the candidate set to this attempt's window. */
export async function buildPaymentCompositePayload(ctx: AdapterSelectContext): Promise<Record<string, unknown>> {
  const rec = ctx.command.record as Record<string, unknown>;
  const kind = typeof rec.erp_doc_kind === 'string' ? rec.erp_doc_kind : '';
  const isReceive = kind === 'incoming-payment';
  const partyIdField = isReceive ? 'customerId' : 'supplier';
  const partyId = typeof rec[partyIdField] === 'string' ? rec[partyIdField] as string : undefined;
  const resolvedParty = partyId
    ? await resolveExternalRef(ctx.serviceClient as never, ctx.orgId, ERPNEXT_COMPANIES_DOMAIN, partyId)
    : null;
  // external_refs stores companies as "<Doctype>:<name>"; the probe compares the bare ERP party name.
  const party = resolvedParty ? resolvedParty.slice(resolvedParty.indexOf(':') + 1) : null;
  const referenceNames = Array.isArray(rec.references)
    ? (rec.references as Array<{ reference_name?: unknown }>).map((r) => String(r.reference_name)).filter((n) => n && n !== 'undefined')
    : [];

  // DD-RCPT-1: with tax withheld, ERPNext stores the CASH in `paid_amount` (peReceiveToBody sends it
  // there), so the fallback match must look for the cash; otherwise the gross it was sent as.
  const withheld = isReceive && Number(rec.withheld_amount ?? 0) > 0;
  return {
    party_type: isReceive ? 'Customer' : 'Supplier',
    party,
    paid_amount: isReceive ? (withheld ? rec.received_amount : rec.paid_amount) ?? null : rec.paid_amount ?? null,
    // A withholding receipt is matched on the cash, its deduction and its gross invoice allocation.
    ...(withheld ? { withheld_amount: rec.withheld_amount, allocated_amount: rec.paid_amount ?? null } : {}),
    pi_names: isReceive ? [] : referenceNames,
    si_names: isReceive ? referenceNames : [],
    payment_type: isReceive ? 'Receive' : 'Pay',
    created_after: erpDatetime(Date.now() - 60_000),
  };
}

/** Read the persisted composite-probe payload and verified actor for one command's outbox row. */
export async function readOutboxCompositeWitness(
  serviceClient: SupabaseClient,
  orgId: string,
  domain: string,
  pmoRecordId: string,
  idempotencyKey: string,
): Promise<{ payload: Record<string, unknown> | null; actorUserId: string | null } | null> {
  const { data, error } = await serviceClient
    .from('external_command_outbox')
    .select('payload,actor_user_id')
    .eq('org_id', orgId)
    .eq('domain', domain)
    .eq('pmo_record_id', pmoRecordId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) {
    throw new AppError('The earlier outbox command could not be checked', 'external-unreachable');
  }
  const row = data as { payload?: Record<string, unknown> | null; actor_user_id?: unknown } | null;
  if (!row) return null;
  return {
    payload: row.payload ?? null,
    actorUserId: typeof row.actor_user_id === 'string' ? row.actor_user_id : null,
  };
}

/** Read only the persisted composite-probe payload for a command. */
export async function readOutboxCompositePayload(
  serviceClient: SupabaseClient,
  orgId: string,
  domain: string,
  pmoRecordId: string,
  idempotencyKey: string,
): Promise<Record<string, unknown> | null> {
  return (await readOutboxCompositeWitness(serviceClient, orgId, domain, pmoRecordId, idempotencyKey))?.payload ?? null;
}
