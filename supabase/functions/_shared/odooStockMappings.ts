/**
 * Server-side Odoo stock mappings adapter (AC-OSP-001, AC-OSP-006).
 *
 * Adapts the Supabase service client (`external_refs` lookup and bound analytic account resolution) and the live Odoo
 * call into the pure stock mappings resolver. The organisation and company are the server's; client-supplied ids are never
 * trusted. An issue's destination comes from the verified operation type's destination location.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import type { ExternalRefsBatchClient } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { resolveOdooCostAccount } from './odooPurchaseRefs.ts';
import {
  resolveStockMappings,
  type StockMappingParams,
  type ResolveStockMappingsResult,
  type StockMappingDeps,
} from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/mappings.ts';

/**
 * Server-side entry point for resolving and validating Odoo stock mappings.
 */
export async function resolveOdooStockMappings(
  sc: SupabaseClient,
  call: OdooCall,
  params: StockMappingParams,
): Promise<ResolveStockMappingsResult> {
  const deps: StockMappingDeps = {
    call,
    client: sc as unknown as ExternalRefsBatchClient,
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

  return await resolveStockMappings(params, deps);
}
