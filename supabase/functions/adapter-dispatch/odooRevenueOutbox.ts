import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { toAdapterError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { recoverInvoice } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.ts';
import { REVENUE_KEY_RE, type RevenueKind } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/anchors.ts';
import { CLAIM_BUDGET_MS, REQUEST_DEADLINE_MS, SETTLE_MARGIN_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/constants.ts';
import type { InvoiceExpect } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.ts';
import type { InvoiceComposite } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/recoveryProbe.ts';
import { odooClientForOrg, type OdooClientForOrgResult } from '../_shared/odooClientForOrg.ts';
import { invoiceCompositeFacts, resolveOdooInvoiceCommandMaterial, resolveOdooInvoiceInputs, type InvoiceDraftRow } from '../_shared/odooRevenueRefs.ts';
import { readOutboxCompositePayload } from './erpMoneyOutbox.ts';
import { canonicalCommandDigest, createDbMoneyOutboxDeps } from './moneyOutboxDeps.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';

/** The PMO document kinds a revenue command names (the shared command shape) and the key prefix each anchors under (PD-4). */
const KEY_PREFIX: Readonly<Record<RevenueKind, string>> = { 'sales-invoice': 'si', 'incoming-payment': 'ip' };
const isRevenueKind = (kind: unknown): kind is RevenueKind => typeof kind === 'string' && kind in KEY_PREFIX;

/**
 * PD-4: the anchor key follows the PMO record, never the client's per-click idempotency key, and is the same whether the invoice is
 * ordinary, a claim, a down payment or a T&M claim (one invoice record -> one Odoo invoice, ever). A record id that is not a UUID cannot
 * reach Odoo: it refuses before any outbox row.
 */
export function odooRevenueAnchorKey(kind: RevenueKind, record: Record<string, unknown>): string {
  const key = `${KEY_PREFIX[kind]}:${String(record.id)}`;
  if (!REVENUE_KEY_RE.test(key)) throw new AppError('revenue-record-id-invalid', 'commit-rejected');
  return key;
}

/** Has this command (the same record and idempotency key) already left an outbox row? Unreadable is refused, never taken for a first attempt. */
export async function revenueOutboxRowExists(ctx: AdapterSelectContext): Promise<boolean> {
  const { command } = ctx;
  const { data, error } = await (ctx.serviceClient as SupabaseClient).from('external_command_outbox').select('id')
    .eq('org_id', ctx.orgId).eq('domain', command.domain).eq('pmo_record_id', command.record.id).eq('idempotency_key', command.idempotencyKey!).maybeSingle();
  if (error) throw new AppError('The invoice could not be checked against its earlier attempt', 'external-unreachable');
  return data !== null;
}

/** Odoo stores naive UTC `YYYY-MM-DD HH:MM:SS`. */
const odooDatetime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
/** How far back the composite looks: wide enough to survive a skewed Odoo clock; a wider window only holds more, never reissues. */
const WINDOW_MS = 10 * 60_000;

/** What the read-back is judged against and the composite's inputs: derived, so not command material (they stay out of the payload digest). */
const DERIVED_KEYS = [
  'odoo_expected_total', 'odoo_cost_account', 'odoo_advance_product_id', 'odoo_advance_account_id',
  'odoo_partner_id', 'created_after', 'created_before', 'odoo_adopted_ref', 'odoo_absent_confirmed',
] as const;
const expectOf = (p: Record<string, unknown> | null | undefined): InvoiceExpect | undefined => {
  if (!p || typeof p.odoo_expected_total !== 'string' || !(typeof p.odoo_cost_account === 'number' || p.odoo_cost_account === null)) return undefined;
  const advanceAccount = typeof p.odoo_advance_product_id === 'number' && typeof p.odoo_advance_account_id === 'number'
    ? { productId: p.odoo_advance_product_id, accountId: p.odoo_advance_account_id } : undefined;
  return { total: p.odoo_expected_total, costAccountId: p.odoo_cost_account, ...(advanceAccount ? { advanceAccount } : {}) };
};
const compositeOf = (p: Record<string, unknown> | null | undefined): InvoiceComposite | undefined =>
  p && typeof p.odoo_partner_id === 'number' && typeof p.created_after === 'string'
    ? { partnerId: p.odoo_partner_id, createdAfter: p.created_after, ...(typeof p.created_before === 'string' ? { createdBefore: p.created_before } : {}) }
    : undefined;

/** Bind retries to the PMO draft source, including lines that Odoo rounding normalized in the outbox payload. */
export const odooInvoiceDraftDigest = (draft: InvoiceDraftRow): Promise<string> => canonicalCommandDigest({
  domain: 'revenue', operation: 'create', record: {
    id: draft.id, customerId: draft.customerId, projectId: draft.projectId, workOrderId: draft.workOrderId,
    referenceNumber: draft.referenceNumber, invoiceDate: draft.invoiceDate, currency: draft.currency,
    items: draft.lines.map(({ item_code, description, qty, rate, amount }) => ({ item_code, description, qty, rate, amount })),
  },
});

/**
 * The approval of an invoice draft (FR-OCI-070): the outbox row is a `create` (the Odoo document is created and posted by this one command, and
 * the work-order fence of 0262 reads the row as the create it is). Its payload is the draft as resolved from PMO's tables, plus the figure Odoo
 * is expected to answer and the composite's inputs, persisted so a retry or the sweep probes and judges identically.
 */
async function invoiceOutboxDeps(ctx: AdapterSelectContext, resolved: Exclude<OdooClientForOrgResult, { refusal: unknown }>, record: Record<string, unknown>): Promise<DispatchMoneyOutboxDeps> {
  const sc = ctx.serviceClient as SupabaseClient;
  const raw = bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS });
  const call: OdooCall = async <T>(model: string, method: string, body?: Record<string, unknown>) => {
    try { return await raw<T>(model, method, body); } catch (err) { return toAdapterError(err); }
  };
  const stored = await sc.from('external_command_outbox').select('payload').eq('org_id', ctx.orgId).eq('domain', ctx.command.domain)
    .eq('pmo_record_id', ctx.command.record.id).eq('idempotency_key', ctx.command.idempotencyKey!).maybeSingle();
  if (stored.error) throw new AppError('The invoice could not be checked against its earlier attempt', 'external-unreachable');

  let expect: InvoiceExpect;
  let payload: Record<string, unknown>;
  if (stored.data) {
    // The original expectation and probe window are immutable command facts. Re-resolve only the PMO draft fields so an
    // idempotency-key reuse after a line/reference edit still fails its digest, without making recovery depend on today's ERP mappings.
    const persisted = (stored.data as { payload?: Record<string, unknown> | null }).payload;
    const persistedExpect = expectOf(persisted);
    const persistedComposite = compositeOf(persisted);
    if (!persisted || !persistedExpect || !persistedComposite) {
      throw new AppError('invoice-recovery-payload-incomplete', 'commit-rejected');
    }
    const commandMaterial = await resolveOdooInvoiceCommandMaterial(sc, ctx.orgId, ctx.command, true);
    expect = persistedExpect;
    if (typeof persisted.odoo_draft_digest === 'string') {
      // Preserve the original normalized command material, but bind its replay to the current PMO source lines.
      // This avoids depending on mutable Odoo mappings while still rejecting a changed draft under the same key.
      payload = { ...persisted, odoo_draft_digest: await odooInvoiceDraftDigest(commandMaterial.draft) };
    } else {
      // Older rows predate the source digest and used the unrounded draft command material.
      payload = {
        ...record, erp_doc_kind: 'sales-invoice',
        odoo_partner_id: persistedComposite.partnerId, odoo_expected_total: persistedExpect.total,
        odoo_cost_account: persistedExpect.costAccountId, created_after: persistedComposite.createdAfter,
        ...(persistedComposite.createdBefore ? { created_before: persistedComposite.createdBefore } : {}),
        ...(persistedExpect.advanceAccount ? {
          odoo_advance_product_id: persistedExpect.advanceAccount.productId,
          odoo_advance_account_id: persistedExpect.advanceAccount.accountId,
        } : {}),
        ...(typeof persisted.odoo_adopted_ref === 'string' ? { odoo_adopted_ref: persisted.odoo_adopted_ref } : {}),
        ...(persisted.odoo_absent_confirmed === true ? { odoo_absent_confirmed: true } : {}),
      };
    }
  } else {
    const resolvedInvoice = await resolveOdooInvoiceInputs(sc, ctx.orgId, ctx.command, resolved, call, false);
    const facts = await invoiceCompositeFacts(sc, ctx.orgId, record);
    expect = resolvedInvoice.expect;
    payload = {
      ...record, erp_doc_kind: 'sales-invoice', odoo_partner_id: facts.partnerId,
      odoo_expected_total: expect.total, odoo_cost_account: expect.costAccountId,
      odoo_draft_digest: await odooInvoiceDraftDigest(resolvedInvoice.draft),
      ...(expect.advanceAccount ? {
        odoo_advance_product_id: expect.advanceAccount.productId,
        odoo_advance_account_id: expect.advanceAccount.accountId,
      } : {}),
      created_after: odooDatetime(Date.now() - WINDOW_MS), created_before: odooDatetime(Date.now() + CLAIM_BUDGET_MS + SETTLE_MARGIN_MS),
    };
  }
  const material = Object.fromEntries(Object.entries(payload).filter(([k]) => !(DERIVED_KEYS as readonly string[]).includes(k)));
  return createDbMoneyOutboxDeps({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    externalTier: ODOO_TIER,
    operation: 'create',
    actorUserId: ctx.userId,
    reissueOnInconclusiveAbsence: false,
    payload,
    payloadDigest: await canonicalCommandDigest({ domain: ctx.command.domain, operation: 'create', record: material }),
    probeByRemarksKey: async (domain, idempotencyKey, probe) => {
      const persisted = await readOutboxCompositePayload(ctx.serviceClient, ctx.orgId, domain, ctx.command.record.id, idempotencyKey);
      const judged = expectOf(persisted) ?? expectOf(payload);
      if (!judged) throw new AppError('invoice-expectation-missing', 'commit-rejected');   // cannot judge a recovered invoice: hold it
      const adoptedRef = typeof persisted?.odoo_adopted_ref === 'string' ? persisted.odoo_adopted_ref : undefined;
      // The composite looks for an invoice a lost response may have left without its identifier, so it runs only in a RECOVERY; a first
      // attempt has made nothing yet, and the client's other unanchored Odoo invoices are not its business. No signal = recovery.
      const composite = probe?.recovery === false ? undefined : compositeOf(persisted) ?? compositeOf(payload);
      return recoverInvoice(call, ctx.command.record, composite, judged, adoptedRef);
    },
  });
}

/**
 * The DB-backed money-outbox deps for ONE Odoo revenue command (FR-OCI-001, DD-OCI-1): the shared outbox, claim, fence and finalize.
 * Both revenue anchors are composite hold-on-doubt (SD-6/SD-7), so a recovery that finds nothing is HELD, never reissued. The recovery probe
 * itself arrives with the adapter steps (C3-C5); until then a probe holds the row (an unconfirmed outcome is never reported as success).
 */
export async function resolveOdooRevenueMoneyOutboxDeps(ctx: AdapterSelectContext): Promise<DispatchMoneyOutboxDeps> {
  const operation = ctx.command.operation as string;
  if (operation === 'delete') throw new AppError('odoo adapter does not support delete', 'commit-rejected');
  const record = ctx.command.record as Record<string, unknown>;
  const docKind = record.erp_doc_kind;
  if (!isRevenueKind(docKind)) throw new AppError(`odoo revenue kind '${String(docKind)}' is not wired`, 'commit-rejected');
  odooRevenueAnchorKey(docKind, record);
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  if (docKind === 'sales-invoice') return invoiceOutboxDeps(ctx, resolved, record);
  const payload: Record<string, unknown> = { ...record, erp_doc_kind: docKind };
  return createDbMoneyOutboxDeps({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    externalTier: ODOO_TIER,
    operation: operation as 'create' | 'update' | 'transition',
    actorUserId: ctx.userId,
    reissueOnInconclusiveAbsence: false,
    payload,
    payloadDigest: await canonicalCommandDigest({ domain: ctx.command.domain, operation, record: payload }),
    probeByRemarksKey: async () => { throw new AppError('odoo-revenue-recovery-unavailable', 'commit-rejected'); },
  });
}
