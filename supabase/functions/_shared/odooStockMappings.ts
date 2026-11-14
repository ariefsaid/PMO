/**
 * Server-side Odoo stock mappings adapter (Task 8 of #1508, plan-stock-mappings.md § E).
 *
 * Adapts Supabase service client (`external_refs` lookup and bound analytic account resolution)
 * and live Odoo call into the pure stock mappings resolver.
 *
 * Director rulings:
 * - Server supplies trusted organization and company; client-supplied IDs are never trusted.
 * - For issue destination: derived from verified ERP operation type destination location if recorded
 *   in the dev bed research document. If not recorded in `docs/research/2026-11-14-odoo-stock-protocol.md`,
 *   the unrecorded field is stopped and reported rather than guessing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import type { ExternalRefsLookupClient } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { resolveOdooCostAccount } from './odooPurchaseRefs.ts';
import {
  resolveStockMappings,
  type StockMappingParams,
  type ResolveStockMappingsResult,
  type StockMappingDeps,
} from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/mappings.ts';

export interface ResolveOdooStockMappingsOptions {
  operationTypeId?: number;
}

/**
 * Server-side entry point for resolving and validating Odoo stock mappings.
 */
export async function resolveOdooStockMappings(
  sc: SupabaseClient,
  call: OdooCall,
  params: StockMappingParams,
  options?: ResolveOdooStockMappingsOptions,
): Promise<ResolveStockMappingsResult> {
  const deps: StockMappingDeps = {
    call,
    client: sc as unknown as ExternalRefsLookupClient,
    resolveCostAccount: async (projectId: string) => {
      const res = await resolveOdooCostAccount(sc, params.orgId, projectId);
      if (res.status === 'resolved') {
        return { status: 'resolved', accountId: res.accountId };
      }
      if (res.status === 'unlinked') {
        return { status: 'unlinked' };
      }
      return { status: 'needs-attention', reason: res.reason };
    },
  };

  // For issue destination location:
  // Brief directive: "take it from the verified operation type's configured destination location
  // (the capability check already reads the operation type) and validate company and usage; if the
  // bed doc does not record that field, stop that one point and report it."
  // Bed research doc (docs/research/2026-11-14-odoo-stock-protocol.md § 1.2) records only:
  // id, name, code, company_id, analytic_costs. It does NOT record default destination location on
  // stock.picking.type. We stop and refuse with clear guidance when destinationLocationId is missing.
  if (params.kind === 'issue' && !params.destinationLocationId) {
    void options?.operationTypeId;
    return {
      ok: false,
      reason: 'location-unavailable',
      message:
        'Destination location for issue operation type cannot be derived because the field is not recorded in the bed research doc (docs/research/2026-11-14-odoo-stock-protocol.md).',
    };
  }

  return await resolveStockMappings(params, deps);
}
