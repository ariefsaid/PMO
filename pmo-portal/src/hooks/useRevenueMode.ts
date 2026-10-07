import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';

export type RevenueMode = 'native' | 'erp';

/**
 * #784 (DD-NAR-1): who raises this org's customer invoices — PMO ('native') or the connected ERP ('erp'). Reads the
 * same fail-closed ownership cache the repository routes writes by, so a surface and its write path never disagree.
 * A cold cache reads 'native'; the server refuses a PMO write while an ERP owns revenue, so the worst case is an
 * honest refusal, never a wrong write.
 */
export function useRevenueMode(): RevenueMode {
  return routeDomainWrite('revenue') === 'external' ? 'erp' : 'native';
}
