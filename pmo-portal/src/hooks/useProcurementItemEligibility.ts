import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { procurementRepository } from '@/src/lib/repositories/procurement';

export function useProcurementItemEligibility(caseId: string | undefined, enabled: boolean) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['procurement-item-eligibility', orgId, caseId],
    queryFn: () => procurementRepository.itemValuesEditable(caseId!),
    enabled: enabled && Boolean(orgId && caseId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
