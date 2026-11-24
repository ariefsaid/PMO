import { repositories } from '@/src/lib/repositories';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** The opening balances loaded for the organisation (FR-OBS-001). The key carries org_id (ADR-0017). */
export function useOpeningBalances(enabled = true) {
  return useOrgQuery(['opening-balances'], () => repositories.openingBalances.list(), { enabled, staleness: 'live' });
}
