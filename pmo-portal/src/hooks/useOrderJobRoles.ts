import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { repositories } from '@/src/lib/repositories';

export const ORDER_JOB_ROLES_KEY = 'order-job-roles';
import { MAY_ORDER_PURCHASES_KEY } from '@/src/hooks/approvalsQueryKeys';
export { MAY_ORDER_PURCHASES_KEY };

/** roles-that-decide FR-RTD-009: the built-in roles the organisation lets raise and send purchase orders. */
export function useOrderJobRoles() {
  return useOrgQuery([ORDER_JOB_ROLES_KEY], () => repositories.procurement.orderJobRoles(), { staleness: 'session' });
}

/** Whether the signed-in person may order by built-in role: the database gate itself, never a mirror. Unreadable = no. */
export function useMayOrderPurchases(): boolean {
  const q = useOrgQuery([MAY_ORDER_PURCHASES_KEY], () => repositories.procurement.mayOrderPurchases(), { staleness: 'session' });
  return q.data === true;
}

export function useOrderJobRolesMutation() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (keys: string[] | null) => repositories.procurement.setOrderJobRoles(keys),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [ORDER_JOB_ROLES_KEY, orgId] });
      void qc.invalidateQueries({ queryKey: [MAY_ORDER_PURCHASES_KEY, orgId] });
    },
  });
}
