import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { resolveExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { ODOO_TIER, toAdapterError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { ODOO_ANCHORS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import { REQUEST_DEADLINE_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/constants.ts';
import type { PurchaseKind } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/nextStep.ts';
import { probeOdooByAnchor, type OrderComposite, type PaymentComposite } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/recoveryProbe.ts';
import { recoverBill, recoverOrder, recoverRevise } from '../../../pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts';
import { expectedBillTotal } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billBody.ts';
import type { BillExpect } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billReadBack.ts';
import { odooClientForOrg, type OdooClientForOrgResult } from '../_shared/odooClientForOrg.ts';
import { billCompositeFacts, orderCompositeFacts, resolveOdooBillInputs, resolveOdooOrderCurrency } from '../_shared/odooPurchaseRefs.ts';
import { readOutboxCompositePayload } from './erpMoneyOutbox.ts';
import { canonicalCommandDigest, createDbMoneyOutboxDeps } from './moneyOutboxDeps.ts';
import { checkQueuedProcurementCreate } from './procurementGateGuard.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';

/** The PMO document kinds a purchase command names (the shared command shape) and the Odoo document each becomes. */
export const ODOO_PURCHASE_KIND: Readonly<Record<string, PurchaseKind>> = {
  'purchase-order': 'order', 'goods-receipt': 'receipt', 'purchase-invoice': 'bill', payment: 'payment',
};
const KEY_PREFIX: Record<PurchaseKind, string> = { order: 'po', receipt: 'gr', bill: 'bill', payment: 'pay' };

/**
 * Whether a recovery that finds nothing may mint the document again. OQ-OPP-10: bills and payments hold; orders and receipts
 * reissue only on CONCLUSIVE absence. Absence is conclusive only where a probe also covers the create-to-anchor gap (DD-OPP-4
 * amendment: a composite of vendor, lines, amount and window). The order, bill and payment composites exist (recoveryProbe.ts); the
 * receipt composite arrives with its adapter (P4), which flips its entry here with the probe. A bill's composite only ADOPTS an
 * unanchored bill that matches exactly; a miss still holds, because bills are never reissued on doubt (OQ-OPP-10). Until then the
 * receipt holds on a miss: a held row costs a person a click, a reissue could cost a duplicate document.
 * A revision is the exception that proves the rule: it edits the order in place, towards a line set, so repeating it after a
 * miss is a no-op and cannot mint anything (AC-SCA-011 `absent-conclusive` -> reissue).
 */
const GAP_COVERED: Record<PurchaseKind, boolean> = { order: true, receipt: false, bill: true, payment: true };
export function odooReissueOnInconclusiveAbsence(kind: PurchaseKind, operation?: string): boolean {
  if (operation === 'revise') return true;
  return GAP_COVERED[kind] && !ODOO_ANCHORS[kind].mutable && kind !== 'bill';
}

/** PD-4: the anchor key is derived from the PMO record, never from the client's per-click idempotency key. */
export function odooAnchorKey(kind: PurchaseKind, record: Record<string, unknown>, operation?: string): string {
  if (operation === 'revise') return `porev:${String(record.poId)}:${String(record.revision)}`;   // one key per PMO revision (PD-4)
  const id = String(record.id);
  const suffix = kind === 'receipt' ? `:${String(record.receiptDigest ?? '')}` : '';
  return `${KEY_PREFIX[kind]}:${id}${suffix}`;
}

/** Odoo stores naive UTC `YYYY-MM-DD HH:MM:SS`. */
const odooDatetime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const partnerIdOf = (ref: string | null): number | null => {
  const id = Number(/:(\d+)$/.exec(ref ?? '')?.[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** A payment's composite-probe inputs, persisted with the outbox row so the retry and the sweep probe identically (C-1). */
async function paymentCompositePayload(ctx: AdapterSelectContext): Promise<Record<string, unknown>> {
  const record = ctx.command.record as Record<string, unknown>;
  const supplier = typeof record.supplier === 'string' ? record.supplier : null;
  const ref = supplier ? await resolveExternalRef(ctx.serviceClient as never, ctx.orgId, 'companies', supplier) : null;
  return { odoo_partner_id: partnerIdOf(ref), odoo_amount: record.paid_amount ?? null, created_after: odooDatetime(Date.now() - 60_000) };
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
  const window = { created_after: odooDatetime(Date.now() - ORDER_WINDOW_MS) };
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
const DERIVED_KEYS = ['odoo_expected_total', 'odoo_cost_account'] as const;
const billExpectOf = (p: Record<string, unknown> | null | undefined): BillExpect | undefined =>
  p && typeof p.odoo_expected_total === 'string' && (typeof p.odoo_cost_account === 'string' || p.odoo_cost_account === null)
    ? { total: p.odoo_expected_total, costAccountId: p.odoo_cost_account }
    : undefined;

const orderCompositeOf = (p: Record<string, unknown> | null | undefined): OrderComposite | undefined =>
  p && typeof p.odoo_partner_id === 'number' && typeof p.odoo_amount === 'string' && Number.isInteger(p.odoo_line_count) && typeof p.created_after === 'string'
    ? { partnerId: p.odoo_partner_id, amount: p.odoo_amount, lineCount: p.odoo_line_count as number, createdAfter: p.created_after }
    : undefined;

const compositeOf = (p: Record<string, unknown> | null | undefined): PaymentComposite | undefined =>
  p && typeof p.odoo_partner_id === 'number' && (typeof p.odoo_amount === 'number' || typeof p.odoo_amount === 'string') && typeof p.created_after === 'string'
    ? { partnerId: p.odoo_partner_id, amount: p.odoo_amount, createdAfter: p.created_after }
    : undefined;

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
  const anchorKey = odooAnchorKey(kind, record, operation);
  const raw = bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS });
  const call: OdooCall = async <T>(model: string, method: string, body?: Record<string, unknown>) => {
    try { return await raw<T>(model, method, body); } catch (err) { return toAdapterError(err); }
  };

  const isOrderCreate = kind === 'order' && operation !== 'revise';
  const isBillCreate = kind === 'bill' && operation === 'create';
  const payload: Record<string, unknown> = {
    ...record, erp_doc_kind: docKind,
    ...(kind === 'payment' ? await paymentCompositePayload(ctx) : isOrderCreate ? await orderCompositePayload(ctx) : isBillCreate ? await billCompositePayload(ctx, call, resolved) : {}),
  };
  const { created_after: _window, ...withDerived } = payload;
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
    probeByRemarksKey: async (domain, idempotencyKey) => {
      // An order and a revision are not adopted as a bare reference: the probe also anchors a found order and completes its
      // confirm, and returns it read back (a draft adopted as it stands would be mirrored as issued).
      if (operation === 'revise') return recoverRevise(call, ctx.command.record);
      if (isOrderCreate) {
        const persisted = await readOutboxCompositePayload(ctx.serviceClient, ctx.orgId, domain, ctx.command.record.id, idempotencyKey);
        return recoverOrder(call, ctx.command.record, orderCompositeOf(persisted) ?? orderCompositeOf(payload));
      }
      if (isBillCreate) {
        const persisted = await readOutboxCompositePayload(ctx.serviceClient, ctx.orgId, domain, ctx.command.record.id, idempotencyKey);
        const expect = billExpectOf(persisted) ?? billExpectOf(payload);
        if (!expect) throw new AppError('bill-expectation-missing', 'commit-rejected');   // cannot judge a recovered bill: hold it
        return recoverBill(call, ctx.command.record, orderCompositeOf(persisted) ?? orderCompositeOf(payload), expect);
      }
      const stored = kind === 'payment' ? await readOutboxCompositePayload(ctx.serviceClient, ctx.orgId, domain, ctx.command.record.id, idempotencyKey) : null;
      const hit = await probeOdooByAnchor(call, kind, anchorKey, compositeOf(stored) ?? compositeOf(payload));
      return hit ? { externalRecordId: hit.externalRecordId, canonical: { id: ctx.command.record.id } } : null;
    },
  });
}

