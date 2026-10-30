import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';

export function useProcurementItemEligibility(caseId: string | undefined, enabled: boolean) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['procurement-item-eligibility', orgId, caseId],
    queryFn: () => repositories.procurement.itemValuesEditable(caseId!),
    enabled: enabled && Boolean(orgId && caseId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
