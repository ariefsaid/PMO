import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { resolveExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { ODOO_TIER, toAdapterError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { ODOO_ANCHORS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import { REQUEST_DEADLINE_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/constants.ts';
import type { PurchaseKind } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/nextStep.ts';
import { probeOdooByAnchor, type PaymentComposite } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/recoveryProbe.ts';
import { odooClientForOrg } from '../_shared/odooClientForOrg.ts';
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
 * amendment: a composite of vendor, lines, amount and window). The payment composite exists (recoveryProbe.ts); the order,
 * receipt and bill composites arrive with their adapters (P3, P4, P5), which flip their entry here with the probe. Until then
 * every kind holds on a miss: a held row costs a person a click, a reissue could cost a duplicate document.
 */
const GAP_COVERED: Record<PurchaseKind, boolean> = { order: false, receipt: false, bill: false, payment: true };
export function odooReissueOnInconclusiveAbsence(kind: PurchaseKind): boolean {
  return GAP_COVERED[kind] && !ODOO_ANCHORS[kind].mutable && kind !== 'bill';
}

/** PD-4: the anchor key is derived from the PMO record, never from the client's per-click idempotency key. */
export function odooAnchorKey(kind: PurchaseKind, record: Record<string, unknown>): string {
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
  const anchorKey = odooAnchorKey(kind, record);
  const raw = bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS });
  const call: OdooCall = async <T>(model: string, method: string, body?: Record<string, unknown>) => {
    try { return await raw<T>(model, method, body); } catch (err) { return toAdapterError(err); }
  };

  const payload: Record<string, unknown> = { ...record, erp_doc_kind: docKind, ...(kind === 'payment' ? await paymentCompositePayload(ctx) : {}) };
  const { created_after: _window, ...material } = payload;
  const payloadDigest = await canonicalCommandDigest({ domain: ctx.command.domain, operation, record: material });

  return createDbMoneyOutboxDeps({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    externalTier: ODOO_TIER,
    // The outbox column takes create|update|transition; a revise edits the confirmed order in place.
    operation: operation === 'revise' ? 'update' : (operation as 'create' | 'update' | 'transition'),
    actorUserId: ctx.userId,
    reissueOnInconclusiveAbsence: odooReissueOnInconclusiveAbsence(kind),
    payload,
    payloadDigest,
    ...(ctx.command.domain === 'procurement' && operation === 'create'
      ? { reauthorizeRecoveryReissue: () => checkQueuedProcurementCreate(ctx.serviceClient as never, ctx.orgId, ctx.command as never, ctx.userId) }
      : {}),
    probeByRemarksKey: async (domain, idempotencyKey) => {
      const stored = kind === 'payment' ? await readOutboxCompositePayload(ctx.serviceClient, ctx.orgId, domain, ctx.command.record.id, idempotencyKey) : null;
      const hit = await probeOdooByAnchor(call, kind, anchorKey, compositeOf(stored) ?? compositeOf(payload));
      return hit ? { externalRecordId: hit.externalRecordId, canonical: { id: ctx.command.record.id } } : null;
    },
  });
}

