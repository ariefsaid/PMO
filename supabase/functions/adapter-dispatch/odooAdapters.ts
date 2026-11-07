import type { SupabaseClient } from '@supabase/supabase-js';
import type { Adapter } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { buildBillBody } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billBody.ts';
import { buildPaymentBody } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/paymentBody.ts';
import { createOdooProcurementAdapter, paymentKey, readPaymentCtx } from '../../../pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts';
import { procurementCapabilityGap } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/capabilities.ts';
import { revenueCapabilityGap } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/capabilities.ts';
import { REQUEST_DEADLINE_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/constants.ts';
import { odooClientForOrg } from '../_shared/odooClientForOrg.ts';
import { resolveOdooBillInputs, resolveOdooOrderCurrency, resolveOdooOrderInputs, resolveOdooPaymentFacts, resolveOdooReviseInputs } from '../_shared/odooPurchaseRefs.ts';
import type { AdapterFactory, AdapterSelectContext } from './dispatchAdapters.ts';
import { assertCommandLinksSameOrg } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchPreflight.ts';
import { assertOdooRevenueCommandScope } from './odooRevenueGate.ts';
import { revenueOutboxRowExists } from './odooRevenueOutbox.ts';
import { resolveOdooInvoiceInputs, resolveOdooReceiptInputs } from '../_shared/odooRevenueRefs.ts';
import { createOdooRevenueAdapter, isInvoicePush } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.ts';
import { buildInvoiceBody } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceBody.ts';
import { buildReceiptBody } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/receiptBody.ts';
import { countOdooCalls } from '../_shared/odooCallBudget.ts';

/** What the Odoo procurement adapter pushes so far: the purchase order and its revision (P3), the goods receipt (P4), the vendor bill (P5) and the vendor payment (P6). */
const isReceipt = (ctx: AdapterSelectContext): boolean => ctx.command.record.erp_doc_kind === 'goods-receipt' && ctx.command.operation === 'create';
const pushable = (ctx: AdapterSelectContext): boolean => {
  const { erp_doc_kind: kind } = ctx.command.record;
  const operation = String(ctx.command.operation);
  return (kind === 'purchase-order' && (operation === 'create' || operation === 'revise')) || ((kind === 'goods-receipt' || kind === 'purchase-invoice' || kind === 'payment') && operation === 'create');
};

/** Has this command (the same record and idempotency key) already left an outbox row? Unreadable is refused, never taken for a first attempt. */
async function outboxRowExists(ctx: AdapterSelectContext): Promise<boolean> {
  const { command } = ctx;
  const { data, error } = await (ctx.serviceClient as SupabaseClient).from('external_command_outbox').select('id')
    .eq('org_id', ctx.orgId).eq('domain', command.domain).eq('pmo_record_id', command.record.id).eq('idempotency_key', command.idempotencyKey!).maybeSingle();
  if (error) throw new AppError('The payment could not be checked against its earlier attempt', 'external-unreachable');
  return data !== null;
}

/**
 * Adapter selection for an org that employs procurement under tier `odoo` (DD-OPP-1). It first runs the shared same-org link check (AC-OPP-003),
 * then refuses, before any outbox row and any
 * Odoo request (DD-OPP-8, FR-OPP-002), a connection that is switched off, not activated, unusable, or whose stored capability
 * snapshot lacks a model a purchase needs; the refusal names the model. A step the Odoo adapter does not push yet is refused the
 * same way: failing closed here means a gate-passing command can never reach the ERPNext adapter by default, and a step with no
 * Odoo implementation leaves no outbox row.
 */
export async function resolveOdooProcurementAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  await assertCommandLinksSameOrg({ command: ctx.command, serviceClient: ctx.serviceClient as never, orgId: ctx.orgId });   // the shared link check, before any Odoo read
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  const gap = procurementCapabilityGap(resolved.config.capabilities as Parameters<typeof procurementCapabilityGap>[0]);
  if (gap) throw new AppError(`Odoo purchasing needs ${gap}, which this Odoo connection does not show. Run the connection check again.`, 'config-rejected');
  if (!pushable(ctx)) throw new AppError('Purchasing through Odoo is not available yet', 'config-rejected');
  const sc = ctx.serviceClient as SupabaseClient;
  // Recovery charges the reservation after dependencies are built. Count adapter traffic, but do not
  // stop a commit midway: after Odoo accepts create, every failure must leave the outbox retryable.
  const call = countOdooCalls(bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS }), ctx.odooCallBudget);
  if (isReceipt(ctx)) {
    // A receipt books onto the transfer Odoo opened with the order: no order inputs, no currency; its plan comes with the outbox deps.
    const notAnOrder = () => Promise.reject(new AppError('not a purchase-order step', 'commit-rejected'));
    return createOdooProcurementAdapter({ call, resolveOrder: notAnOrder, resolveRevise: notAnOrder, resolveBill: notAnOrder, isExternalAnchorOwnedElsewhere: ctx.odooAnchorOwnedElsewhere });
  }
  // OQ-OPP-9: company currency only; a mismatch is refused here, before any outbox row, and Odoo is only read.
  const currencyId = await resolveOdooOrderCurrency(sc, ctx.orgId, ctx.command, call, resolved.companyId);
  // A bill is resolved here, with the currency: a malformed tax set, an unmapped item or an unlinked project is refused before any
  // outbox row. A replay skips it (the document may already exist: its recovery must not depend on today's mappings); the adapter
  // resolves lazily, only if it still has to create.
  if (ctx.command.record.erp_doc_kind === 'purchase-invoice' && !ctx.replay) {
    const { input, ctx: billCtx } = await resolveOdooBillInputs(sc, ctx.orgId, ctx.command, resolved, currencyId, call);
    buildBillBody(input, billCtx);   // a dry build: an unmapped vendor, item or unit, two projects or no lines refuse here, naming the thing
  }
  // A payment is resolved and dry-built here too, with the currency: no bill reference, an unposted bill, another currency, an amount
  // above the residual (Odoo would accept it) or no journal is refused before any outbox row. A replay skips it: the payment it made
  // has already reduced the residual, and its recovery must not depend on today's journal default. A payment is a replay when its
  // outbox row already exists (the receipt rule, FR-OPP-072): a retry of the same intent after a lost response meets a settled bill,
  // and the outbox answers it. A fresh intent has no row and keeps the over-payment check.
  if (ctx.command.record.erp_doc_kind === 'payment' && !ctx.replay && !(await outboxRowExists(ctx))) {
    const facts = await resolveOdooPaymentFacts(sc, ctx.orgId, ctx.command, resolved, currencyId);
    buildPaymentBody({ billRef: facts.billRef, amount: facts.amount, date: facts.date, vendorPartnerId: facts.vendorPartnerId }, await readPaymentCtx(call, facts), paymentKey(ctx.command.record));
  }
  return createOdooProcurementAdapter({
    call,
    resolvePayment: (command) => resolveOdooPaymentFacts(sc, ctx.orgId, command, resolved, currencyId),
    resolveBill: (command) => resolveOdooBillInputs(sc, ctx.orgId, command, resolved, currencyId, call),
    resolveOrder: (command) => resolveOdooOrderInputs(sc, ctx.orgId, command, resolved, currencyId),
    resolveRevise: (command) => resolveOdooReviseInputs(sc, ctx.orgId, command, resolved, currencyId),
    isExternalAnchorOwnedElsewhere: ctx.odooAnchorOwnedElsewhere,
  });
}

/**
 * Adapter selection for an org that employs revenue under tier `odoo` (FR-OCI-001/002/004, DD-OCI-1, DD-OCI-8). Before any outbox row and any
 * Odoo request it refuses a connection that is switched off, not activated or unusable, a stored capability snapshot that lacks a model an
 * invoice or receipt needs (the refusal names it), and a link or receipt scope that is not the caller's. Invoice approval and customer receipt
 * commands are resolved and dry-built here before the outbox opens, so a missing mapping, unlinked project, invalid receipt journal or tax
 * account refuses before any outbox row. An invoice-approval retry skips its dry build: its Odoo document may already exist, and recovery must
 * not depend on today's mappings. Claims remain unavailable until their slice ships, so a gate-passing claim cannot reach ERPNext or leave an
 * outbox row.
 */
export async function resolveOdooRevenueAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  const gap = revenueCapabilityGap(resolved.config.capabilities as Parameters<typeof revenueCapabilityGap>[0]);
  if (gap) throw new AppError(`Odoo invoicing needs ${gap}, which this Odoo connection does not show. Run the connection check again.`, 'config-rejected');
  await assertOdooRevenueCommandScope(ctx.serviceClient as SupabaseClient, ctx.orgId, ctx.command);
  const isReceiptCreate = ctx.command.record.erp_doc_kind === 'incoming-payment' && ctx.command.operation === 'create';
  if (!isInvoicePush(ctx.command) && !isReceiptCreate) throw new AppError('This Odoo revenue command is not available yet', 'config-rejected');
  const sc = ctx.serviceClient as SupabaseClient;
  // Recovery charges the reservation after dependencies are built. Let an admitted commit finish so
  // a mid-commit budget cut cannot release a payment's in-flight slot.
  const call = countOdooCalls(bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS }), ctx.odooCallBudget);
  const replay = await revenueOutboxRowExists(ctx);
  if (isInvoicePush(ctx.command) && !replay) {
    const { input, maps } = await resolveOdooInvoiceInputs(sc, ctx.orgId, ctx.command, resolved, call);
    const built = buildInvoiceBody(input, maps);   // a dry build: an unmapped client, item or income account, a foreign currency or a net-negative total refuse here, naming the thing
    if (built.outcome === 'refused') throw new AppError(`${built.code}: ${built.thing}: ${built.name}`, 'config-rejected');
  }
  const receiptRecord = ctx.command.record as Record<string, unknown>;
  if (isReceiptCreate && !replay) {
    delete receiptRecord.recorded_by;
    delete receiptRecord.recorded_by_id;
    delete receiptRecord.recordedBy;
    const facts = await resolveOdooReceiptInputs(sc, ctx.orgId, ctx.command, resolved.companyId, resolved.config, call, ctx.userId);
    const built = buildReceiptBody(facts.input, facts.invoice, facts.defaults, ctx.userId);
    if (built.outcome === 'refused') throw new AppError(`${built.code}: ${built.thing}`, built.code);
  }
  return createOdooRevenueAdapter({
    call,
    resolveInvoice: (command) => resolveOdooInvoiceInputs(sc, ctx.orgId, command, resolved, call, replay),
    ...(isReceiptCreate ? { resolveReceipt: async (command) => ({
      ...(await resolveOdooReceiptInputs(sc, ctx.orgId, command, resolved.companyId, resolved.config, call, ctx.userId)), recordedBy: ctx.userId,
    }) } : {}),
  });
}

/** The Odoo tier's registry, keyed by the PMO domain it employs. */
export const ODOO_ADAPTER_REGISTRY: Record<string, AdapterFactory> = { procurement: resolveOdooProcurementAdapter, revenue: resolveOdooRevenueAdapter };
