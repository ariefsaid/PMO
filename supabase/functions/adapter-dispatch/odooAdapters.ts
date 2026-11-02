import type { SupabaseClient } from '@supabase/supabase-js';
import type { Adapter } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { procurementCapabilityGap } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/capabilities.ts';
import { odooClientForOrg } from '../_shared/odooClientForOrg.ts';
import type { AdapterFactory, AdapterSelectContext } from './dispatchAdapters.ts';

/**
 * Adapter selection for an org that employs procurement under tier `odoo` (DD-OPP-1). It refuses, before any outbox row and any
 * Odoo request (DD-OPP-8, FR-OPP-002), a connection that is switched off, not activated, unusable, or whose stored capability
 * snapshot lacks a model a purchase needs; the refusal names the model. A connection that passes is still refused for now:
 * the Odoo procurement adapter arrives with P3 (order), P4 (receipt), P5 (bill) and P6 (payment), and this factory is where it
 * is returned. Failing closed here means a gate-passing command can never reach the ERPNext adapter by default.
 */
export async function resolveOdooProcurementAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  const gap = procurementCapabilityGap(resolved.config.capabilities as Parameters<typeof procurementCapabilityGap>[0]);
  if (gap) throw new AppError(`Odoo purchasing needs ${gap}, which this Odoo connection does not show. Run the connection check again.`, 'config-rejected');
  throw new AppError('Purchasing through Odoo is not available yet', 'config-rejected');
}

/** The Odoo tier's registry, keyed by the PMO domain it employs. */
export const ODOO_ADAPTER_REGISTRY: Record<string, AdapterFactory> = { procurement: resolveOdooProcurementAdapter };
