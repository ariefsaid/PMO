import { useAuth } from '@/src/auth/useAuth';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { MAY_ORDER_PURCHASES_KEY } from '@/src/hooks/approvalsQueryKeys';
import { repositories } from '@/src/lib/repositories';

/**
 * Who the procurement list narrows to on the server. A Project Manager without organisation-wide
 * purchase rights sees their own requests plus the projects they manage (the same predicate the list
 * page applies in the browser), so the read asks for just those. Everyone else reads as before.
 *
 * `isProjectManager` is the caller's real-role check (never impersonated). `ready` is false for a Project Manager until the two rights reads have settled, so the list is never
 * fetched once narrowed and again whole. Other roles are ready at once. The page and the block share
 * one cache entry only while both call this hook.
 */
export function useProcurementListScope(isProjectManager: boolean): { scopeUserId: string | undefined; ready: boolean } {
  const userId = useAuth().currentUser?.id;
  const order = useOrgQuery([MAY_ORDER_PURCHASES_KEY], () => repositories.procurement.mayOrderPurchases(), { staleness: 'session', enabled: isProjectManager });
  const caseRead = useOrgQuery(['purchase-case-read'], () => repositories.procurement.mayReadPurchaseCases(), { staleness: 'session', enabled: isProjectManager });
  if (!isProjectManager || !userId) return { scopeUserId: undefined, ready: true };
  const ready = !order.isPending && !caseRead.isPending;
  return { scopeUserId: order.data === true || caseRead.data === true ? undefined : userId, ready };
}
