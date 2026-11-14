/**
 * Server-side Odoo stock mappings adapter (Task 8 of #1508, plan-stock-mappings.md § E).
 *
 * Adapts Supabase service client (`external_refs` lookup and bound analytic account resolution)
 * and live Odoo call into the pure stock mappings resolver.
 *
 * Director rulings:
 * - Server supplies trusted organization and company; client-supplied IDs are never trusted.
 * - For issue destination: derived from verified ERP operation type destination location if not passed in.
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

  const effectiveParams =
    options?.operationTypeId && !params.operationTypeId
      ? { ...params, operationTypeId: options.operationTypeId }
      : params;

  return await resolveStockMappings(effectiveParams, deps);
}
