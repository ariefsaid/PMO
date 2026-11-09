import { useQuery } from '@tanstack/react-query';
import { reportsRepository } from '@/src/lib/repositories/reporting';
import { useAuth } from '@/src/auth/useAuth';
import type { FinanceHubFigures } from '@/src/lib/db/financeHub';

/**
 * #1988 — the Finance hub's three figures (per-currency unbilled at the as-at month, contract-row
 * counts, latest company P&L net profit) from ONE narrow RPC instead of the whole management pack
 * plus a full statement read. Org-scoped cache key; never threads org_id to the server.
 */
export function useFinanceHubFigures(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<FinanceHubFigures, Error>({
    queryKey: ['financeHubFigures', orgId],
    queryFn: () => reportsRepository.figures(),
    enabled: Boolean(orgId) && enabled,
  });
}
