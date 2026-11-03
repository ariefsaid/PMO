import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { ODOO_TIER, toAdapterError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import { odooReissueOnInconclusiveAbsence } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/reissuePolicy.ts';
import { CLAIM_BUDGET_MS, REQUEST_DEADLINE_MS, SETTLE_MARGIN_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/constants.ts';
import type { PurchaseKind } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/nextStep.ts';
import type { OrderComposite, PaymentComposite } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/recoveryProbe.ts';
import { readOrderLines, recoverBill, recoverOrder, recoverPayment, recoverReceipt, recoverRevise, type PaymentResolution } from '../../../pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts';
import { expectedBillTotal } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billBody.ts';
import type { BillExpect } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billReadBack.ts';
import { odooClientForOrg, type OdooClientForOrgResult } from '../_shared/odooClientForOrg.ts';
import { billCompositeFacts, orderCompositeFacts, paymentCompositeFacts, resolveOdooBillInputs, resolveOdooOrderCurrency, resolveOdooReceiptFacts } from '../_shared/odooPurchaseRefs.ts';
import { parseReceiptPlan, planReceipt } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/receiptBody.ts';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { readOutboxCompositePayload } from './erpMoneyOutbox.ts';
import { canonicalCommandDigest, createDbMoneyOutboxDeps } from './moneyOutboxDeps.ts';
import { checkQueuedProcurementCreate } from './procurementGateGuard.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';

/** The PMO document kinds a purchase command names (the shared command shape) and the Odoo document each becomes. */
export const ODOO_PURCHASE_KIND: Readonly<Record<string, PurchaseKind>> = {
  'purchase-order': 'order', 'goods-receipt': 'receipt', 'purchase-invoice': 'bill', payment: 'payment',
};
const KEY_PREFIX: Record<PurchaseKind, string> = { order: 'po', receipt: 'gr', bill: 'bill', payment: 'pay' };

/** Whether a recovery that finds nothing may mint the document again (OQ-OPP-10): the policy lives in `reissuePolicy.ts`, pure, so a unit test can bind to it. */
export { odooReissueOnInconclusiveAbsence };

/** PD-4: the anchor key is derived from the PMO record, never from the client's per-click idempotency key. */
export function odooAnchorKey(kind: PurchaseKind, record: Record<string, unknown>, operation?: string): string {
  if (operation === 'revise') return `porev:${String(record.poId)}:${String(record.revision)}`;   // one key per PMO revision (PD-4)
  const id = String(record.id);
  const suffix = kind === 'receipt' ? `:${String(record.receiptDigest ?? '')}` : '';
  return `${KEY_PREFIX[kind]}:${id}${suffix}`;
}

/** Odoo stores naive UTC `YYYY-MM-DD HH:MM:SS`. */
const odooDatetime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/**
 * A payment's composite-probe inputs, persisted with the outbox row so the retry and the sweep probe identically (C-1): the vendor,
 * the amount, the bill it pays (the conjunct that tells our payment from a look-alike) and the window the first attempt could have
 * created it in, bounded on both sides. DB reads only: a recovery must not depend on Odoo being reachable to know what to look for.
 */
async function paymentCompositePayload(ctx: AdapterSelectContext): Promise<Record<string, unknown>> {
  const record = ctx.command.record as Record<string, unknown>;
  const facts = await paymentCompositeFacts(ctx.serviceClient as SupabaseClient, ctx.orgId, record);
  return {
    odoo_partner_id: facts.partnerId, odoo_amount: record.paid_amount ?? null, odoo_bill_ref: facts.billRef,
    created_after: odooDatetime(Date.now() - ORDER_WINDOW_MS), created_before: odooDatetime(Date.now() + CLAIM_BUDGET_MS + SETTLE_MARGIN_MS),
  };
}

/** How far back the composite looks: wide enough to survive a skewed Odoo clock; a wider window only holds more, never reissues. */
const ORDER_WINDOW_MS = 10 * 60_000;

/** An order's composite-probe inputs, persisted with the outbox row for the same reason (the window is the first attempt's). */
async function orderCompositePayload(ctx: AdapterSelectContext): Promise<Record<string, unknown>> {
  const facts = await orderCompositeFacts(ctx.serviceClient as SupabaseClient, ctx.orgId, ctx.command.record as { id?: unknown; procurementId?: unknown });
  return { odoo_partner_id: facts.partnerId, odoo_amount: facts.amount, odoo_line_count: facts.lineCount, created_after: odooDatetime(Date.now() - ORDER_WINDOW_MS) };
}

/**
 * A bill's composite-probe inputs plus what its read-back is judged against (the figure PMO expected, the project's cost account),
 * persisted with the outbox row so a retry or the sweep probes and judges identically. A replay resolves nothing new (the document
 * may already exist and today's mappings are not its concern): it takes the composite facts alone and the expectation from the
 * stored row.
 */
async function billCompositePayload(ctx: AdapterSelectContext, call: OdooCall, resolved: Exclude<OdooClientForOrgResult, { refusal: unknown }>): Promise<Record<string, unknown>> {
  const sc = ctx.serviceClient as SupabaseClient;
  // Bounded above: a bill is created within the first attempt's commit budget, so a vendor bill made after that is not ours (I1).
  const window = { created_after: odooDatetime(Date.now() - ORDER_WINDOW_MS), created_before: odooDatetime(Date.now() + CLAIM_BUDGET_MS + SETTLE_MARGIN_MS) };
  if (ctx.replay) {
    const facts = await billCompositeFacts(sc, ctx.orgId, ctx.command.record as { procurementId?: unknown });
    return { odoo_partner_id: facts.partnerId, odoo_amount: facts.amount, odoo_line_count: facts.lineCount, ...window };
  }
  const currencyId = await resolveOdooOrderCurrency(sc, ctx.orgId, ctx.command, call, resolved.companyId);
  const { input, ctx: bill } = await resolveOdooBillInputs(sc, ctx.orgId, ctx.command, resolved, currencyId, call);
  const facts = await billCompositeFacts(sc, ctx.orgId, ctx.command.record as { procurementId?: unknown });
  return {
    odoo_partner_id: facts.partnerId, odoo_amount: facts.amount, odoo_line_count: facts.lineCount, ...window,
    odoo_expected_total: expectedBillTotal(input, bill.taxes), odoo_cost_account: bill.costAccountId,
  };
}

/** What the read-back is judged against: derived, so it is not command material (it stays out of the payload digest). */
const DERIVED_KEYS = ['odoo_expected_total', 'odoo_cost_account', 'odoo_bill_ref', 'odoo_adopted_ref', 'odoo_absent_confirmed'] as const;
const billExpectOf = (p: Record<string, unknown> | null | undefined): BillExpect | undefined =>
  p && typeof p.odoo_expected_total === 'string' && (typeof p.odoo_cost_account === 'string' || p.odoo_cost_account === null)
    ? { total: p.odoo_expected_total, costAccountId: p.odoo_cost_account }
    : undefined;

const orderCompositeOf = (p: Record<string, unknown> | null | undefined): OrderComposite | undefined =>
  p && typeof p.odoo_partner_id === 'number' && typeof p.odoo_amount === 'string' && Number.isInteger(p.odoo_line_count) && typeof p.created_after === 'string'
    ? { partnerId: p.odoo_partner_id, amount: p.odoo_amount, lineCount: p.odoo_line_count as number, createdAfter: p.created_after, ...(typeof p.created_before === 'string' ? { createdBefore: p.created_before } : {}) }
    : undefined;

/** A held payment's resolution (0508 `resolve_held_outbox_command`): the operator's word, stored in the row's payload. */
const paymentResolutionOf = (p: Record<string, unknown> | null | undefined): PaymentResolution | undefined =>
  typeof p?.odoo_adopted_ref === 'string' ? { adoptedRef: p.odoo_adopted_ref } : p?.odoo_absent_confirmed === true ? { absentConfirmed: true } : undefined;

const paymentCompositeOf = (p: Record<string, unknown> | null | undefined): PaymentComposite | undefined => {
  const billId = parseOdooExternalRef('account.move', p?.odoo_bill_ref);
  return p && typeof p.odoo_partner_id === 'number' && (typeof p.odoo_amount === 'number' || typeof p.odoo_amount === 'string') && typeof p.created_after === 'string' && billId !== null
    ? { partnerId: p.odoo_partner_id, amount: p.odoo_amount, createdAfter: p.created_after, billId, ...(typeof p.created_before === 'string' ? { createdBefore: p.created_before } : {}) }
    : undefined;
};

/**
 * A goods receipt's plan, fixed ONCE (FR-OPP-033): the first attempt plans from live Odoo (refusing above the open quantity before
 * any outbox row); every retry of that command reads the plan back from its outbox row verbatim, because Odoo's quantities already
 * include a validate the lost response hid and a fresh plan would book it again. An unreadable or broken stored plan is refused,
 * never re-planned. The server's plan replaces anything the client put in the record.
 */
async function stampReceiptPlan(ctx: AdapterSelectContext, call: OdooCall, resolved: { config: Record<string, unknown>; companyId: number | null }): Promise<void> {
  const command = ctx.command;
  const record = command.record as Record<string, unknown>;
  const stored = await ctx.serviceClient.from('external_command_outbox').select('payload').eq('org_id', ctx.orgId).eq('domain', command.domain)
    .eq('pmo_record_id', command.record.id).eq('idempotency_key', command.idempotencyKey!).maybeSingle();
  if (stored.error) throw new AppError('The receipt could not be checked against its earlier attempt', 'external-unreachable');
  const row = stored.data as { payload?: Record<string, unknown> | null } | null;
  let plan;
  if (row) plan = await parseReceiptPlan(row.payload?.odooReceipt) ?? (() => { throw new AdapterError('commit-rejected', 'receipt-plan-invalid'); })();
  else {
    const facts = await resolveOdooReceiptFacts(ctx.serviceClient as SupabaseClient, ctx.orgId, command, resolved);
    plan = await planReceipt(facts.orderId, await readOrderLines(call, facts.orderId), facts.wanted, facts.itemMap);
  }
  record.odooReceipt = plan;
  record.receiptDigest = plan.digest;
}

/**
 * The DB-backed money-outbox deps for ONE Odoo procurement command (FR-OPP-070): the shared outbox, claim, fence and finalize,
 * with Odoo's recovery probe. A command whose connection cannot be used is refused here, before any outbox row (DD-OPP-8).
 */
export async function resolveOdooMoneyOutboxDeps(ctx: AdapterSelectContext): Promise<DispatchMoneyOutboxDeps> {
  const operation = ctx.command.operation as string;
  if (operation === 'delete') throw new AppError('odoo adapter does not support delete', 'commit-rejected');
  const record = ctx.command.record as Record<string, unknown>;
  const docKind = String(record.erp_doc_kind);
  const kind = ODOO_PURCHASE_KIND[docKind];
  if (!kind) throw new AppError(`odoo purchase kind '${docKind}' is not wired`, 'commit-rejected');
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  const raw = bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS });
  const call: OdooCall = async <T>(model: string, method: string, body?: Record<string, unknown>) => {
    try { return await raw<T>(model, method, body); } catch (err) { return toAdapterError(err); }
  };
  const isReceiptCreate = kind === 'receipt' && operation === 'create';
  if (isReceiptCreate) await stampReceiptPlan(ctx, call, resolved);

  const isOrderCreate = kind === 'order' && operation !== 'revise';
  const isBillCreate = kind === 'bill' && operation === 'create';
  const payload: Record<string, unknown> = {
    ...record, erp_doc_kind: docKind,
    ...(kind === 'payment' ? await paymentCompositePayload(ctx) : isOrderCreate ? await orderCompositePayload(ctx) : isBillCreate ? await billCompositePayload(ctx, call, resolved) : {}),
  };
  const { created_after: _window, created_before: _windowEnd, ...withDerived } = payload;
  const material = Object.fromEntries(Object.entries(withDerived).filter(([k]) => !(DERIVED_KEYS as readonly string[]).includes(k)));
  const payloadDigest = await canonicalCommandDigest({ domain: ctx.command.domain, operation, record: material });

  return createDbMoneyOutboxDeps({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    externalTier: ODOO_TIER,
    // The outbox column takes create|update|transition; a revise edits the confirmed order in place.
    operation: operation === 'revise' ? 'update' : (operation as 'create' | 'update' | 'transition'),
    actorUserId: ctx.userId,
    reissueOnInconclusiveAbsence: odooReissueOnInconclusiveAbsence(kind, operation),
    payload,
    payloadDigest,
    ...(ctx.command.domain === 'procurement' && operation === 'create'
      ? { reauthorizeRecoveryReissue: () => checkQueuedProcurementCreate(ctx.serviceClient as never, ctx.orgId, ctx.command as never, ctx.userId) }
      : {}),
    probeByRemarksKey: async (domain, idempotencyKey, probe) => {
      // An order and a revision are not adopted as a bare reference: the probe also anchors a found order and completes its
      // confirm, and returns it read back (a draft adopted as it stands would be mirrored as issued).
      if (operation === 'revise') return recoverRevise(call, ctx.command.record);
      if (isReceiptCreate) return recoverReceipt(call, ctx.command.record);
      if (isOrderCreate) {
        const persisted = await readOutboxCompositePayload(ctx.serviceClient, ctx.orgId, domain, ctx.command.record.id, idempotencyKey);
        return recoverOrder(call, ctx.command.record, orderCompositeOf(persisted) ?? orderCompositeOf(payload));
      }
      if (isBillCreate) {
        const persisted = await readOutboxCompositePayload(ctx.serviceClient, ctx.orgId, domain, ctx.command.record.id, idempotencyKey);
        const expect = billExpectOf(persisted) ?? billExpectOf(payload);
        if (!expect) throw new AppError('bill-expectation-missing', 'commit-rejected');   // cannot judge a recovered bill: hold it
        // The composite looks for a bill a lost response may have left without its identifier, so it runs only in a RECOVERY. A bill's
        // first attempt has made nothing yet: the vendor's other, unanchored Odoo bills are not its business (I1). No signal = recovery.
        const composite = probe?.recovery === false ? undefined : orderCompositeOf(persisted) ?? orderCompositeOf(payload);
        return recoverBill(call, ctx.command.record, composite, expect);
      }
      // A payment's anchor is a memo anyone can edit, so a recovery may also look for it by vendor, amount, window and bill; a first attempt
      // has made nothing yet and looks by memo alone. Doubt throws (the row is held); nothing found is null, which the outbox holds too
      // (`odooReissueOnInconclusiveAbsence`), so a payment is never created by a recovery.
      const persisted = await readOutboxCompositePayload(ctx.serviceClient, ctx.orgId, domain, ctx.command.record.id, idempotencyKey);
      const billRef = [persisted, payload].map((p) => p?.odoo_bill_ref).find((r): r is string => typeof r === 'string');
      if (!billRef) throw new AppError('payment-bill-missing', 'commit-rejected');   // cannot say which bill this pays: hold it
      return recoverPayment(call, ctx.command.record, probe?.recovery === false ? undefined : paymentCompositeOf(persisted) ?? paymentCompositeOf(payload), billRef, paymentResolutionOf(persisted));
    },
  });
}

