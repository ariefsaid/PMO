import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { projectMoneyRepository } from '@/src/lib/repositories/projectMoney';

/** One collection RPC per visible project set; identity and filters remain owned by useProjects. */
export function useProjectsMoneyCollection(ids: string[]) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const stableIds = [...ids].sort();
  return useQuery({
    queryKey: ['projects-money', orgId, stableIds.join(',')],
    queryFn: () => projectMoneyRepository.collection(stableIds),
    enabled: Boolean(orgId) && stableIds.length > 0,
    staleTime: 15_000,
  });
}
