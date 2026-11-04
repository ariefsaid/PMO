import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { toAdapterError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { recoverInvoice, recoverReceipt, type ReceiptResolution } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.ts';
import { REVENUE_KEY_RE, type RevenueKind } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/anchors.ts';
import type { ReceiptComposite } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/receiptRecoveryProbe.ts';
import { buildReceiptBody } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/receiptBody.ts';
import { CLAIM_BUDGET_MS, REQUEST_DEADLINE_MS, SETTLE_MARGIN_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/constants.ts';
import type { InvoiceExpect } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.ts';
import type { InvoiceComposite } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/recoveryProbe.ts';
import { odooClientForOrg, type OdooClientForOrgResult } from '../_shared/odooClientForOrg.ts';
import { invoiceCompositeFacts, resolveOdooInvoiceInputs, resolveOdooReceiptInputs } from '../_shared/odooRevenueRefs.ts';
import { readOutboxCompositePayload, readOutboxCompositeWitness } from './erpMoneyOutbox.ts';
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
const DERIVED_KEYS = ['odoo_expected_total', 'odoo_cost_account', 'odoo_advance_product_id', 'odoo_advance_account_id', 'odoo_partner_id', 'created_after', 'created_before'] as const;
const RECEIPT_DERIVED_KEYS = ['odoo_receipt_probe', 'odoo_adopted_ref', 'odoo_absent_confirmed', 'recorded_by', 'recorded_by_id', 'recordedBy'] as const;
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
  const { expect } = await resolveOdooInvoiceInputs(sc, ctx.orgId, ctx.command, resolved, call, await revenueOutboxRowExists(ctx));
  const facts = await invoiceCompositeFacts(sc, ctx.orgId, record);
  const payload: Record<string, unknown> = {
    ...record, erp_doc_kind: 'sales-invoice', odoo_partner_id: facts.partnerId, odoo_expected_total: expect.total, odoo_cost_account: expect.costAccountId,
    ...(expect.advanceAccount ? { odoo_advance_product_id: expect.advanceAccount.productId, odoo_advance_account_id: expect.advanceAccount.accountId } : {}),
    created_after: odooDatetime(Date.now() - WINDOW_MS), created_before: odooDatetime(Date.now() + CLAIM_BUDGET_MS + SETTLE_MARGIN_MS),
  };
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
      // The composite looks for an invoice a lost response may have left without its identifier, so it runs only in a RECOVERY; a first
      // attempt has made nothing yet, and the client's other unanchored Odoo invoices are not its business. No signal = recovery.
      const composite = probe?.recovery === false ? undefined : compositeOf(persisted) ?? compositeOf(payload);
      return recoverInvoice(call, ctx.command.record, composite, judged);
    },
  });
}

const receiptCompositeOf = (payload: Record<string, unknown> | null | undefined): ReceiptComposite | undefined => {
  const value = payload?.odoo_receipt_probe as Record<string, unknown> | undefined;
  if (!value || typeof value.partnerId !== 'number' || typeof value.amount !== 'number' || typeof value.date !== 'string'
      || typeof value.invoiceId !== 'number' || typeof value.createdAfter !== 'string') return undefined;
  return { partnerId: value.partnerId, amount: value.amount, date: value.date, invoiceId: value.invoiceId,
    createdAfter: value.createdAfter, ...(typeof value.createdBefore === 'string' ? { createdBefore: value.createdBefore } : {}) };
};

/** A held receipt's human decision, stored only by `resolve_held_outbox_command`. */
const receiptResolutionOf = (payload: Record<string, unknown> | null | undefined): ReceiptResolution | undefined =>
  typeof payload?.odoo_adopted_ref === 'string' ? { adoptedRef: payload.odoo_adopted_ref }
    : payload?.odoo_absent_confirmed === true ? { absentConfirmed: true } : undefined;

async function receiptOutboxDeps(ctx: AdapterSelectContext, resolved: Exclude<OdooClientForOrgResult, { refusal: unknown }>, record: Record<string, unknown>): Promise<DispatchMoneyOutboxDeps> {
  const sc = ctx.serviceClient as SupabaseClient;
  const raw = bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS });
  const call: OdooCall = async <T>(model: string, method: string, body?: Record<string, unknown>) => {
    try { return await raw<T>(model, method, body); } catch (err) { return toAdapterError(err); }
  };
  const replay = await revenueOutboxRowExists(ctx);
  const facts = await resolveOdooReceiptInputs(sc, ctx.orgId, ctx.command, resolved.companyId, resolved.config, call, ctx.userId);
  const priorWitness = replay
    ? await readOutboxCompositeWitness(ctx.serviceClient, ctx.orgId, ctx.command.domain, ctx.command.record.id, ctx.command.idempotencyKey!)
    : null;
  const priorPayload = priorWitness?.payload ?? null;
  const priorComposite = receiptCompositeOf(priorPayload);
  const resolution = receiptResolutionOf(priorPayload);
  // The outbox's actor column is verified from the first caller's JWT. A same-key retry may be
  // dispatched by another Finance user; keep that original author when adopting and mirroring it.
  const recordedBy = priorWitness?.actorUserId ?? ctx.userId;
  let built = buildReceiptBody(facts.input, facts.invoice, facts.defaults, ctx.userId);
  // A confirmed same-key replay may see Odoo's invoice residual at zero. Relax only that residual check,
  // and only when the persisted probe proves this is the exact same partner/amount/date/invoice intent.
  if (replay && built.outcome === 'refused' && built.thing === 'over-receipt' && facts.invoice && priorComposite) {
    const invoiceId = Number(facts.invoiceRef.slice('account.move:'.length));
    const partnerId = facts.defaults.partners[facts.invoice.customerId];
    const amount = Number(facts.input.cash ?? facts.input.settled);
    if (priorComposite.partnerId === partnerId && priorComposite.amount === amount
        && priorComposite.date === facts.input.date && priorComposite.invoiceId === invoiceId) {
      built = buildReceiptBody(facts.input, { ...facts.invoice, outstanding: facts.input.settled }, facts.defaults, ctx.userId);
    }
  }
  if (built.outcome === 'refused') throw new AppError(`${built.code}: ${built.thing}`, built.code);
  const invoiceId = Number(facts.invoiceRef.slice('account.move:'.length));
  const expected: ReceiptComposite & { recordedBy?: string } = priorComposite ? { ...priorComposite, recordedBy } : {
    partnerId: Number(built.body.partner_id), amount: Number(built.body.amount), date: facts.input.date, invoiceId,
    createdAfter: odooDatetime(Date.now() - WINDOW_MS), createdBefore: odooDatetime(Date.now() + CLAIM_BUDGET_MS + SETTLE_MARGIN_MS),
    recordedBy,
  };
  const payload: Record<string, unknown> = {
    ...record,
    erp_doc_kind: 'incoming-payment',
    // Keep the JWT actor in the outbox's verified `actor_user_id` column, not in command material.
    odoo_receipt_probe: {
      partnerId: expected.partnerId, amount: expected.amount, date: expected.date, invoiceId: expected.invoiceId,
      createdAfter: expected.createdAfter, ...(expected.createdBefore ? { createdBefore: expected.createdBefore } : {}),
    },
  };
  const material = Object.fromEntries(Object.entries(payload).filter(([k]) => !(RECEIPT_DERIVED_KEYS as readonly string[]).includes(k)));
  return createDbMoneyOutboxDeps({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    externalTier: ODOO_TIER,
    operation: 'create',
    actorUserId: ctx.userId,
    reissueOnInconclusiveAbsence: resolution?.absentConfirmed === true,
    payload,
    payloadDigest: await canonicalCommandDigest({ domain: ctx.command.domain, operation: 'create', record: material }),
    probeByRemarksKey: async (domain, idempotencyKey, probe) => {
      const persisted = await readOutboxCompositePayload(ctx.serviceClient, ctx.orgId, domain, ctx.command.record.id, idempotencyKey);
      const persistedComposite = receiptCompositeOf(persisted);
      const persistedResolution = receiptResolutionOf(persisted);
      const composite = probe?.recovery === false ? undefined : persistedComposite ? { ...persistedComposite, recordedBy } : expected;
      const recovered = await recoverReceipt(call, ctx.command.record, composite, facts.input, persistedResolution);
      return recovered ? recovered : null;
    },
  });
}

/**
 * The DB-backed money-outbox deps for ONE Odoo revenue command (FR-OCI-001, DD-OCI-1): the shared outbox, claim, fence and finalize.
 * Both shipped revenue anchors use stock identifiers plus a bounded recovery conjunction (SD-6/SD-7), so an inconclusive recovery is HELD,
 * never reissued. Invoice and receipt probes finalize their matching C3-C5 commands; an unhandled kind fails closed before it can be claimed.
 */
export async function resolveOdooRevenueMoneyOutboxDeps(ctx: AdapterSelectContext): Promise<DispatchMoneyOutboxDeps> {
  const operation = ctx.command.operation as string;
  if (operation === 'delete') throw new AppError('odoo adapter does not support delete', 'commit-rejected');
  const record = ctx.command.record as Record<string, unknown>;
  const docKind = record.erp_doc_kind;
  if (!isRevenueKind(docKind)) throw new AppError(`odoo revenue kind '${String(docKind)}' is not wired`, 'commit-rejected');
  odooRevenueAnchorKey(docKind, record);
  if (docKind === 'incoming-payment' && operation !== 'create') {
    throw new AppError(`odoo revenue ${docKind} ${operation} is not available yet`, 'commit-rejected');
  }
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  if (docKind === 'sales-invoice') return invoiceOutboxDeps(ctx, resolved, record);
  const payload: Record<string, unknown> = { ...record, erp_doc_kind: docKind };
  delete payload.recorded_by;
  delete payload.recorded_by_id;
  delete payload.recordedBy;
  if (docKind === 'incoming-payment') {
    // Resolution markers are written only by the held-command RPC, never accepted from command input.
    delete payload.odoo_adopted_ref;
    delete payload.odoo_absent_confirmed;
    return receiptOutboxDeps(ctx, resolved, payload);
  }
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
