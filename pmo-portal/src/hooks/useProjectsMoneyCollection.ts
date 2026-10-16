import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { projectMoneyRepository } from '@/src/lib/repositories/projectMoney';
import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';

/** One collection RPC per visible project set; identity and filters remain owned by useProjects. */
export function useProjectsMoneyCollection(ids: string[]) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const stableIds = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ['projects-money', orgId, stableIds.join(',')],
    queryFn: async (): Promise<Record<string, ProjectMoneyRead>> => {
      const chunks: string[][] = [];
      for (let start = 0; start < stableIds.length; start += 500) {
        chunks.push(stableIds.slice(start, start + 500));
      }
      const results = await Promise.all(chunks.map((chunk) => projectMoneyRepository.collection(chunk)));
      return Object.assign({}, ...results);
    },
    enabled: Boolean(orgId) && stableIds.length > 0,
    staleTime: 15_000,
  });
}
