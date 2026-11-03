import type { SupabaseClient } from '@supabase/supabase-js';
import type { Adapter } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { buildBillBody } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billBody.ts';
import { createOdooProcurementAdapter } from '../../../pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts';
import { procurementCapabilityGap } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/capabilities.ts';
import { REQUEST_DEADLINE_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/constants.ts';
import { odooClientForOrg } from '../_shared/odooClientForOrg.ts';
import { resolveOdooBillInputs, resolveOdooOrderCurrency, resolveOdooOrderInputs, resolveOdooReviseInputs } from '../_shared/odooPurchaseRefs.ts';
import type { AdapterFactory, AdapterSelectContext } from './dispatchAdapters.ts';

/** What the Odoo procurement adapter pushes so far: the purchase order and its revision (P3) and the vendor bill (P5). Receipt and payment follow (P4, P6). */
const pushable = (ctx: AdapterSelectContext): boolean => {
  const { erp_doc_kind: kind } = ctx.command.record;
  const operation = String(ctx.command.operation);
  return (kind === 'purchase-order' && (operation === 'create' || operation === 'revise')) || (kind === 'purchase-invoice' && operation === 'create');
};

/**
 * Adapter selection for an org that employs procurement under tier `odoo` (DD-OPP-1). It refuses, before any outbox row and any
 * Odoo request (DD-OPP-8, FR-OPP-002), a connection that is switched off, not activated, unusable, or whose stored capability
 * snapshot lacks a model a purchase needs; the refusal names the model. A step the Odoo adapter does not push yet is refused the
 * same way: failing closed here means a gate-passing command can never reach the ERPNext adapter by default, and a step with no
 * Odoo implementation leaves no outbox row.
 */
export async function resolveOdooProcurementAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  const gap = procurementCapabilityGap(resolved.config.capabilities as Parameters<typeof procurementCapabilityGap>[0]);
  if (gap) throw new AppError(`Odoo purchasing needs ${gap}, which this Odoo connection does not show. Run the connection check again.`, 'config-rejected');
  if (!pushable(ctx)) throw new AppError('Purchasing through Odoo is not available yet', 'config-rejected');
  const sc = ctx.serviceClient as SupabaseClient;
  const call = bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS });
  // OQ-OPP-9: company currency only; a mismatch is refused here, before any outbox row, and Odoo is only read.
  const currencyId = await resolveOdooOrderCurrency(sc, ctx.orgId, ctx.command, call, resolved.companyId);
  // A bill is resolved here, with the currency: a malformed tax set, an unmapped item or an unlinked project is refused before any
  // outbox row. A replay skips it (the document may already exist: its recovery must not depend on today's mappings); the adapter
  // resolves lazily, only if it still has to create.
  if (ctx.command.record.erp_doc_kind === 'purchase-invoice' && !ctx.replay) {
    const { input, ctx: billCtx } = await resolveOdooBillInputs(sc, ctx.orgId, ctx.command, resolved, currencyId, call);
    buildBillBody(input, billCtx);   // a dry build: an unmapped vendor, item or unit, two projects or no lines refuse here, naming the thing
  }
  return createOdooProcurementAdapter({
    call,
    resolveBill: (command) => resolveOdooBillInputs(sc, ctx.orgId, command, resolved, currencyId, call),
    resolveOrder: (command) => resolveOdooOrderInputs(sc, ctx.orgId, command, resolved, currencyId),
    resolveRevise: (command) => resolveOdooReviseInputs(sc, ctx.orgId, command, resolved, currencyId),
  });
}

/** The Odoo tier's registry, keyed by the PMO domain it employs. */
export const ODOO_ADAPTER_REGISTRY: Record<string, AdapterFactory> = { procurement: resolveOdooProcurementAdapter };
