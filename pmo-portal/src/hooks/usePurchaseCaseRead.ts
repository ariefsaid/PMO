import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { repositories } from '@/src/lib/repositories';

/** Organisation-wide inspection is independent of ordering and approval authority. Unknown fails closed. */
export function usePurchaseCaseRead(): boolean {
  return useOrgQuery(['purchase-case-read'], () => repositories.procurement.mayReadPurchaseCases(), { staleness: 'session' }).data === true;
}
