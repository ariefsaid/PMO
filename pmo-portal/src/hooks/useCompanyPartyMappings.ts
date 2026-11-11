import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';

export function useCompanyPartyMappings(companyIds: readonly string[], enabled: boolean) {
  const orgId = useAuth().currentUser?.org_id;
  const ids = [...companyIds].sort();
  const query = useQuery({
    queryKey: ['company-party-mappings', orgId, ids],
    queryFn: () => repositories.companyCollections.listPartyIds(ids),
    enabled: enabled && Boolean(orgId),
  });
  return { ids: query.data ?? [], isPending: query.isPending, isError: query.isError };
}
